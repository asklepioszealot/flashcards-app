// src/features/set-manager/set-manager.js
// Set import, export, list rendering, selection, deletion, and browser file handle management.

import {
  loadedSets, setLoadedSets,
  selectedSets, setSelectedSets,
  browserFileHandles,
  lastRemovedSets, setLastRemovedSets,
  currentUser,
  platformAdapter,
  storage,
} from "../../app/state.js";
import { nowIso, escapeMarkup } from "../../shared/utils.js";
import {
  WEB_FILE_SOURCE_PREFIX,
  BROWSER_FILE_HANDLE_DB_NAME,
  BROWSER_FILE_HANDLE_STORE,
} from "../../shared/constants.js";
import {
  normalizeSetRecord,
  backfillRawSource,
  parseSetText,
  slugify,
  generateId,
} from "../../core/set-codec.js";
import { isDesktopRuntime, hasSupabaseConfig } from "../../core/runtime-config.js";
import { getAssessmentLevel } from "../study/assessment.js";
import { parseApkgToSetRecord } from "../importers/apkg-import.js";
import { showUndoToast } from "./undo-toast.js";
import { renderIcon } from "../../ui/icons.js";
import { syncAnalyticsDashboard, syncAnalyticsVisibility } from "../analytics/analytics.js";

// ── Browser file handle IndexedDB persistence ──
let browserFileHandleDbPromise = null;

function supportsBrowserFileHandlePersistence() {
  return !isDesktopRuntime() && typeof window.indexedDB !== "undefined";
}

function openBrowserFileHandleDb() {
  if (!supportsBrowserFileHandlePersistence()) return Promise.resolve(null);
  if (browserFileHandleDbPromise) return browserFileHandleDbPromise;

  browserFileHandleDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(BROWSER_FILE_HANDLE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BROWSER_FILE_HANDLE_STORE)) {
        database.createObjectStore(BROWSER_FILE_HANDLE_STORE, { keyPath: "sourcePath" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Dosya eşleme veritabanı açılamadı."));
  }).catch((error) => {
    console.warn("Browser file handle DB unavailable:", error);
    browserFileHandleDbPromise = null;
    return null;
  });

  return browserFileHandleDbPromise;
}

async function persistBrowserFileHandle(sourcePath, handle) {
  const database = await openBrowserFileHandleDb();
  if (!database || !sourcePath || !handle) return false;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BROWSER_FILE_HANDLE_STORE, "readwrite");
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("Dosya bağlantısı saklanamadı."));
    transaction.objectStore(BROWSER_FILE_HANDLE_STORE).put({
      sourcePath,
      handle,
      updatedAt: nowIso(),
    });
  }).catch((error) => {
    console.warn("Browser file handle persist failed:", error);
    return false;
  });
}

async function readPersistedBrowserFileHandle(sourcePath) {
  const database = await openBrowserFileHandleDb();
  if (!database || !sourcePath) return null;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BROWSER_FILE_HANDLE_STORE, "readonly");
    const request = transaction.objectStore(BROWSER_FILE_HANDLE_STORE).get(sourcePath);
    request.onsuccess = () => resolve(request.result?.handle || null);
    request.onerror = () => reject(request.error || transaction.error || new Error("Dosya bağlantısı okunamadı."));
  }).catch((error) => {
    console.warn("Browser file handle restore failed:", error);
    return null;
  });
}

async function deletePersistedBrowserFileHandle(sourcePath) {
  const database = await openBrowserFileHandleDb();
  if (!database || !sourcePath) return false;

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(BROWSER_FILE_HANDLE_STORE, "readwrite");
    transaction.oncomplete = () => resolve(true);
    transaction.onerror = () => reject(transaction.error || new Error("Dosya bağlantısı silinemedi."));
    transaction.objectStore(BROWSER_FILE_HANDLE_STORE).delete(sourcePath);
  }).catch((error) => {
    console.warn("Browser file handle delete failed:", error);
    return false;
  });
}

export function bindBrowserFileHandle(sourcePath, handle) {
  if (!sourcePath || !handle) return;
  browserFileHandles.set(sourcePath, handle);
  void persistBrowserFileHandle(sourcePath, handle);
}

export function getBrowserFileHandle(sourcePath) {
  return sourcePath ? browserFileHandles.get(sourcePath) || null : null;
}

async function restoreBrowserFileHandle(sourcePath) {
  if (!sourcePath) return null;
  const activeHandle = getBrowserFileHandle(sourcePath);
  if (activeHandle) return activeHandle;
  const persistedHandle = await readPersistedBrowserFileHandle(sourcePath);
  if (persistedHandle) browserFileHandles.set(sourcePath, persistedHandle);
  return persistedHandle;
}

export async function restoreBrowserFileHandles(records) {
  const sourcePaths = (Array.isArray(records) ? records : [])
    .map((record) => record?.sourcePath)
    .filter((sourcePath) => isBrowserRelinkableSourcePath(sourcePath));

  for (const sourcePath of sourcePaths) {
    await restoreBrowserFileHandle(sourcePath);
  }
}

function getBrowserFilePickerTypes() {
  return [
    {
      description: "Flashcard setleri",
      accept: {
        "application/json": [".json"],
        "text/markdown": [".md"],
        "text/plain": [".txt"],
        "application/octet-stream": [".apkg"],
        "application/zip": [".apkg"],
      },
    },
  ];
}

async function promptBrowserFileHandle() {
  if (!supportsBrowserFileAccess()) return null;

  try {
    const handles = await window.showOpenFilePicker({
      multiple: false,
      types: getBrowserFilePickerTypes(),
    });
    const [handle] = Array.isArray(handles) ? handles : [];
    return handle?.kind === "file" ? handle : null;
  } catch (error) {
    if (error?.name === "AbortError") return null;
    throw error;
  }
}

async function resolveBrowserFileHandle(sourcePath) {
  const activeHandle = await restoreBrowserFileHandle(sourcePath);
  if (activeHandle) return activeHandle;
  const pickedHandle = await promptBrowserFileHandle();
  if (pickedHandle && sourcePath) bindBrowserFileHandle(sourcePath, pickedHandle);
  return pickedHandle;
}

async function primeBrowserLinkedSaveTargets(records) {
  const pendingSourcePaths = [...new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => record?.sourcePath)
      .filter((sourcePath) => isBrowserRelinkableSourcePath(sourcePath) && !getBrowserFileHandle(sourcePath)),
  )];

  for (const sourcePath of pendingSourcePaths) {
    const handle = await promptBrowserFileHandle();
    if (!handle) {
      return {
        ready: false,
        sourcePath,
      };
    }
    bindBrowserFileHandle(sourcePath, handle);
  }

  return {
    ready: true,
    sourcePath: null,
  };
}

export async function prepareBrowserSaveTargets(savePlan) {
  if (!Array.isArray(savePlan) || !savePlan.length) {
    return {
      ready: true,
      sourcePath: null,
    };
  }

  if (!isDesktopRuntime() && supportsBrowserFileAccess()) {
    for (const planEntry of savePlan) {
      const nextRecord = planEntry?.nextRecord;
      if (!nextRecord) continue;
      if (String(nextRecord.sourcePath || "").trim()) continue;

      const handle = await promptBrowserFileHandle();
      if (!handle) {
        return {
          ready: false,
          sourcePath: "",
        };
      }

      const fallbackBaseName = slugify(nextRecord.setName || "set") || "set";
      const fallbackExtension = nextRecord.sourceFormat === "markdown" ? "md" : "json";
      const fallbackFileName = `${fallbackBaseName}.${fallbackExtension}`;
      const nextFileName = String(nextRecord.fileName || fallbackFileName).trim() || fallbackFileName;
      const sourcePath = createWebFileSourcePath(nextFileName);
      nextRecord.sourcePath = sourcePath;
      bindBrowserFileHandle(sourcePath, handle);
    }
  }

  return primeBrowserLinkedSaveTargets(savePlan.map((entry) => entry?.nextRecord));
}

export async function ensureBrowserFileWritePermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return false;
  const permissionOptions = { mode: "readwrite" };
  if (await handle.queryPermission(permissionOptions) === "granted") return true;
  return (await handle.requestPermission(permissionOptions)) === "granted";
}

export async function writeBrowserLinkedSourceFile(sourcePath, rawSource) {
  const handle = await resolveBrowserFileHandle(sourcePath);
  if (!handle || typeof handle.createWritable !== "function") {
    return { wrote: false, relinkRequired: true };
  }
  const permissionGranted = await ensureBrowserFileWritePermission(handle);
  if (!permissionGranted) {
    throw new Error("Tarayıcı aynı dosyaya yazma izni vermedi. Dışa Aktar ile kopya alabilirsin.");
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(rawSource);
  } finally {
    await writable.close();
  }
  return { wrote: true, relinkRequired: false };
}

// ── Source path helpers ──
export function isWebLinkedSourcePath(sourcePath) {
  return String(sourcePath || "").startsWith(WEB_FILE_SOURCE_PREFIX);
}

export function isBrowserRelinkableSourcePath(sourcePath) {
  const normalizedSourcePath = String(sourcePath || "").trim();
  if (!normalizedSourcePath || isDesktopRuntime()) return false;
  if (/^https?:\/\//i.test(normalizedSourcePath)) return false;
  return true;
}

export function createWebFileSourcePath(fileName) {
  const safeName = slugify(String(fileName || "set").replace(/\.[^/.]+$/, "")) || "set";
  return `${WEB_FILE_SOURCE_PREFIX}${generateId("source")}/${safeName}`;
}

export function supportsBrowserFileAccess() {
  return !isDesktopRuntime()
    && typeof window.showOpenFilePicker === "function";
}

// ── Set collection normalization ──
export const normalizeSetCollection = (records) =>
  (Array.isArray(records) ? records : [])
    .map((record) => {
      const normalized = normalizeSetRecord(record, { previousRecord: record });
      return { ...normalized, rawSource: backfillRawSource(normalized) };
    })
    .sort((leftValue, rightValue) => {
      const leftTime = Date.parse(leftValue.updatedAt || "");
      const rightTime = Date.parse(rightValue.updatedAt || "");
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
      return leftValue.setName.localeCompare(rightValue.setName, "tr");
    });

// ── Source path persistence helpers (exported for study-state.js) ──
function normalizePersistedSetSourcePathMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([setId, sourcePath]) =>
          typeof setId === "string"
          && setId.trim()
          && typeof sourcePath === "string"
          && sourcePath.trim(),
      )
      .map(([setId, sourcePath]) => [setId.trim(), sourcePath.trim()]),
  );
}

function getPersistedSetSourcePathMap() {
  const { getUserJson } = _getStorageHelpers();
  return normalizePersistedSetSourcePathMap(getUserJson ? getUserJson("set_source_paths", {}) : {});
}

// We use a lazy reference to avoid circular import with study-state.js
let _getUserJson = null;
let _setUserJson = null;

function _getStorageHelpers() {
  return { getUserJson: _getUserJson, setUserJson: _setUserJson };
}

export function initStorageHelpers(getUserJson, setUserJson) {
  _getUserJson = getUserJson;
  _setUserJson = setUserJson;
}

export function syncPersistedSetSourcePaths() {
  if (!currentUser || !_setUserJson || !_getUserJson) return;
  const currentMap = getPersistedSetSourcePathMap();
  const nextMap = {};

  Object.entries(loadedSets).forEach(([setId, record]) => {
    const sourcePath = String(record?.sourcePath || currentMap[setId] || "").trim();
    if (sourcePath) nextMap[setId] = sourcePath;
  });

  if (JSON.stringify(currentMap) !== JSON.stringify(nextMap)) {
    _setUserJson("set_source_paths", nextMap);
  }
}

export function hydrateLoadedSets(records, persistedSourcePaths = {}) {
  const previousLoadedSets = loadedSets;
  const newLoadedSets = {};
  normalizeSetCollection(records).forEach((record) => {
    const previousRecord = previousLoadedSets[record.id];
    const resolvedSourcePath = String(
      record.sourcePath
      || previousRecord?.sourcePath
      || persistedSourcePaths[record.id]
      || "",
    ).trim();
    newLoadedSets[record.id] = resolvedSourcePath
      ? {
          ...record,
          sourcePath: resolvedSourcePath,
        }
      : record;
  });
  setLoadedSets(newLoadedSets);
}

export function findExistingSetMatch(fileName) {
  const fileStem = String(fileName || "").replace(/\.[^/.]+$/, "");
  const slug = slugify(fileStem);
  return Object.values(loadedSets).find((record) => record.fileName === fileName || record.slug === slug) || null;
}

function shouldImportAsApkg(fileName) {
  return /\.apkg$/i.test(String(fileName || ""));
}

function decodeBase64ToUint8Array(value) {
  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(String(value || ""), "base64"));
  }
  const binary = atob(String(value || ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function resolveExistingImportRecord(sourcePath, fileName) {
  return sourcePath
    ? Object.values(loadedSets).find((record) => record.sourcePath === sourcePath)
      || findExistingSetMatch(fileName)
    : findExistingSetMatch(fileName);
}

async function persistImportedRecord(nextRecord, existingRecord, options = {}) {
  const sourcePath = String(options.sourcePath || "").trim();
  const webFileHandle = options.webFileHandle || null;
  const allowSourceLink = options.allowSourceLink !== false;

  if (allowSourceLink && sourcePath) {
    nextRecord.sourcePath = sourcePath;
  } else if (allowSourceLink && webFileHandle) {
    nextRecord.sourcePath = existingRecord?.sourcePath || createWebFileSourcePath(nextRecord.fileName || `${slugify(nextRecord.setName)}.json`);
  } else if (allowSourceLink && existingRecord?.sourcePath) {
    nextRecord.sourcePath = existingRecord.sourcePath;
  } else {
    nextRecord.sourcePath = "";
  }

  const savedRecord = await platformAdapter.saveSet(nextRecord);
  if (allowSourceLink && webFileHandle && savedRecord?.sourcePath) {
    bindBrowserFileHandle(savedRecord.sourcePath, webFileHandle);
  }
  loadedSets[savedRecord.id] = savedRecord;
  syncPersistedSetSourcePaths();
  selectedSets.add(savedRecord.id);
  const { saveSelectedSets } = await import("../study-state/study-state.js");
  saveSelectedSets();
  renderSetList();
  return savedRecord;
}

export async function importSetFromText(text, fileName, sourcePath = "", webFileHandle = null) {
  const existingRecord = resolveExistingImportRecord(sourcePath, fileName);
  const nextRecord = parseSetText(text, fileName, existingRecord, existingRecord?.sourceFormat);
  return persistImportedRecord(nextRecord, existingRecord, {
    sourcePath,
    webFileHandle,
    allowSourceLink: true,
  });
}

export async function importSetFromBinary(arrayBuffer, fileName) {
  const existingRecord = resolveExistingImportRecord("", fileName);
  const nextRecord = await parseApkgToSetRecord(arrayBuffer, fileName, existingRecord);
  return persistImportedRecord(nextRecord, existingRecord, {
    allowSourceLink: false,
  });
}

async function importPickedFile(fileLike, sourcePath = "", webFileHandle = null) {
  const fileName = String(fileLike?.name || "").trim();
  if (!fileName) {
    throw new Error("Dosya adı okunamadı.");
  }

  if (shouldImportAsApkg(fileName)) {
    if (typeof fileLike.arrayBuffer === "function") {
      return importSetFromBinary(await fileLike.arrayBuffer(), fileName);
    }
    if (typeof fileLike.binaryBase64 === "string" && fileLike.binaryBase64.trim()) {
      const bytes = decodeBase64ToUint8Array(fileLike.binaryBase64);
      return importSetFromBinary(bytes.buffer, fileName);
    }
    throw new Error("APKG dosyası ikili olarak okunamadı.");
  }

  if (typeof fileLike.text === "function") {
    return importSetFromText(await fileLike.text(), fileName, sourcePath, webFileHandle);
  }
  if (typeof fileLike.contents === "string") {
    return importSetFromText(fileLike.contents, fileName, sourcePath, webFileHandle);
  }
  throw new Error("Dosya içeriği okunamadı.");
}

export async function tryBrowserFileSystemImport() {
  if (!supportsBrowserFileAccess()) return false;

  try {
    const handles = await window.showOpenFilePicker({
      multiple: true,
      types: [
        {
          description: "Flashcard setleri",
          accept: {
            "application/json": [".json"],
            "text/markdown": [".md"],
            "text/plain": [".txt"],
            "application/octet-stream": [".apkg"],
            "application/zip": [".apkg"],
          },
        },
      ],
    });
    if (!Array.isArray(handles) || handles.length === 0) return true;
    for (const handle of handles) {
      if (handle?.kind !== "file") continue;
      const file = await handle.getFile();
      await importPickedFile(file, "", handle);
      showUndoToast(`"${file.name}" yüklendi.`);
    }
    return true;
  } catch (error) {
    if (error?.name === "AbortError") return true;
    console.error(error);
    alert(error?.message || "Dosya seçimi sırasında hata oluştu.");
    return true;
  }
}

export async function triggerSetImport() {
  if (isDesktopRuntime() && typeof platformAdapter.pickNativeSetFiles === "function") {
    try {
      const files = await platformAdapter.pickNativeSetFiles();
      if (!Array.isArray(files) || files.length === 0) return;
      for (const file of files) {
        await importPickedFile(file, file.path || "");
        showUndoToast(`"${file.name}" yüklendi.`);
      }
    } catch (error) {
      console.error(error);
      alert(error.message || "Dosya seçimi sırasında hata oluştu.");
    }
    return;
  }

  if (await tryBrowserFileSystemImport()) {
    return;
  }

  document.getElementById("file-picker")?.click();
}

export async function handleFileSelect(event) {
  const files = event.target.files;
  if (!files?.length) return;
  for (const file of files) {
    try {
      await importPickedFile(file);
      showUndoToast(`"${file.name}" yüklendi.`);
    } catch (error) {
      console.error(error);
      alert(`${file.name} yüklenirken hata oluştu: ${error.message}`);
    }
  }
  event.target.value = "";
}

export function toggleSetSelection(setId) {
  if (selectedSets.has(setId)) selectedSets.delete(setId);
  else selectedSets.add(setId);
  import("../study-state/study-state.js").then(({ saveSelectedSets }) => saveSelectedSets());
  renderSetList();
}

export function toggleSetCheck(setId) {
  toggleSetSelection(setId);
}

export async function deleteSet(setId) {
  await removeSets([setId]);
}

export async function removeSets(setIds) {
  const removedEntries = setIds
    .map((setId) => ({ setId, setData: loadedSets[setId], wasSelected: selectedSets.has(setId) }))
    .filter((entry) => entry.setData);
  if (!removedEntries.length) return;
  try {
    await platformAdapter.deleteSets(removedEntries.map((entry) => entry.setId));
    removedEntries.forEach((entry) => {
      if (isBrowserRelinkableSourcePath(entry.setData?.sourcePath)) {
        browserFileHandles.delete(entry.setData.sourcePath);
        void deletePersistedBrowserFileHandle(entry.setData.sourcePath);
      }
      delete loadedSets[entry.setId];
      selectedSets.delete(entry.setId);
    });
    syncPersistedSetSourcePaths();
    const { saveSelectedSets } = await import("../study-state/study-state.js");
    saveSelectedSets();
    renderSetList();
    setLastRemovedSets(removedEntries);
    showUndoToast(removedEntries.length === 1 ? "Set kaldırıldı." : `${removedEntries.length} set kaldırıldı.`);
  } catch (error) {
    console.error(error);
    showUndoToast("Setler kaldırılamadı.");
  }
}

export function selectAllSets() {
  setSelectedSets(new Set(Object.keys(loadedSets)));
  import("../study-state/study-state.js").then(({ saveSelectedSets }) => saveSelectedSets());
  renderSetList();
}

export function clearSetSelection() {
  selectedSets.clear();
  import("../study-state/study-state.js").then(({ saveSelectedSets }) => saveSelectedSets());
  renderSetList();
}

export function toggleBulkSetSelection() {
  const totalSetCount = Object.keys(loadedSets).length;
  const selectionCount = selectedSets.size;
  if (!totalSetCount) return;
  if (selectionCount === totalSetCount) {
    clearSetSelection();
    return;
  }
  selectAllSets();
}

export async function removeSelectedSets() {
  if (!selectedSets.size) return;
  await removeSets([...selectedSets]);
}

export function updateManagerUserChip() {
  const chip = document.getElementById("manager-user-chip");
  const signOutButton = document.getElementById("sign-out-btn");
  if (chip) {
    const runtimeLabel = hasSupabaseConfig()
      ? window.__TAURI__?.core?.invoke ? "Bulut + Masaüstü Cache" : "Bulut"
      : window.__TAURI__?.core?.invoke ? "Yerel Demo + Masaüstü Cache" : "Yerel Demo";
    chip.textContent = currentUser ? `Hesap: ${currentUser.email || currentUser.id} · ${runtimeLabel}` : "Hesap: oturum kapalı";
  }
  if (signOutButton) signOutButton.disabled = !currentUser;
  import("../desktop-update/desktop-update.js").then(({ syncDesktopUpdateButton }) => syncDesktopUpdateButton());
}

export function updateSetListScrollState(listElement, setCount) {
  if (!listElement) return;
  listElement.classList.remove("set-list--scrollable");
  listElement.style.removeProperty("--set-list-max-height");
  if (setCount <= 2) return;

  const rows = [...listElement.querySelectorAll(".set-item:not(.empty)")];
  if (rows.length < 2) return;

  const visibleHeight = rows
    .slice(0, 2)
    .reduce((totalHeight, row) => totalHeight + row.getBoundingClientRect().height, 0);
  const computedStyle = window.getComputedStyle(listElement);
  const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
  const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
  listElement.style.setProperty("--set-list-max-height", `${Math.ceil(visibleHeight + paddingTop + paddingBottom + 6)}px`);
  listElement.classList.add("set-list--scrollable");
}

function setActionButtonContent(button, iconName, label) {
  if (!button) return;
  const safeLabel = escapeMarkup(label);
  button.innerHTML = `${renderIcon(iconName)}<span>${safeLabel}</span>`;
}

export function renderSetList() {
  const listElement = document.getElementById("set-list");
  const toolsElement = document.getElementById("set-list-tools");
  const startButton = document.getElementById("start-btn");
  const removeSelectedButton = document.getElementById("remove-selected-btn");
  const editSelectedButton = document.getElementById("edit-selected-btn");
  const bulkToggle = document.getElementById("set-bulk-toggle");
  const bulkToggleTitle = document.getElementById("set-bulk-toggle-title");
  const bulkToggleMeta = document.getElementById("set-bulk-toggle-meta");
  if (!listElement) return;
  const setIds = Object.keys(loadedSets);
  if (!setIds.length) {
    listElement.innerHTML = '<div class="set-item empty">Henüz set yüklenmedi.</div>';
    listElement.classList.remove("set-list--scrollable");
    listElement.style.removeProperty("--set-list-max-height");
    if (toolsElement) toolsElement.style.display = "none";
    if (startButton) startButton.disabled = true;
    if (removeSelectedButton) {
      removeSelectedButton.disabled = true;
      setActionButtonContent(removeSelectedButton, "trash-2", "Seçilileri Kaldır (0)");
    }
    if (editSelectedButton) editSelectedButton.disabled = true;
    if (editSelectedButton) setActionButtonContent(editSelectedButton, "edit", "Kartları Düzenle (0)");
    syncAnalyticsVisibility();
    syncAnalyticsDashboard();
    return;
  }
  if (toolsElement) toolsElement.style.display = "flex";
  if (startButton) startButton.disabled = selectedSets.size === 0;
  if (removeSelectedButton) {
    removeSelectedButton.disabled = selectedSets.size === 0;
    setActionButtonContent(removeSelectedButton, "trash-2", `Seçilileri Kaldır (${selectedSets.size})`);
  }
  if (editSelectedButton) {
    editSelectedButton.disabled = selectedSets.size === 0;
    setActionButtonContent(editSelectedButton, "edit", `Kartları Düzenle (${selectedSets.size})`);
  }
  const selectionCount = selectedSets.size;
  const selectionLabel = "DERS SEÇİMİ";
  const selectionState = selectionCount === 0 ? "none" : selectionCount === setIds.length ? "all" : "partial";
  if (bulkToggle) {
    bulkToggle.dataset.selectionState = selectionState;
    bulkToggle.setAttribute(
      "aria-label",
      selectionState === "all"
        ? `${selectionLabel} için tümünü kaldır`
        : `${selectionLabel} için tümünü seç`,
    );
    bulkToggle.title = selectionState === "all"
      ? `${selectionLabel}: tümünü kaldır`
      : `${selectionLabel}: tümünü seç`;
  }
  if (bulkToggleTitle) bulkToggleTitle.textContent = selectionLabel;
  if (bulkToggleMeta) bulkToggleMeta.textContent = `${selectionCount}/${setIds.length} seçili`;
  listElement.innerHTML = "";
  setIds.forEach((setId) => {
    const setRecord = loadedSets[setId];
    let know = 0;
    let review = 0;
    let dunno = 0;
    setRecord.cards.forEach((card, index) => {
      const status = getAssessmentLevel(card, setId, index);
      if (status === "know") know += 1;
      else if (status === "review") review += 1;
      else if (status === "dunno") dunno += 1;
    });
    const total = setRecord.cards.length;
    const assessed = know + review + dunno;
    const isSelected = selectedSets.has(setId);
    const setIdAttr = escapeMarkup(setId);
    const setName = escapeMarkup(setRecord.setName);
    const row = document.createElement("div");
    row.className = "set-item";
    row.innerHTML = `
      <div class="set-info" data-set-select="${setIdAttr}">
        <input
          type="checkbox"
          ${isSelected ? "checked" : ""}
          data-set-checkbox="${setIdAttr}"
          name="set-selection-${setIdAttr}"
          aria-label="${setName} seçim kutusu"
        >
        <div class="set-details">
          <div class="set-title">${setName}</div>
          <div class="set-stats">${total} kart — ${assessed}/${total} (%${total ? Math.round((assessed / total) * 100) : 0}) tamam</div>
        </div>
      </div>
      <div class="set-actions-row">
        <button class="btn-delete-circle" title="Seti kaldır" aria-label="Seti kaldır" data-set-delete="${setIdAttr}">${renderIcon("trash-2")}</button>
      </div>`;
    listElement.appendChild(row);
  });
  listElement.querySelectorAll("[data-set-select]").forEach((element) => {
    element.addEventListener("click", () => toggleSetCheck(element.getAttribute("data-set-select")));
  });
  listElement.querySelectorAll("[data-set-checkbox]").forEach((element) => {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleSetCheck(element.getAttribute("data-set-checkbox"));
    });
  });
  listElement.querySelectorAll("[data-set-delete]").forEach((element) => {
    element.addEventListener("click", async (event) => {
      event.stopPropagation();
      await deleteSet(element.getAttribute("data-set-delete"));
    });
  });
  updateSetListScrollState(listElement, setIds.length);
  syncAnalyticsVisibility();
  syncAnalyticsDashboard();
}
