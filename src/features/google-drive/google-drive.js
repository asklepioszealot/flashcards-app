// src/features/google-drive/google-drive.js
// Google Drive picker integration: auth, picker launch, file download and import.

import {
  DRIVE_SCOPES,
} from "../../shared/constants.js";
import { getRuntimeConfig, hasDriveConfig } from "../../core/runtime-config.js";
import {
  tokenClient, setTokenClient,
  driveAccessToken, setDriveAccessToken,
  pickerApiLoaded, setPickerApiLoaded,
} from "../../app/state.js";
import { importSetFromBinary, importSetFromText } from "../set-manager/set-manager.js";
import { showUndoToast } from "../set-manager/undo-toast.js";

function getDriveConfig() {
  return getRuntimeConfig();
}

function getMissingDriveConfigMessage() {
  return "Google Drive entegrasyonu icin DRIVE_CLIENT_ID ve DRIVE_API_KEY ayarlarinizi tamamlayin.";
}

export function initGoogleDrive() {
  if (!hasDriveConfig()) {
    return;
  }
  if (!window.google || !window.google.accounts || !window.gapi) {
    setTimeout(initGoogleDrive, 500);
    return;
  }
  const { driveClientId } = getDriveConfig();
  gapi.load("picker", () => {
    setPickerApiLoaded(true);
  });
  setTokenClient(google.accounts.oauth2.initTokenClient({
    client_id: driveClientId,
    scope: DRIVE_SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse?.access_token) {
        setDriveAccessToken(tokenResponse.access_token);
        launchDrivePicker();
      }
    },
  }));
}

export function authGoogleDrive() {
  if (!hasDriveConfig()) {
    alert(getMissingDriveConfigMessage());
    return;
  }
  if (!tokenClient || !pickerApiLoaded) {
    alert("Google Drive entegrasyonu henüz hazır değil.");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "" });
}

export function launchDrivePicker() {
  if (!hasDriveConfig()) {
    alert(getMissingDriveConfigMessage());
    return;
  }
  if (window.__TAURI__?.core?.invoke) {
    alert("Tauri masaüstü sürümünde Google Picker penceresi desteklenmiyor.");
    return;
  }
  const { driveApiKey, driveAppId } = getDriveConfig();
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes("application/json,text/markdown,text/plain,application/octet-stream,application/zip");
  const pickerBuilder = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(driveAccessToken)
    .setDeveloperKey(driveApiKey)
    .setCallback(pickerCallback)
    .setTitle("Uygulamaya eklenecek seti seç")
  if (driveAppId) {
    pickerBuilder.setAppId(driveAppId);
  }
  const picker = pickerBuilder.build();
  picker.setVisible(true);
}

export function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const file = data.docs[0];
    void downloadAndLoadDriveFile(file.id, file.name);
  }
}

export async function downloadAndLoadDriveFile(fileId, fileName) {
  try {
    const { driveApiKey } = getDriveConfig();
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${driveApiKey}`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (!response.ok) throw new Error(`İndirme hatası: ${response.statusText}`);
    if (/\.apkg$/i.test(String(fileName || ""))) {
      await importSetFromBinary(await response.arrayBuffer(), fileName);
    } else {
      await importSetFromText(await response.text(), fileName);
    }
    showUndoToast(`"${fileName}" yüklendi.`);
  } catch (error) {
    console.error(error);
    alert(`Drive dosyası yüklenemedi: ${error.message}`);
  }
}
