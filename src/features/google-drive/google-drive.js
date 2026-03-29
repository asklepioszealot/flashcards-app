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
import { importSetFromBinary, importSetFromText } from "../set-manager/set-manager.js";
import { showUndoToast } from "../set-manager/undo-toast.js";

let scriptsLoading = false;

function loadGoogleScripts(callback) {
  if (window.google?.accounts && window.gapi) {
    callback();
    return;
  }
  if (scriptsLoading) {
    const checkInterval = setInterval(() => {
      if (window.google?.accounts && window.gapi) {
        clearInterval(checkInterval);
        callback();
      }
    }, 100);
    return;
  }
  scriptsLoading = true;
  let loadedCount = 0;
  const onScriptLoaded = () => {
    loadedCount++;
    if (loadedCount === 2) {
      callback();
    }
  };

  const script1 = document.createElement("script");
  script1.src = "https://accounts.google.com/gsi/client";
  script1.async = true;
  script1.defer = true;
  script1.onload = onScriptLoaded;
  document.head.appendChild(script1);

  const script2 = document.createElement("script");
  script2.src = "https://apis.google.com/js/api.js";
  script2.async = true;
  script2.defer = true;
  script2.onload = onScriptLoaded;
  document.head.appendChild(script2);
}

export function authGoogleDrive() {
  if (!DRIVE_CLIENT_ID || !DRIVE_API_KEY) {
    alert("Google Drive entegrasyonu yapılandırılmamış.");
    return;
  }

  loadGoogleScripts(() => {
    if (!pickerApiLoaded) {
      gapi.load("picker", () => {
        setPickerApiLoaded(true);
      });
    }

    if (!tokenClient) {
      setTokenClient(google.accounts.oauth2.initTokenClient({
        client_id: DRIVE_CLIENT_ID,
        scope: DRIVE_SCOPES,
        callback: (tokenResponse) => {
          if (tokenResponse?.access_token) {
            setDriveAccessToken(tokenResponse.access_token);
            const launchWhenReady = () => {
               if (pickerApiLoaded) launchDrivePicker();
               else setTimeout(launchWhenReady, 100);
            };
            launchWhenReady();
          }
        },
      }));
    }

    tokenClient.requestAccessToken({ prompt: "" });
  });
}

export function launchDrivePicker() {
  if (window.__TAURI__?.core?.invoke) {
    alert("Tauri masaüstü sürümünde Google Picker penceresi desteklenmiyor.");
    return;
  }
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS).setMimeTypes("application/json,text/markdown,text/plain,application/octet-stream,application/zip");
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
