// src/features/google-drive/google-drive.js
// Google Drive picker integration: auth, picker launch, file download and import.

import {
  DRIVE_CLIENT_ID, DRIVE_API_KEY, DRIVE_APP_ID, DRIVE_SCOPES,
} from "../../shared/constants.js";
import {
  tokenClient, setTokenClient,
  driveAccessToken, setDriveAccessToken,
  pickerApiLoaded, setPickerApiLoaded,
} from "../../app/state.js";
import { importSetFromText } from "../set-manager/set-manager.js";
import { showUndoToast } from "../set-manager/undo-toast.js";

export function initGoogleDrive() {
  if (!window.google || !window.google.accounts || !window.gapi) {
    setTimeout(initGoogleDrive, 500);
    return;
  }
  gapi.load("picker", () => {
    setPickerApiLoaded(true);
  });
  setTokenClient(google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
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
  if (!tokenClient || !pickerApiLoaded) {
    alert("Google Drive entegrasyonu henüz hazır değil.");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "" });
}

export function launchDrivePicker() {
  if (window.__TAURI__?.core?.invoke) {
    alert("Tauri masaüstü sürümünde Google Picker penceresi desteklenmiyor.");
    return;
  }
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes("application/json,text/markdown,text/plain");
  const picker = new google.picker.PickerBuilder()
    .addView(view)
    .setOAuthToken(driveAccessToken)
    .setDeveloperKey(DRIVE_API_KEY)
    .setAppId(DRIVE_APP_ID)
    .setCallback(pickerCallback)
    .setTitle("Uygulamaya eklenecek seti seç")
    .build();
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
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`, {
      headers: { Authorization: `Bearer ${driveAccessToken}` },
    });
    if (!response.ok) throw new Error(`İndirme hatası: ${response.statusText}`);
    await importSetFromText(await response.text(), fileName);
    showUndoToast(`"${fileName}" yüklendi.`);
  } catch (error) {
    console.error(error);
    alert(`Drive dosyası yüklenemedi: ${error.message}`);
  }
}
