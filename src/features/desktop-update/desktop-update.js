// src/features/desktop-update/desktop-update.js
// Tauri desktop update check and installation.

import { desktopUpdateState } from "../../app/state.js";
import { DESKTOP_UPDATE_DEFAULT_LABEL } from "../../shared/constants.js";
import { isDesktopRuntime } from "../../core/runtime-config.js";

export function getTauriCoreApi() {
  return window.__TAURI__?.core || null;
}

export function isWindowsDesktopClient() {
  if (!isDesktopRuntime() || typeof getTauriCoreApi()?.invoke !== "function") {
    return false;
  }

  const runtimeFingerprint = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  return runtimeFingerprint.includes("win");
}

export function syncDesktopUpdateButton() {
  const button = document.getElementById("check-updates-btn");
  if (!button) return;

  if (!isWindowsDesktopClient()) {
    button.hidden = true;
    button.disabled = true;
    return;
  }

  button.hidden = false;
  button.disabled = desktopUpdateState.isChecking || desktopUpdateState.isInstalling;
  button.textContent = desktopUpdateState.buttonLabel;
}

export function setDesktopUpdateButtonLabel(label = DESKTOP_UPDATE_DEFAULT_LABEL) {
  desktopUpdateState.buttonLabel = label;
  syncDesktopUpdateButton();
}

export async function closeDesktopUpdateResource(rid) {
  const core = getTauriCoreApi();
  if (!core || !Number.isInteger(rid)) return;

  try {
    await core.invoke("plugin:resources|close", { rid });
  } catch {
    // Best effort cleanup for declined or failed update checks.
  }
}

export function getDesktopUpdateNotes(updateMetadata) {
  const rawNotes =
    typeof updateMetadata?.body === "string" && updateMetadata.body.trim()
      ? updateMetadata.body.trim()
      : typeof updateMetadata?.rawJson?.notes === "string" && updateMetadata.rawJson.notes.trim()
        ? updateMetadata.rawJson.notes.trim()
        : "";

  if (!rawNotes) return "";
  return rawNotes.length > 600 ? `${rawNotes.slice(0, 600).trim()}...` : rawNotes;
}

export function formatDesktopUpdatePrompt(updateMetadata) {
  const notes = getDesktopUpdateNotes(updateMetadata);
  const parts = [
    `Yeni masaüstü sürümü hazır: v${updateMetadata.version}`,
    `Mevcut sürüm: v${updateMetadata.currentVersion}`,
  ];

  if (notes) {
    parts.push(`Sürüm notları:\n${notes}`);
  }

  parts.push("Şimdi indirip kurmak ister misin?");
  return parts.join("\n\n");
}

export function createDesktopUpdateChannel(onEvent) {
  const Channel = getTauriCoreApi()?.Channel;
  if (typeof Channel !== "function") return null;

  const channel = new Channel();
  channel.onmessage = onEvent;
  return channel;
}

export async function installDesktopUpdate(updateMetadata) {
  const core = getTauriCoreApi();
  if (!core) {
    throw new Error("Tauri çekirdeği bulunamadı.");
  }

  let downloadedBytes = 0;
  let contentLength = 0;
  desktopUpdateState.isInstalling = true;
  setDesktopUpdateButtonLabel("İndiriliyor...");

  try {
    const channel = createDesktopUpdateChannel((event) => {
      if (!event || typeof event !== "object") return;

      switch (event.event) {
        case "Started":
          contentLength = Number(event.data?.contentLength || 0);
          setDesktopUpdateButtonLabel("İndiriliyor...");
          break;
        case "Progress":
          downloadedBytes += Number(event.data?.chunkLength || 0);
          if (contentLength > 0) {
            const progress = Math.min(99, Math.max(1, Math.round((downloadedBytes / contentLength) * 100)));
            setDesktopUpdateButtonLabel(`İndiriliyor %${progress}`);
          } else {
            setDesktopUpdateButtonLabel("İndiriliyor...");
          }
          break;
        case "Finished":
          setDesktopUpdateButtonLabel("Kuruluyor...");
          break;
        default:
          break;
      }
    });

    const args = { rid: updateMetadata.rid };
    if (channel) args.onEvent = channel;

    await core.invoke("plugin:updater|download_and_install", args);
    setDesktopUpdateButtonLabel("Yeniden başlatılıyor...");
    await core.invoke("plugin:process|restart");
  } catch (error) {
    await closeDesktopUpdateResource(updateMetadata.rid);
    throw error;
  } finally {
    desktopUpdateState.isInstalling = false;
    setDesktopUpdateButtonLabel();
  }
}

export async function checkDesktopForUpdates(source = "manual") {
  const isManualCheck = source === "manual";

  if (!isWindowsDesktopClient()) {
    if (isManualCheck) {
      alert("Masaüstü güncellemesi yalnızca Windows desktop sürümünde kullanılabilir.");
    }
    return false;
  }

  if (desktopUpdateState.isChecking || desktopUpdateState.isInstalling) {
    if (isManualCheck) {
      alert("Güncelleme kontrolü zaten sürüyor.");
    }
    return false;
  }

  desktopUpdateState.isChecking = true;
  if (isManualCheck) {
    setDesktopUpdateButtonLabel("Kontrol ediliyor...");
  }

  try {
    const updateMetadata = await getTauriCoreApi().invoke("plugin:updater|check");
    if (!updateMetadata) {
      if (isManualCheck) {
        alert("Yeni bir masaüstü sürümü bulunamadı.");
      }
      return false;
    }

    const shouldInstall = confirm(formatDesktopUpdatePrompt(updateMetadata));
    if (!shouldInstall) {
      await closeDesktopUpdateResource(updateMetadata.rid);
      return false;
    }

    await installDesktopUpdate(updateMetadata);
    return true;
  } catch (error) {
    console.error(error);
    if (isManualCheck) {
      alert(error.message || "Güncelleme kontrolü başarısız oldu.");
    }
    return false;
  } finally {
    desktopUpdateState.isChecking = false;
    if (!desktopUpdateState.isInstalling) {
      setDesktopUpdateButtonLabel();
    }
    if (source === "startup") {
      desktopUpdateState.startupCheckCompleted = true;
    }
  }
}

export function scheduleStartupDesktopUpdateCheck() {
  if (
    !isWindowsDesktopClient()
    || desktopUpdateState.startupCheckScheduled
    || desktopUpdateState.startupCheckCompleted
  ) {
    return;
  }

  desktopUpdateState.startupCheckScheduled = true;
  window.setTimeout(() => {
    void checkDesktopForUpdates("startup");
  }, 0);
}
