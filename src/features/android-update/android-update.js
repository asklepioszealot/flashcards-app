// src/features/android-update/android-update.js
// Custom in-app updater for the Android build.
//
// Tauri's bundled updater doesn't ship on Android, so we roll our own:
//   1. Poll GitHub Releases for the latest android-v* tag.
//   2. Compare its semver against the build-time BUILD_INFO.version.
//   3. If newer, hand the APK URL to the Rust download_and_install_apk
//      command, which forwards to the Kotlin DownloadManager bridge.

import { BUILD_INFO } from "../../generated/build-info.js";
import { isAndroidRuntime } from "../../core/runtime-config.js";
import { getTauriCoreApi } from "../desktop-update/desktop-update.js";

const REPO_RELEASES_LATEST_URL =
  "https://api.github.com/repos/asklepioszealot/flashcards-app/releases/latest";
const ANDROID_TAG_PREFIX = "android-v";

let inFlightCheck = false;

function parseSemver(value) {
  const match = String(value || "").trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewerVersion(remote, current) {
  const r = parseSemver(remote);
  const c = parseSemver(current);
  if (!r) return false;
  if (!c) return true;
  for (let index = 0; index < 3; index += 1) {
    if (r[index] > c[index]) return true;
    if (r[index] < c[index]) return false;
  }
  return false;
}

export async function fetchLatestAndroidRelease() {
  const response = await fetch(REPO_RELEASES_LATEST_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`GitHub Releases erişimi başarısız: HTTP ${response.status}`);
  }
  const release = await response.json();
  const tagName = String(release?.tag_name || "").trim();
  if (!tagName.startsWith(ANDROID_TAG_PREFIX)) {
    return null;
  }
  const version = tagName.slice(ANDROID_TAG_PREFIX.length);
  const apkAsset = (release?.assets || []).find((asset) =>
    String(asset?.name || "").toLowerCase().endsWith(".apk"),
  );
  if (!apkAsset?.browser_download_url) {
    throw new Error("Sürüm için APK dosyası bulunamadı.");
  }
  return {
    version,
    tagName,
    downloadUrl: apkAsset.browser_download_url,
    size: Number(apkAsset.size || 0),
    notes: String(release?.body || "").trim(),
  };
}

function buildPromptMessage(updateInfo) {
  const notesPreview = updateInfo.notes
    ? `\n\nSürüm notları:\n${
        updateInfo.notes.length > 400
          ? `${updateInfo.notes.slice(0, 400).trim()}...`
          : updateInfo.notes
      }`
    : "";
  return (
    `Yeni Android sürümü hazır: v${updateInfo.version}\n`
    + `Mevcut sürüm: v${BUILD_INFO.version}`
    + notesPreview
    + "\n\nŞimdi indirip kurmak ister misin?"
  );
}

export async function checkAndroidForUpdates(source = "manual") {
  const isManual = source === "manual";

  if (!isAndroidRuntime()) {
    if (isManual) {
      alert("Android güncelleyici sadece Android sürümünde kullanılabilir.");
    }
    return false;
  }
  if (inFlightCheck) {
    if (isManual) alert("Güncelleme kontrolü zaten sürüyor.");
    return false;
  }

  inFlightCheck = true;
  try {
    let updateInfo = null;
    try {
      updateInfo = await fetchLatestAndroidRelease();
    } catch (error) {
      console.error("[android-update] check failed:", error);
      if (isManual) {
        alert(
          typeof error === "string"
            ? error
            : error?.message || "Güncelleme kontrolü başarısız oldu.",
        );
      }
      return false;
    }

    if (!updateInfo) {
      if (isManual) alert("Henüz yeni bir Android sürümü yok.");
      return false;
    }
    if (!isNewerVersion(updateInfo.version, BUILD_INFO.version)) {
      if (isManual) {
        alert(`Zaten en güncel sürümdesin (v${BUILD_INFO.version}).`);
      }
      return false;
    }

    if (!confirm(buildPromptMessage(updateInfo))) {
      return false;
    }

    const invoke = getTauriCoreApi()?.invoke;
    if (typeof invoke !== "function") {
      throw new Error("Tauri çekirdeği bulunamadı.");
    }
    await invoke("download_and_install_apk", {
      url: updateInfo.downloadUrl,
      version: updateInfo.version,
    });
    return true;
  } catch (error) {
    console.error("[android-update] install failed:", error);
    alert(
      typeof error === "string"
        ? error
        : error?.message || "Güncelleme kurulamadı.",
    );
    return false;
  } finally {
    inFlightCheck = false;
  }
}
