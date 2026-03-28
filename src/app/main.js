import { createPlatformAdapter } from "../core/platform-adapter.js";
import { hasSupabaseConfig, isDesktopRuntime } from "../core/runtime-config.js";
import {
  backfillRawSource,
  buildEditorDraft,
  buildSetFromEditorDraft,
  generateId,
  normalizeSetRecord,
  parseSetText,
  renderAnswerMarkdown,
  slugify,
} from "../core/set-codec.js";

const APP_NAMESPACE = "fc_v2";
const THEME_KEY = "fc_theme";
const THEME_CONTROL_IDS = ["theme-select-auth", "theme-select-manager", "theme-select-study", "theme-select-editor"];
const AUTH_REMEMBER_ME_KEY = `${APP_NAMESPACE}::auth::remember_me`;
const LEGACY_KEYS = {
  session: "fc_session",
  sets: "fc_loaded_sets",
  assessments: "fc_assessments",
  autoAdvance: "fc_auto_advance",
  selectedSets: "fc_selected_sets",
  legacyState: "flashcards_state_v6",
};
const USER_STUDY_STATE_KEY = "study_state_sync";
const USER_SET_SOURCE_PATHS_KEY = "set_source_paths";
const WEB_FILE_SOURCE_PREFIX = "webfile://";
const BROWSER_FILE_HANDLE_DB_NAME = `${APP_NAMESPACE}::browser-file-handles`;
const BROWSER_FILE_HANDLE_STORE = "handles";

const DRIVE_CLIENT_ID = "102976125468-1mq0m7ptikns377eso8gmnaaioac17fv.apps.googleusercontent.com";
const DRIVE_API_KEY = "AIzaSyCUvy3PvFNpAVL9FYvLF22lzUPJ9xZHWrw";
const DRIVE_APP_ID = "102976125468";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

const storage = window.AppStorage;
const platformAdapter = createPlatformAdapter(storage);

let currentUser = null;
let loadedSets = {};
let selectedSets = new Set();
let lastRemovedSets = [];
let undoTimeoutId = null;

let currentCardIndex = 0;
let isFlipped = false;
let allFlashcards = [];
let filteredFlashcards = [];
let cardOrder = [];
let assessments = {};
let activeFilter = "all";
let isFullscreen = false;
let autoAdvanceEnabled = true;
let authStateToken = 0;
let currentScreen = "auth";

let editorState = {
  isOpen: false,
  activeSetId: null,
  draftOrder: [],
  drafts: {},
  focusedField: null,
  pendingScrollCardId: null,
};

const DESKTOP_UPDATE_DEFAULT_LABEL = "Güncellemeleri Kontrol Et";
const desktopUpdateState = {
  startupCheckScheduled: false,
  startupCheckCompleted: false,
  isChecking: false,
  isInstalling: false,
  buttonLabel: DESKTOP_UPDATE_DEFAULT_LABEL,
};

let tokenClient = null;
let driveAccessToken = null;
let pickerApiLoaded = false;
let pendingRemoteStudyStateSnapshot = null;
let remoteStudyStateSyncTimer = null;
let editorSplitDragState = null;
const browserFileHandles = new Map();
let browserFileHandleDbPromise = null;

const safeJsonParse = (rawValue, fallbackValue) => {
  if (!rawValue) return fallbackValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
};

const nowIso = () => new Date().toISOString();
const userScopedStorageKey = (key) => `${APP_NAMESPACE}::user::${currentUser?.id || "anonymous"}::${key}`;
const getUserJson = (key, fallbackValue) => safeJsonParse(storage.getItem(userScopedStorageKey(key)), fallbackValue);
const setUserJson = (key, value) => storage.setItem(userScopedStorageKey(key), JSON.stringify(value));
const getUserText = (key) => storage.getItem(userScopedStorageKey(key));
const setUserText = (key, value) => storage.setItem(userScopedStorageKey(key), value);
const getLocalStorageText = (key) =>
  typeof storage.getLocalItem === "function" ? storage.getLocalItem(key) : storage.getItem(key);
const setLocalStorageText = (key, value) =>
  typeof storage.setLocalItem === "function" ? storage.setLocalItem(key, value) : storage.setItem(key, value);
const cloneData = (value) => JSON.parse(JSON.stringify(value));
const normalizeSetCollection = (records) =>
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
  return normalizePersistedSetSourcePathMap(getUserJson(USER_SET_SOURCE_PATHS_KEY, {}));
}

function syncPersistedSetSourcePaths() {
  if (!currentUser) return;
  const currentMap = getPersistedSetSourcePathMap();
  const nextMap = {};

  Object.entries(loadedSets).forEach(([setId, record]) => {
    const sourcePath = String(record?.sourcePath || currentMap[setId] || "").trim();
    if (sourcePath) nextMap[setId] = sourcePath;
  });

  if (JSON.stringify(currentMap) !== JSON.stringify(nextMap)) {
    setUserJson(USER_SET_SOURCE_PATHS_KEY, nextMap);
  }
}

function supportsBrowserFileAccess() {
  return !isDesktopRuntime()
    && typeof window.showOpenFilePicker === "function";
}

function isWebLinkedSourcePath(sourcePath) {
  return String(sourcePath || "").startsWith(WEB_FILE_SOURCE_PREFIX);
}

function isBrowserRelinkableSourcePath(sourcePath) {
  const normalizedSourcePath = String(sourcePath || "").trim();
  if (!normalizedSourcePath || isDesktopRuntime()) return false;
  if (/^https?:\/\//i.test(normalizedSourcePath)) return false;
  return true;
}

function createWebFileSourcePath(fileName) {
  const safeName = slugify(String(fileName || "set").replace(/\.[^/.]+$/, "")) || "set";
  return `${WEB_FILE_SOURCE_PREFIX}${generateId("source")}/${safeName}`;
}

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

function bindBrowserFileHandle(sourcePath, handle) {
  if (!sourcePath || !handle) return;
  browserFileHandles.set(sourcePath, handle);
  void persistBrowserFileHandle(sourcePath, handle);
}

function getBrowserFileHandle(sourcePath) {
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

async function restoreBrowserFileHandles(records) {
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

async function ensureBrowserFileWritePermission(handle) {
  if (!handle || typeof handle.queryPermission !== "function") return false;
  const permissionOptions = { mode: "readwrite" };
  if (await handle.queryPermission(permissionOptions) === "granted") return true;
  return (await handle.requestPermission(permissionOptions)) === "granted";
}

async function writeBrowserLinkedSourceFile(sourcePath, rawSource) {
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

function buildCardKey(setId, card, index) {
  const normalizedSetId = String(setId ?? "unknown");
  const cardIdValue = card?.id != null ? String(card.id).trim() : "";
  return cardIdValue ? `set:${normalizedSetId}::id:${cardIdValue}` : `set:${normalizedSetId}::idx:${index}`;
}

function legacyCardId(cardOrQuestion) {
  const question = typeof cardOrQuestion === "string" ? cardOrQuestion : typeof cardOrQuestion?.q === "string" ? cardOrQuestion.q : "";
  let hash = 0;
  for (let index = 0; index < question.length; index += 1) {
    hash = ((hash << 5) - hash + question.charCodeAt(index)) | 0;
  }
  return `c${Math.abs(hash)}`;
}

function getCardKey(card, fallbackSetId, fallbackIndex) {
  if (card?.__cardKey) return card.__cardKey;
  if (typeof fallbackSetId === "string" && Number.isInteger(fallbackIndex)) {
    return buildCardKey(fallbackSetId, card, fallbackIndex);
  }
  if (typeof card?.__setId === "string" && Number.isInteger(card?.__setIndex)) {
    return buildCardKey(card.__setId, card, card.__setIndex);
  }
  return null;
}

function getAssessmentLevel(card, fallbackSetId, fallbackIndex) {
  const cardKey = getCardKey(card, fallbackSetId, fallbackIndex);
  if (cardKey && assessments[cardKey]) return assessments[cardKey];
  return assessments[legacyCardId(card)] || null;
}

function setStatus(elementId, message, tone = "") {
  const element = document.getElementById(elementId);
  if (!element) return;
  const baseClass = elementId.startsWith("auth") ? "auth-status" : "editor-status";
  element.className = tone ? `${baseClass} ${tone}` : baseClass;
  element.textContent = message || "";
}

const showAuthStatus = (message, tone = "") => setStatus("auth-status", message, tone);
const showEditorStatus = (message, tone = "") => setStatus("editor-status", message, tone);
const escapeMarkup = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function summarizeMarkdownText(value, maxLength = 160) {
  const normalized = String(value ?? "")
    .replace(/[`*_~>#|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Açıklama eklenmedi.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

function getRememberMePreference() {
  const storedValue = getLocalStorageText(AUTH_REMEMBER_ME_KEY);
  if (storedValue === "0") return false;
  if (storedValue === "1") return true;
  return true;
}

function setRememberMePreference(rememberMe) {
  setLocalStorageText(AUTH_REMEMBER_ME_KEY, rememberMe ? "1" : "0");
}

function readRememberMeFromForm() {
  return document.getElementById("auth-remember-me")?.checked !== false;
}

function syncRememberMeUi() {
  const checkbox = document.getElementById("auth-remember-me");
  if (checkbox) checkbox.checked = getRememberMePreference();
}

const primaryMarkdownActions = [
  { id: "undo", label: "↶", title: "Geri al" },
  { id: "redo", label: "↷", title: "İleri al" },
  { id: "bold", label: "B", title: "Kalın" },
  { id: "critical", label: "!!", title: "Kritik vurgu" },
  { id: "warning", label: "⚠", title: "Uyarı kutusu" },
  { id: "bulletList", label: "• Liste", title: "Madde işaretli liste" },
  { id: "numberList", label: "1. Liste", title: "Numaralı liste" },
];

const overflowMarkdownActions = [
  { id: "italic", label: "I", title: "İtalik" },
  { id: "strike", label: "S", title: "Üstü çizili" },
  { id: "heading", label: "H2", title: "Başlık" },
  { id: "quote", label: "> Alıntı", title: "Alıntı" },
  { id: "link", label: "Link", title: "Bağlantı ekle" },
  { id: "code", label: "</>", title: "Kod" },
  { id: "divider", label: "---", title: "Ayraç" },
  { id: "table", label: "Tablo", title: "Tablo şablonu" },
];
const allMarkdownActions = [...primaryMarkdownActions, ...overflowMarkdownActions];

const DEFAULT_EDITOR_FIELD_HEIGHTS = Object.freeze({
  question: 170,
  answer: 220,
  preview: 240,
});

const MIN_EDITOR_FIELD_HEIGHTS = Object.freeze({
  question: 136,
  answer: 184,
  preview: 220,
});
const DEFAULT_EDITOR_SPLIT_RATIO = 56;
const MIN_EDITOR_SPLIT_RATIO = 40;
const MAX_EDITOR_SPLIT_RATIO = 60;
const EDITOR_SPLIT_KEYBOARD_STEP = 2;
const MIN_EDITOR_RAW_HEIGHT = 240;

const MAX_EDITOR_HISTORY_LENGTH = 120;

function markAppReady() {
  document.body.classList.remove("app-booting");
  scheduleStartupDesktopUpdateCheck();
}

function getTauriCoreApi() {
  return window.__TAURI__?.core || null;
}

function isWindowsDesktopClient() {
  if (!isDesktopRuntime() || typeof getTauriCoreApi()?.invoke !== "function") {
    return false;
  }

  const runtimeFingerprint = `${navigator.userAgent || ""} ${navigator.platform || ""}`.toLowerCase();
  return runtimeFingerprint.includes("win");
}

function syncDesktopUpdateButton() {
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

function setDesktopUpdateButtonLabel(label = DESKTOP_UPDATE_DEFAULT_LABEL) {
  desktopUpdateState.buttonLabel = label;
  syncDesktopUpdateButton();
}

async function closeDesktopUpdateResource(rid) {
  const core = getTauriCoreApi();
  if (!core || !Number.isInteger(rid)) return;

  try {
    await core.invoke("plugin:resources|close", { rid });
  } catch {
    // Best effort cleanup for declined or failed update checks.
  }
}

function getDesktopUpdateNotes(updateMetadata) {
  const rawNotes =
    typeof updateMetadata?.body === "string" && updateMetadata.body.trim()
      ? updateMetadata.body.trim()
      : typeof updateMetadata?.rawJson?.notes === "string" && updateMetadata.rawJson.notes.trim()
        ? updateMetadata.rawJson.notes.trim()
        : "";

  if (!rawNotes) return "";
  return rawNotes.length > 600 ? `${rawNotes.slice(0, 600).trim()}...` : rawNotes;
}

function formatDesktopUpdatePrompt(updateMetadata) {
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

function createDesktopUpdateChannel(onEvent) {
  const Channel = getTauriCoreApi()?.Channel;
  if (typeof Channel !== "function") return null;

  const channel = new Channel();
  channel.onmessage = onEvent;
  return channel;
}

async function installDesktopUpdate(updateMetadata) {
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

async function checkDesktopForUpdates(source = "manual") {
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

function scheduleStartupDesktopUpdateCheck() {
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

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeStudyStateSnapshot(snapshot, fallback = {}) {
  return {
    selectedSetIds: Array.isArray(snapshot?.selectedSetIds)
      ? snapshot.selectedSetIds.filter((setId) => typeof setId === "string" && setId.trim())
      : Array.isArray(fallback.selectedSetIds)
        ? fallback.selectedSetIds
        : [],
    assessments: isPlainObject(snapshot?.assessments)
      ? cloneData(snapshot.assessments)
      : isPlainObject(fallback.assessments)
        ? cloneData(fallback.assessments)
        : {},
    session: isPlainObject(snapshot?.session)
      ? cloneData(snapshot.session)
      : isPlainObject(fallback.session)
        ? cloneData(fallback.session)
        : null,
    autoAdvanceEnabled: snapshot?.autoAdvanceEnabled !== undefined
      ? snapshot.autoAdvanceEnabled !== false
      : fallback.autoAdvanceEnabled !== undefined
        ? fallback.autoAdvanceEnabled !== false
        : true,
    updatedAt: snapshot?.updatedAt
      ? String(snapshot.updatedAt)
      : fallback.updatedAt
        ? String(fallback.updatedAt)
        : "",
  };
}

function getLegacyStudyStateSnapshot() {
  const storedSelected = getUserJson("selected_sets", []);
  const storedAssessments = getUserJson("assessments", {});
  const storedSession = getUserJson("session", null);
  const autoAdvanceRaw = getUserText("auto_advance");
  return normalizeStudyStateSnapshot({
    selectedSetIds: Array.isArray(storedSelected) ? storedSelected : [],
    assessments: isPlainObject(storedAssessments) ? storedAssessments : {},
    session: isPlainObject(storedSession) ? storedSession : null,
    autoAdvanceEnabled: autoAdvanceRaw === null ? true : autoAdvanceRaw === "1",
    updatedAt: null,
  });
}

function getPersistedStudyStateSnapshot() {
  const syncedSnapshot = getUserJson(USER_STUDY_STATE_KEY, null);
  if (isPlainObject(syncedSnapshot)) {
    return normalizeStudyStateSnapshot(syncedSnapshot);
  }
  return getLegacyStudyStateSnapshot();
}

function buildCurrentStudyStateSnapshot(options = {}) {
  const persistedSession = getPersistedStudyStateSnapshot().session;
  const activeCard = filteredFlashcards.length > 0 ? filteredFlashcards[cardOrder[currentCardIndex]] : null;
  return normalizeStudyStateSnapshot({
    selectedSetIds: [...selectedSets],
    assessments,
    session: {
      currentCardIndex: activeCard ? currentCardIndex : Number.isInteger(persistedSession?.currentCardIndex) ? persistedSession.currentCardIndex : 0,
      currentCardKey: activeCard ? getCardKey(activeCard) : typeof persistedSession?.currentCardKey === "string" ? persistedSession.currentCardKey : null,
      topic: document.getElementById("topic-select")?.value || persistedSession?.topic || "hepsi",
      activeFilter: activeFilter || persistedSession?.activeFilter || "all",
      autoAdvanceEnabled,
    },
    autoAdvanceEnabled,
    updatedAt: options.updatedAt || nowIso(),
  });
}

function persistStudyStateSnapshot(snapshot) {
  if (!currentUser) return;
  const normalizedSnapshot = normalizeStudyStateSnapshot(snapshot);
  setUserJson(USER_STUDY_STATE_KEY, normalizedSnapshot);
  setUserJson("selected_sets", normalizedSnapshot.selectedSetIds);
  setUserJson("assessments", normalizedSnapshot.assessments);
  setUserText("auto_advance", normalizedSnapshot.autoAdvanceEnabled ? "1" : "0");
  setUserJson("session", normalizedSnapshot.session);
}

function pickNewerStudyStateSnapshot(localSnapshot, remoteSnapshot) {
  const normalizedLocal = localSnapshot ? normalizeStudyStateSnapshot(localSnapshot) : null;
  const normalizedRemote = remoteSnapshot ? normalizeStudyStateSnapshot(remoteSnapshot) : null;
  if (!normalizedLocal) return normalizedRemote;
  if (!normalizedRemote) return normalizedLocal;

  const localTime = Date.parse(normalizedLocal.updatedAt || "");
  const remoteTime = Date.parse(normalizedRemote.updatedAt || "");
  if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
    return remoteTime > localTime ? normalizedRemote : normalizedLocal;
  }
  if (Number.isFinite(remoteTime)) return normalizedRemote;
  return normalizedLocal;
}

function applyStudyStateSnapshot(snapshot) {
  const normalizedSnapshot = normalizeStudyStateSnapshot(snapshot);
  selectedSets = normalizedSnapshot.selectedSetIds.length
    ? new Set(normalizedSnapshot.selectedSetIds.filter((setId) => loadedSets[setId]))
    : new Set(Object.keys(loadedSets));
  assessments = isPlainObject(normalizedSnapshot.assessments) ? normalizedSnapshot.assessments : {};
  if (!assessments || Array.isArray(assessments)) assessments = {};
  autoAdvanceEnabled = normalizedSnapshot.autoAdvanceEnabled !== false;
  syncAutoAdvanceToggleUI();
}

async function flushRemoteStudyStateSync() {
  if (!currentUser || typeof platformAdapter.saveUserState !== "function" || !pendingRemoteStudyStateSnapshot) return;
  const snapshotToSync = normalizeStudyStateSnapshot(pendingRemoteStudyStateSnapshot);
  pendingRemoteStudyStateSnapshot = null;
  try {
    const remoteSnapshot = await platformAdapter.saveUserState(snapshotToSync);
    if (remoteSnapshot) {
      persistStudyStateSnapshot(remoteSnapshot);
    }
  } catch (error) {
    console.error(error);
  }
}

function scheduleRemoteStudyStateSync(snapshot) {
  if (!currentUser || typeof platformAdapter.saveUserState !== "function") return;
  pendingRemoteStudyStateSnapshot = normalizeStudyStateSnapshot(snapshot);
  if (remoteStudyStateSyncTimer) clearTimeout(remoteStudyStateSyncTimer);
  remoteStudyStateSyncTimer = setTimeout(() => {
    remoteStudyStateSyncTimer = null;
    void flushRemoteStudyStateSync();
  }, 600);
}

function getDefaultEditorFieldHeight(field) {
  return DEFAULT_EDITOR_FIELD_HEIGHTS[field] || 180;
}

function getEditorFieldMinimumHeight(field) {
  return MIN_EDITOR_FIELD_HEIGHTS[field] || 120;
}

function ensureEditorFieldHeightsState(fieldHeights = {}) {
  const questionHeight = Number.parseFloat(fieldHeights?.question);
  const answerHeight = Number.parseFloat(fieldHeights?.answer);
  const previewHeight = Number.parseFloat(fieldHeights?.preview);

  return {
    question: Number.isFinite(questionHeight) ? Math.max(Math.round(questionHeight), getEditorFieldMinimumHeight("question")) : getDefaultEditorFieldHeight("question"),
    answer: Number.isFinite(answerHeight) ? Math.max(Math.round(answerHeight), getEditorFieldMinimumHeight("answer")) : getDefaultEditorFieldHeight("answer"),
    preview: Number.isFinite(previewHeight) ? Math.max(Math.round(previewHeight), getEditorFieldMinimumHeight("preview")) : getDefaultEditorFieldHeight("preview"),
  };
}

function normalizeEditorSplitRatio(value) {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue)) return DEFAULT_EDITOR_SPLIT_RATIO;
  return Math.min(Math.max(parsedValue, MIN_EDITOR_SPLIT_RATIO), MAX_EDITOR_SPLIT_RATIO);
}

function ensureEditorRawState(rawState = {}) {
  const height = Number.parseFloat(rawState?.height);
  const scrollTop = Number.parseFloat(rawState?.scrollTop);
  const selectionStart = Number.isInteger(rawState?.selectionStart) ? rawState.selectionStart : null;
  const selectionEnd = Number.isInteger(rawState?.selectionEnd) ? rawState.selectionEnd : selectionStart;

  return {
    height: Number.isFinite(height) ? Math.max(Math.round(height), MIN_EDITOR_RAW_HEIGHT) : null,
    scrollTop: Number.isFinite(scrollTop) ? Math.max(scrollTop, 0) : 0,
    selectionStart,
    selectionEnd,
    shouldRestoreFocus: rawState?.shouldRestoreFocus === true,
  };
}

function updateEditorSplitElement(cardId, splitRatio) {
  const splitElement = document.querySelector(`[data-editor-split="${cardId}"]`);
  if (!splitElement) return;
  splitElement.style.setProperty("--editor-answer-fr", `${splitRatio}fr`);
  splitElement.style.setProperty("--editor-preview-fr", `${100 - splitRatio}fr`);
  const handle = splitElement.querySelector(`[data-editor-split-handle="${cardId}"]`);
  if (handle) {
    handle.setAttribute("aria-valuenow", String(splitRatio));
    handle.setAttribute("aria-valuetext", `Açıklama %${splitRatio}, önizleme %${100 - splitRatio}`);
  }
}

function createEditorFieldHistoryState(value = "") {
  return {
    entries: [String(value ?? "")],
    index: 0,
  };
}

function ensureEditorFieldHistoryState(historyState, value = "") {
  const normalizedValue = String(value ?? "");
  let entries = Array.isArray(historyState?.entries) && historyState.entries.length
    ? historyState.entries.map((entry) => String(entry ?? ""))
    : [normalizedValue];
  let index = Number.isInteger(historyState?.index) ? historyState.index : entries.length - 1;
  index = Math.min(Math.max(index, 0), entries.length - 1);

  if (entries[index] !== normalizedValue) {
    entries = [...entries.slice(0, index + 1), normalizedValue].slice(-MAX_EDITOR_HISTORY_LENGTH);
    index = entries.length - 1;
  }

  return { entries, index };
}

function syncThemeControlsUI() {
  const themeName = window.ThemeManager.getCurrentTheme();
  THEME_CONTROL_IDS.forEach((controlId) => {
    const control = document.getElementById(controlId);
    if (control) control.value = themeName;
  });
}

function toggleTheme(themeName) {
  window.ThemeManager.setTheme({
    themeName,
    controlIds: THEME_CONTROL_IDS,
    storageKey: THEME_KEY,
    storageApi: storage,
  });
  syncThemeControlsUI();
}

function syncAutoAdvanceToggleUI() {
  const toggle = document.getElementById("auto-advance-toggle-manager");
  const status = document.getElementById("auto-advance-status");
  if (toggle) toggle.checked = autoAdvanceEnabled;
  if (status) status.textContent = autoAdvanceEnabled ? "OTOMATİK İLERLE ✓" : "OTOMATİK İLERLE ✕";
}

function showScreen(name) {
  currentScreen = name;
  document.getElementById("auth-screen")?.classList.add("hidden");
  document.getElementById("set-manager")?.classList.add("hidden");
  document.getElementById("editor-screen")?.classList.add("hidden");
  const appContainer = document.getElementById("app-container");
  if (appContainer) appContainer.style.display = "none";
  if (name === "auth") document.getElementById("auth-screen")?.classList.remove("hidden");
  if (name === "manager") document.getElementById("set-manager")?.classList.remove("hidden");
  if (name === "editor") document.getElementById("editor-screen")?.classList.remove("hidden");
  if (name === "study" && appContainer) appContainer.style.display = "block";
}

function saveSelectedSets() {
  if (!currentUser) return;
  const snapshot = buildCurrentStudyStateSnapshot();
  persistStudyStateSnapshot(snapshot);
  scheduleRemoteStudyStateSync(snapshot);
}

function saveStudyState() {
  if (!currentUser) return;
  const snapshot = buildCurrentStudyStateSnapshot();
  persistStudyStateSnapshot(snapshot);
  scheduleRemoteStudyStateSync(snapshot);
}

function hydrateLoadedSets(records) {
  const previousLoadedSets = loadedSets;
  const persistedSourcePaths = getPersistedSetSourcePathMap();
  loadedSets = {};
  normalizeSetCollection(records).forEach((record) => {
    const previousRecord = previousLoadedSets[record.id];
    const resolvedSourcePath = String(
      record.sourcePath
      || previousRecord?.sourcePath
      || persistedSourcePaths[record.id]
      || "",
    ).trim();
    loadedSets[record.id] = resolvedSourcePath
      ? {
          ...record,
          sourcePath: resolvedSourcePath,
        }
      : record;
  });
  syncPersistedSetSourcePaths();
}

function updateManagerUserChip() {
  const chip = document.getElementById("manager-user-chip");
  const signOutButton = document.getElementById("sign-out-btn");
  if (chip) {
    const runtimeLabel = hasSupabaseConfig()
      ? window.__TAURI__?.core?.invoke ? "Bulut + Masaüstü Cache" : "Bulut"
      : window.__TAURI__?.core?.invoke ? "Yerel Demo + Masaüstü Cache" : "Yerel Demo";
    chip.textContent = currentUser ? `Hesap: ${currentUser.email || currentUser.id} · ${runtimeLabel}` : "Hesap: oturum kapalı";
  }
  if (signOutButton) signOutButton.disabled = !currentUser;
  syncDesktopUpdateButton();
}

function normalizeLegacySetRecord(setId, rawRecord) {
  const fileName = rawRecord?.fileName?.trim() || `${slugify(rawRecord?.setName || setId)}.json`;
  const sourceFormat = rawRecord?.sourceFormat || (/\.(md|txt)$/i.test(fileName) ? "markdown" : "json");
  const normalized = normalizeSetRecord(
    {
      ...rawRecord,
      id: rawRecord?.id || setId,
      slug: rawRecord?.slug || slugify(rawRecord?.setName || setId),
      setName: rawRecord?.setName || setId,
      fileName,
      sourceFormat,
      rawSource: rawRecord?.rawSource || "",
      cards: Array.isArray(rawRecord?.cards) ? rawRecord.cards : [],
      updatedAt: rawRecord?.updatedAt || nowIso(),
    },
    { previousRecord: rawRecord },
  );
  normalized.rawSource = backfillRawSource(normalized);
  return normalized;
}

async function migrateLegacyLocalData() {
  if (!currentUser) return false;
  const migrationKey = userScopedStorageKey("legacy_migrated");
  if (storage.getItem(migrationKey) === "1") return false;
  let changed = false;
  const legacySetIds = safeJsonParse(storage.getItem(LEGACY_KEYS.sets), []);
  if (Array.isArray(legacySetIds)) {
    for (const legacySetId of legacySetIds) {
      if (loadedSets[legacySetId]) continue;
      const legacySetRaw = safeJsonParse(storage.getItem(`fc_set_${legacySetId}`), null);
      if (!legacySetRaw) continue;
      await platformAdapter.saveSet(normalizeLegacySetRecord(legacySetId, legacySetRaw));
      changed = true;
    }
  }
  if (!storage.getItem(userScopedStorageKey("selected_sets"))) {
    const legacySelectedSets = safeJsonParse(storage.getItem(LEGACY_KEYS.selectedSets), []);
    if (Array.isArray(legacySelectedSets) && legacySelectedSets.length > 0) setUserJson("selected_sets", legacySelectedSets);
  }
  if (!storage.getItem(userScopedStorageKey("assessments"))) {
    const legacyAssessments = safeJsonParse(storage.getItem(LEGACY_KEYS.assessments), null);
    if (legacyAssessments && typeof legacyAssessments === "object" && !Array.isArray(legacyAssessments)) {
      setUserJson("assessments", legacyAssessments);
    } else {
      const legacyState = safeJsonParse(storage.getItem(LEGACY_KEYS.legacyState), null);
      if (legacyState?.assessments && typeof legacyState.assessments === "object" && !Array.isArray(legacyState.assessments)) {
        setUserJson("assessments", legacyState.assessments);
      }
    }
  }
  if (!storage.getItem(userScopedStorageKey("session"))) {
    const legacySession = safeJsonParse(storage.getItem(LEGACY_KEYS.session), null);
    if (legacySession && typeof legacySession === "object") setUserJson("session", legacySession);
  }
  if (!storage.getItem(userScopedStorageKey("auto_advance"))) {
    const legacyAutoAdvance = storage.getItem(LEGACY_KEYS.autoAdvance);
    if (legacyAutoAdvance === "0" || legacyAutoAdvance === "1") setUserText("auto_advance", legacyAutoAdvance);
  }
  storage.setItem(migrationKey, "1");
  return changed;
}

function migrateLegacyAssessmentsIfNeeded() {
  const entries = Object.entries(assessments || {});
  if (!entries.length) return;
  let changed = false;
  const migrated = {};
  entries.forEach(([key, value]) => {
    if (value === "know" || value === "review" || value === "dunno") migrated[key] = value;
  });
  Object.entries(loadedSets).forEach(([setId, setRecord]) => {
    setRecord.cards.forEach((card, index) => {
      const modernKey = buildCardKey(setId, card, index);
      const legacyKey = legacyCardId(card);
      if (!(modernKey in migrated) && migrated[legacyKey]) {
        migrated[modernKey] = migrated[legacyKey];
        changed = true;
      }
    });
  });
  if (changed) {
    assessments = migrated;
    const snapshot = buildCurrentStudyStateSnapshot();
    persistStudyStateSnapshot(snapshot);
    scheduleRemoteStudyStateSync(snapshot);
  }
}

async function loadUserStudyState() {
  const localSnapshot = getPersistedStudyStateSnapshot();
  let mergedSnapshot = localSnapshot;

  if (currentUser && typeof platformAdapter.loadUserState === "function") {
    try {
      const remoteSnapshot = await platformAdapter.loadUserState();
      if (remoteSnapshot) {
        mergedSnapshot = pickNewerStudyStateSnapshot(localSnapshot, remoteSnapshot);
        persistStudyStateSnapshot(mergedSnapshot);
        const localTime = Date.parse(localSnapshot?.updatedAt || "");
        const remoteTime = Date.parse(remoteSnapshot?.updatedAt || "");
        if (Number.isFinite(localTime) && (!Number.isFinite(remoteTime) || localTime > remoteTime)) {
          scheduleRemoteStudyStateSync(localSnapshot);
        }
      } else if (localSnapshot?.updatedAt) {
        scheduleRemoteStudyStateSync(localSnapshot);
      }
    } catch (error) {
      console.error(error);
    }
  }

  applyStudyStateSnapshot(mergedSnapshot);
  migrateLegacyAssessmentsIfNeeded();
}

async function loadUserWorkspace() {
  let records = await platformAdapter.loadSets();
  hydrateLoadedSets(records);
  await restoreBrowserFileHandles(Object.values(loadedSets));
  if (await migrateLegacyLocalData()) {
    records = await platformAdapter.loadSets();
    hydrateLoadedSets(records);
    await restoreBrowserFileHandles(Object.values(loadedSets));
  }
  await loadUserStudyState();
  updateManagerUserChip();
  renderSetList();
}

async function handleAuthStateChange(user, event = "unknown") {
  authStateToken += 1;
  const token = authStateToken;
  const previousUserId = currentUser?.id || null;
  const previousScreen = currentScreen;
  currentUser = user || null;
  showAuthStatus("", "");
  showEditorStatus("", "");
  updateManagerUserChip();
  if (!currentUser) {
    if (remoteStudyStateSyncTimer) clearTimeout(remoteStudyStateSyncTimer);
    remoteStudyStateSyncTimer = null;
    pendingRemoteStudyStateSnapshot = null;
    loadedSets = {};
    selectedSets = new Set();
    assessments = {};
    editorState = {
      isOpen: false,
      activeSetId: null,
      draftOrder: [],
      drafts: {},
      focusedField: null,
      pendingScrollCardId: null,
    };
    renderSetList();
    syncRememberMeUi();
    showScreen("auth");
    markAppReady();
    return;
  }

  const isSameUser = Boolean(previousUserId && previousUserId === currentUser.id);
  const shouldPreserveActiveScreen = isSameUser && previousScreen !== "auth" && event !== "initial" && event !== "INITIAL_SESSION";
  if (shouldPreserveActiveScreen) {
    if (previousScreen === "editor" && editorState.isOpen) {
      refreshEditorPills();
    }
    markAppReady();
    return;
  }

  try {
    await loadUserWorkspace();
    if (token !== authStateToken) return;
    if (isSameUser && previousScreen === "editor" && editorState.isOpen) {
      showScreen("editor");
      renderEditor();
      markAppReady();
      return;
    }
    if (isSameUser && previousScreen === "study") {
      showScreen("study");
      displayCard();
      markAppReady();
      return;
    }
    showScreen("manager");
    markAppReady();
  } catch (error) {
    console.error(error);
    if (token === authStateToken) {
      showAuthStatus(error.message || "Setler yüklenemedi.", "error");
      syncRememberMeUi();
      showScreen("auth");
      markAppReady();
    }
  }
}

async function attemptAuth(action) {
  const email = document.getElementById("auth-email")?.value || "";
  const password = document.getElementById("auth-password")?.value || "";
  const rememberMe = readRememberMeFromForm();
  setRememberMePreference(rememberMe);
  try {
    showAuthStatus(action === "signup" ? "Hesap oluşturuluyor..." : "Giriş yapılıyor...");
    if (action === "signup") {
      const response = await platformAdapter.signUp(email, password, { rememberMe });
      if (response?.needsConfirmation) {
        showAuthStatus("Kayıt oluşturuldu. E-posta doğrulaması gerekebilir.", "success");
        return;
      }
    } else {
      await platformAdapter.signIn(email, password, { rememberMe });
    }
    showAuthStatus("", "");
  } catch (error) {
    console.error(error);
    showAuthStatus(error.message || "Giriş başarısız oldu.", "error");
  }
}

async function handleDemoAuth() {
  const rememberMe = readRememberMeFromForm();
  setRememberMePreference(rememberMe);
  try {
    showAuthStatus("Yerel demo oturumu açılıyor...");
    await platformAdapter.signInDemo({ rememberMe });
    showAuthStatus("", "");
  } catch (error) {
    console.error(error);
    showAuthStatus(error.message || "Demo oturumu başlatılamadı.", "error");
  }
}

async function signOut() {
  try {
    await platformAdapter.signOut();
  } catch (error) {
    console.error(error);
    showUndoToast("Çıkış yapılamadı.");
  }
}

function findExistingSetMatch(fileName) {
  const fileStem = String(fileName || "").replace(/\.[^/.]+$/, "");
  const slug = slugify(fileStem);
  return Object.values(loadedSets).find((record) => record.fileName === fileName || record.slug === slug) || null;
}

async function importSetFromText(text, fileName, sourcePath = "", webFileHandle = null) {
  const existingRecord = sourcePath
    ? Object.values(loadedSets).find((record) => record.sourcePath === sourcePath)
      || findExistingSetMatch(fileName)
    : findExistingSetMatch(fileName);
  const nextRecord = parseSetText(text, fileName, existingRecord, existingRecord?.sourceFormat);
  if (sourcePath) {
    nextRecord.sourcePath = sourcePath;
  } else if (webFileHandle) {
    nextRecord.sourcePath = existingRecord?.sourcePath || createWebFileSourcePath(fileName);
  } else if (existingRecord?.sourcePath) {
    nextRecord.sourcePath = existingRecord.sourcePath;
  }
  const savedRecord = await platformAdapter.saveSet(nextRecord);
  if (webFileHandle && savedRecord?.sourcePath) {
    bindBrowserFileHandle(savedRecord.sourcePath, webFileHandle);
  }
  loadedSets[savedRecord.id] = savedRecord;
  syncPersistedSetSourcePaths();
  selectedSets.add(savedRecord.id);
  saveSelectedSets();
  renderSetList();
  return savedRecord;
}

async function tryBrowserFileSystemImport() {
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
          },
        },
      ],
    });
    if (!Array.isArray(handles) || handles.length === 0) return true;
    for (const handle of handles) {
      if (handle?.kind !== "file") continue;
      const file = await handle.getFile();
      await importSetFromText(await file.text(), file.name, "", handle);
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

async function triggerSetImport() {
  if (isDesktopRuntime() && typeof platformAdapter.pickNativeSetFiles === "function") {
    try {
      const files = await platformAdapter.pickNativeSetFiles();
      if (!Array.isArray(files) || files.length === 0) return;
      for (const file of files) {
        await importSetFromText(file.contents, file.name, file.path || "");
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

async function handleFileSelect(event) {
  const files = event.target.files;
  if (!files?.length) return;
  for (const file of files) {
    try {
      await importSetFromText(await file.text(), file.name);
      showUndoToast(`"${file.name}" yüklendi.`);
    } catch (error) {
      console.error(error);
      alert(`${file.name} yüklenirken hata oluştu: ${error.message}`);
    }
  }
  event.target.value = "";
}

function toggleSetSelection(setId) {
  if (selectedSets.has(setId)) selectedSets.delete(setId);
  else selectedSets.add(setId);
  saveSelectedSets();
  renderSetList();
}

function toggleSetCheck(setId) {
  toggleSetSelection(setId);
}

async function deleteSet(setId) {
  await removeSets([setId]);
}

async function removeSets(setIds) {
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
    saveSelectedSets();
    renderSetList();
    lastRemovedSets = removedEntries;
    showUndoToast(removedEntries.length === 1 ? "Set kaldırıldı." : `${removedEntries.length} set kaldırıldı.`);
  } catch (error) {
    console.error(error);
    showUndoToast("Setler kaldırılamadı.");
  }
}

function selectAllSets() {
  selectedSets = new Set(Object.keys(loadedSets));
  saveSelectedSets();
  renderSetList();
}

function clearSetSelection() {
  selectedSets.clear();
  saveSelectedSets();
  renderSetList();
}

function toggleBulkSetSelection() {
  const totalSetCount = Object.keys(loadedSets).length;
  const selectionCount = selectedSets.size;
  if (!totalSetCount) return;
  if (selectionCount === totalSetCount) {
    clearSetSelection();
    return;
  }
  selectAllSets();
}

async function removeSelectedSets() {
  if (!selectedSets.size) return;
  await removeSets([...selectedSets]);
}

function showUndoToast(message) {
  const toast = document.getElementById("undo-toast");
  const messageElement = document.getElementById("undo-message");
  if (!toast || !messageElement) return;
  messageElement.textContent = message;
  toast.style.display = "flex";
  if (undoTimeoutId) clearTimeout(undoTimeoutId);
  undoTimeoutId = setTimeout(() => {
    toast.style.display = "none";
    lastRemovedSets = [];
  }, 7000);
}

async function undoLastRemoval() {
  if (!lastRemovedSets.length) return;
  try {
    for (const entry of lastRemovedSets) {
      const savedRecord = await platformAdapter.saveSet(entry.setData);
      loadedSets[savedRecord.id] = savedRecord;
      if (entry.wasSelected) selectedSets.add(savedRecord.id);
    }
    syncPersistedSetSourcePaths();
    saveSelectedSets();
    renderSetList();
    document.getElementById("undo-toast").style.display = "none";
    lastRemovedSets = [];
  } catch (error) {
    console.error(error);
    showUndoToast("Geri alma tamamlanamadı.");
  }
}

function updateSetListScrollState(listElement, setCount) {
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

function renderSetList() {
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
    if (removeSelectedButton) removeSelectedButton.disabled = true;
    if (editSelectedButton) editSelectedButton.disabled = true;
    return;
  }
  if (toolsElement) toolsElement.style.display = "flex";
  if (startButton) startButton.disabled = selectedSets.size === 0;
  if (removeSelectedButton) {
    removeSelectedButton.disabled = selectedSets.size === 0;
    removeSelectedButton.textContent = `Seçilileri Kaldır (${selectedSets.size})`;
  }
  if (editSelectedButton) {
    editSelectedButton.disabled = selectedSets.size === 0;
    editSelectedButton.textContent = `Kartları Düzenle (${selectedSets.size})`;
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
    const row = document.createElement("div");
    row.className = "set-item";
    row.innerHTML = `
      <div class="set-info" data-set-select="${setId}">
        <input
          type="checkbox"
          ${isSelected ? "checked" : ""}
          data-set-checkbox="${setId}"
          name="set-selection-${setId}"
          aria-label="${escapeMarkup(setRecord.setName)} seçim kutusu"
        >
        <div class="set-details">
          <div class="set-title">${setRecord.setName}</div>
          <div class="set-stats">${total} kart — ${assessed}/${total} (%${total ? Math.round((assessed / total) * 100) : 0}) tamam</div>
        </div>
      </div>
      <div class="set-actions-row">
        <button class="btn-delete-circle" title="Seti kaldır" data-set-delete="${setId}">-</button>
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
}

const getPersistedSession = () => {
  const session = getPersistedStudyStateSnapshot().session;
  return session && typeof session === "object" ? session : null;
};

function showSetManager() {
  if (editorState.isOpen && !confirmLeaveEditor()) return;
  closeEditor(true);
  if (isFullscreen) toggleFullscreen();
  renderSetList();
  showScreen("manager");
}

function populateTopicFilter() {
  const select = document.getElementById("topic-select");
  if (!select) return;
  const subjects = [...new Set(allFlashcards.map((card) => card.subject))].sort((leftValue, rightValue) => leftValue.localeCompare(rightValue, "tr"));
  select.innerHTML = '<option value="hepsi">Tüm Başlıklar</option>';
  subjects.forEach((subject) => {
    const option = document.createElement("option");
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  });
}

function startStudy() {
  if (!selectedSets.size) return;
  allFlashcards = [];
  selectedSets.forEach((setId) => {
    const setRecord = loadedSets[setId];
    if (!Array.isArray(setRecord?.cards)) return;
    setRecord.cards.forEach((card, index) => {
      allFlashcards.push({ ...card, __setId: setId, __setIndex: index, __cardKey: buildCardKey(setId, card, index) });
    });
  });
  filteredFlashcards = [...allFlashcards];
  cardOrder = [...Array(filteredFlashcards.length).keys()];
  currentCardIndex = 0;
  populateTopicFilter();
  const session = getPersistedSession();
  if (session?.topic && document.getElementById("topic-select")) {
    document.getElementById("topic-select").value = session.topic;
  }
  activeFilter = session?.activeFilter || "all";
  showScreen("study");
  filterByTopic(false, {
    preferredCardKey: typeof session?.currentCardKey === "string" ? session.currentCardKey : null,
    fallbackIndex: Number.isInteger(session?.currentCardIndex) ? session.currentCardIndex : null,
  });
}

function updateAssessmentButtons(level) {
  document.querySelectorAll(".assess-btn").forEach((button) => button.classList.remove("selected"));
  if (!level) return;
  document.querySelectorAll(`.assess-btn.${level}`).forEach((button) => button.classList.add("selected"));
}

function showAssessmentPanel(isVisible) {
  const panel = document.getElementById("assessment-panel");
  const fullscreenPanel = document.querySelector(".fullscreen-assessment-panel");
  if (isVisible) {
    panel?.classList.add("visible");
    if (fullscreenPanel) fullscreenPanel.style.display = "flex";
  } else {
    panel?.classList.remove("visible");
    if (fullscreenPanel) fullscreenPanel.style.display = "none";
  }
}

function updateScoreDisplay() {
  let know = 0;
  let review = 0;
  let dunno = 0;
  allFlashcards.forEach((card) => {
    const status = getAssessmentLevel(card);
    if (status === "know") know += 1;
    else if (status === "review") review += 1;
    else if (status === "dunno") dunno += 1;
  });
  const total = allFlashcards.length;
  const assessed = know + review + dunno;
  const percentage = total ? Math.round((assessed / total) * 100) : 0;
  document.getElementById("score-know").textContent = know;
  document.getElementById("score-review").textContent = review;
  document.getElementById("score-dunno").textContent = dunno;
  document.getElementById("score-percent").textContent = `${assessed}/${total} (%${percentage})`;
  document.getElementById("progress-fill-know").style.width = `${total ? (know / total) * 100 : 0}%`;
  document.getElementById("progress-fill-review").style.width = `${total ? (review / total) * 100 : 0}%`;
  document.getElementById("progress-fill-dunno").style.width = `${total ? (dunno / total) * 100 : 0}%`;
}

function applyAssessmentFilter(options = {}) {
  const preferredCardKey = typeof options.preferredCardKey === "string" ? options.preferredCardKey : null;
  const fallbackIndex = Number.isInteger(options.fallbackIndex) ? options.fallbackIndex : null;
  document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));
  const labels = { all: "📋 Tümü", know: "✅ Biliyorum", review: "🔄 Tekrar Göz At", dunno: "❌ Bilmiyorum", unanswered: "⬜ Değerlendirilmemiş" };
  document.querySelectorAll(".filter-btn").forEach((button) => {
    if (button.textContent.trim() === labels[activeFilter]) button.classList.add("active");
  });
  const selectedTopic = document.getElementById("topic-select").value;
  const baseCards = selectedTopic === "hepsi" ? [...allFlashcards] : allFlashcards.filter((card) => card.subject === selectedTopic);
  if (activeFilter === "know") filteredFlashcards = baseCards.filter((card) => getAssessmentLevel(card) === "know");
  else if (activeFilter === "review") filteredFlashcards = baseCards.filter((card) => getAssessmentLevel(card) === "review");
  else if (activeFilter === "dunno") filteredFlashcards = baseCards.filter((card) => getAssessmentLevel(card) === "dunno");
  else if (activeFilter === "unanswered") filteredFlashcards = baseCards.filter((card) => !getAssessmentLevel(card));
  else filteredFlashcards = baseCards;
  cardOrder = [...Array(filteredFlashcards.length).keys()];
  let targetIndex = 0;
  if (filteredFlashcards.length > 0) {
    let resolvedIndex = -1;
    if (preferredCardKey) resolvedIndex = filteredFlashcards.findIndex((card) => getCardKey(card) === preferredCardKey);
    if (resolvedIndex < 0 && Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < filteredFlashcards.length) resolvedIndex = fallbackIndex;
    targetIndex = resolvedIndex >= 0 ? resolvedIndex : 0;
  }
  currentCardIndex = targetIndex;
  document.getElementById("jump-input").setAttribute("max", String(filteredFlashcards.length));
  if (filteredFlashcards.length > 0) displayCard();
  else {
    document.getElementById("question-text").textContent = "Bu kategoride kart yok.";
    document.getElementById("answer-text").innerHTML = "";
    document.getElementById("card-counter").textContent = "0 / 0";
    document.getElementById("fullscreen-card-counter").textContent = "0 / 0";
    document.getElementById("subject-display-front").textContent = "";
    showAssessmentPanel(false);
  }
  updateScoreDisplay();
}

function setFilter(filter) {
  const currentCard = filteredFlashcards.length > 0 ? filteredFlashcards[cardOrder[currentCardIndex]] : null;
  activeFilter = filter;
  applyAssessmentFilter({
    preferredCardKey: currentCard ? getCardKey(currentCard) : null,
    fallbackIndex: currentCardIndex,
  });
  saveStudyState();
}

function filterByTopic(resetFilter = true, options = {}) {
  if (resetFilter) activeFilter = "all";
  applyAssessmentFilter(options);
}

function displayCard() {
  if (!filteredFlashcards.length) return;
  const card = filteredFlashcards[cardOrder[currentCardIndex]];
  document.getElementById("question-text").innerHTML = renderAnswerMarkdown(card.q);
  document.getElementById("answer-text").innerHTML = card.a;
  document.getElementById("card-counter").textContent = `${currentCardIndex + 1} / ${filteredFlashcards.length}`;
  document.getElementById("fullscreen-card-counter").textContent = `${currentCardIndex + 1} / ${filteredFlashcards.length}`;
  document.getElementById("subject-display-front").textContent = card.subject;
  document.getElementById("prev-btn").disabled = currentCardIndex === 0;
  document.getElementById("next-btn").disabled = currentCardIndex === filteredFlashcards.length - 1;
  if (isFlipped) {
    document.getElementById("flashcard").classList.remove("flipped");
    isFlipped = false;
  }
  showAssessmentPanel(false);
  updateAssessmentButtons(getAssessmentLevel(card) || null);
  saveStudyState();
}

function cleanupAssessmentsForSet(nextRecord, previousRecord) {
  const allowedKeys = new Set(nextRecord.cards.map((card, index) => buildCardKey(nextRecord.id, card, index)));
  Object.keys(assessments).forEach((key) => {
    if (key.startsWith(`set:${nextRecord.id}::`) && !allowedKeys.has(key)) delete assessments[key];
  });
  previousRecord?.cards?.forEach((card) => delete assessments[legacyCardId(card)]);
}

function assessCard(level) {
  if (!filteredFlashcards.length) return;
  const card = filteredFlashcards[cardOrder[currentCardIndex]];
  const cardKey = getCardKey(card);
  const currentLevel = getAssessmentLevel(card);
  if (cardKey && currentLevel === level) {
    delete assessments[cardKey];
    delete assessments[legacyCardId(card)];
    updateAssessmentButtons(null);
    updateScoreDisplay();
    saveStudyState();
    return;
  }
  if (cardKey) assessments[cardKey] = level;
  updateAssessmentButtons(level);
  updateScoreDisplay();
  saveStudyState();
  if (autoAdvanceEnabled) {
    setTimeout(() => {
      if (currentCardIndex < filteredFlashcards.length - 1) nextCard();
    }, 400);
  }
}

function resetProgress() {
  if (!confirm("Seçili set(ler)deki tüm ilerlemen sıfırlanacak. Emin misin?")) return;
  allFlashcards.forEach((card) => {
    const cardKey = getCardKey(card);
    if (cardKey) delete assessments[cardKey];
    delete assessments[legacyCardId(card)];
  });
  activeFilter = "all";
  applyAssessmentFilter();
  saveStudyState();
}

function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  const container = document.querySelector(".card-container");
  if (!container) return;
  const fullscreenToggleButton = document.getElementById("fullscreen-toggle-btn");
  if (isFullscreen) {
    container.classList.add("fullscreen-active");
    document.body.style.overflow = "hidden";
    if (fullscreenToggleButton) {
      fullscreenToggleButton.textContent = "✕";
      fullscreenToggleButton.title = "Tam ekrandan çık (ESC / F)";
    }
  } else {
    container.classList.remove("fullscreen-active");
    document.body.style.overflow = "auto";
    if (fullscreenToggleButton) {
      fullscreenToggleButton.textContent = "⛶";
      fullscreenToggleButton.title = "Tam ekran (F)";
    }
  }
  fullscreenToggleButton?.blur();
}

function flipCard() {
  document.getElementById("flashcard").classList.toggle("flipped");
  isFlipped = !isFlipped;
  showAssessmentPanel(isFlipped);
}

const previousCard = () => {
  if (currentCardIndex > 0) {
    currentCardIndex -= 1;
    displayCard();
  }
};

const nextCard = () => {
  if (currentCardIndex < filteredFlashcards.length - 1) {
    currentCardIndex += 1;
    displayCard();
  }
};

function jumpToCard() {
  const input = document.getElementById("jump-input");
  const cardNumber = Number.parseInt(input.value, 10);
  if (cardNumber >= 1 && cardNumber <= filteredFlashcards.length) {
    currentCardIndex = cardNumber - 1;
    displayCard();
    input.value = "";
    return;
  }
  alert(`Lütfen 1 ile ${filteredFlashcards.length} arasında bir sayı gir.`);
}

function shuffleCards() {
  if (!filteredFlashcards.length) return;
  for (let index = cardOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [cardOrder[index], cardOrder[swapIndex]] = [cardOrder[swapIndex], cardOrder[index]];
  }
  currentCardIndex = 0;
  displayCard();
}

function printCards() {
  const statusIcons = { know: "✅", review: "🔄", dunno: "❌" };
  const cardsMarkup = allFlashcards.map((card, index) => {
    const status = getAssessmentLevel(card);
    const badge = status ? `<span style="float:right;font-size:18px">${statusIcons[status]}</span>` : "";
    return `<div style="page-break-inside:avoid; border:1px solid #ddd; border-radius:10px; padding:20px 24px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; color:#2f7a56; font-size:14px;">Kart ${index + 1} — ${card.subject}</span>${badge}
      </div>
      <div style="font-size:15px; font-weight:600; margin-bottom:12px; color:#21302a;">${renderAnswerMarkdown(card.q)}</div>
      <div style="font-size:14px; line-height:1.7; color:#333; border-top:1px solid #eee; padding-top:12px;">${card.a}</div>
    </div>`;
  }).join("");
  let know = 0;
  let review = 0;
  let dunno = 0;
  allFlashcards.forEach((card) => {
    const status = getAssessmentLevel(card);
    if (status === "know") know += 1;
    else if (status === "review") review += 1;
    else if (status === "dunno") dunno += 1;
  });
  const total = allFlashcards.length;
  const assessed = know + review + dunno;
  const percentage = total ? Math.round((assessed / total) * 100) : 0;
  const popup = window.open("", "_blank");
  popup.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Flashcards — Yazdır</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:30px 20px;color:#21302a}h1{font-size:22px;margin-bottom:4px}.summary{font-size:14px;color:#5f6d66;margin-bottom:20px;padding-bottom:15px;border-bottom:2px solid #2f7a56}@media print{body{padding:10px}}</style></head><body><h1>Flashcards</h1><div class="summary">Toplam: ${total} kart | ✅ ${know} | 🔄 ${review} | ❌ ${dunno} | İlerleme: %${percentage}</div>${cardsMarkup}</body></html>`);
  popup.document.close();
  popup.onload = () => popup.print();
}

function ensureEditorDraftUiState(draft) {
  const cards = Array.isArray(draft?.cards) ? draft.cards : [];
  const availableCardIds = new Set(cards.map((card) => card.id));
  if (draft.formLayoutMode !== "single") {
    draft.formLayoutMode = "list";
  }
  if (typeof draft.listPanelOpen !== "boolean") {
    draft.listPanelOpen = true;
  }
  if (typeof draft.deleteSelectionMode !== "boolean") {
    draft.deleteSelectionMode = false;
  }
  draft.deleteSelectionCardIds = Array.isArray(draft.deleteSelectionCardIds)
    ? draft.deleteSelectionCardIds.filter((cardId) => availableCardIds.has(cardId))
    : [];
  draft.fieldHeights = ensureEditorFieldHeightsState(draft.fieldHeights);
  draft.splitRatio = normalizeEditorSplitRatio(draft.splitRatio);
  draft.rawEditorState = ensureEditorRawState(draft.rawEditorState);
  draft.fieldHistory = Object.fromEntries(
    cards.map((card) => [
      card.id,
      {
        question: ensureEditorFieldHistoryState(draft.fieldHistory?.[card.id]?.question, card.question),
        answer: ensureEditorFieldHistoryState(draft.fieldHistory?.[card.id]?.answer, card.explanationMarkdown),
      },
    ]),
  );
  if (!availableCardIds.size) {
    draft.activeCardIndex = 0;
    draft.expandedCardId = null;
    draft.toolbarExpandedCardId = null;
    draft.expandedPreviewCardId = null;
    draft.deleteSelectionMode = false;
    draft.deleteSelectionCardIds = [];
    return draft;
  }
  if (!Number.isInteger(draft.activeCardIndex)) {
    draft.activeCardIndex = 0;
  }
  draft.activeCardIndex = Math.min(Math.max(draft.activeCardIndex, 0), cards.length - 1);
  if (draft.expandedCardId === undefined) {
    draft.expandedCardId = null;
  } else if (draft.expandedCardId !== null && !availableCardIds.has(draft.expandedCardId)) {
    draft.expandedCardId = null;
  }
  if (draft.expandedCardId !== null) {
    const expandedCardIndex = cards.findIndex((card) => card.id === draft.expandedCardId);
    if (expandedCardIndex >= 0) {
      draft.activeCardIndex = expandedCardIndex;
    }
  }
  if (draft.toolbarExpandedCardId && !availableCardIds.has(draft.toolbarExpandedCardId)) {
    draft.toolbarExpandedCardId = null;
  }
  if (draft.expandedPreviewCardId && !availableCardIds.has(draft.expandedPreviewCardId)) {
    draft.expandedPreviewCardId = null;
  }
  if (editorState.focusedField?.setId === draft.setId && !availableCardIds.has(editorState.focusedField.cardId)) {
    editorState.focusedField = null;
  }
  return draft;
}

const getCurrentEditorDraft = () => editorState.activeSetId ? editorState.drafts[editorState.activeSetId] : null;
function createEditorDraft(setRecord, previousDraft = null) {
  const baseDraft = buildEditorDraft(setRecord);
  return ensureEditorDraftUiState({
    ...baseDraft,
    dirty: false,
    formLayoutMode: previousDraft?.formLayoutMode ?? baseDraft.formLayoutMode ?? "list",
    listPanelOpen: previousDraft?.listPanelOpen ?? true,
    activeCardIndex: Number.isInteger(previousDraft?.activeCardIndex) ? previousDraft.activeCardIndex : 0,
    expandedCardId: previousDraft ? previousDraft.expandedCardId : baseDraft.expandedCardId ?? null,
    toolbarExpandedCardId: previousDraft?.toolbarExpandedCardId ?? baseDraft.toolbarExpandedCardId ?? null,
    expandedPreviewCardId: previousDraft?.expandedPreviewCardId ?? baseDraft.expandedPreviewCardId ?? null,
    fieldHeights: previousDraft?.fieldHeights || {},
    splitRatio: previousDraft?.splitRatio,
    fieldHistory: previousDraft?.fieldHistory || {},
    rawEditorState: previousDraft?.rawEditorState,
    deleteSelectionMode: previousDraft?.deleteSelectionMode ?? false,
    deleteSelectionCardIds: Array.isArray(previousDraft?.deleteSelectionCardIds) ? [...previousDraft.deleteSelectionCardIds] : [],
    baseUpdatedAt: setRecord?.updatedAt || nowIso(),
  });
}

function getEditorActiveCard(draft) {
  ensureEditorDraftUiState(draft);
  return draft.cards[draft.activeCardIndex] || null;
}

function setEditorActiveCardIndex(draft, index) {
  ensureEditorDraftUiState(draft);
  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    return;
  }
  draft.activeCardIndex = Math.min(Math.max(index, 0), draft.cards.length - 1);
  draft.expandedCardId = null;
  draft.toolbarExpandedCardId = null;
}

function setEditorActiveCardById(draft, cardId) {
  const targetIndex = draft.cards.findIndex((card) => card.id === cardId);
  if (targetIndex < 0) return;
  setEditorActiveCardIndex(draft, targetIndex);
}

function queueEditorCardScroll(cardId) {
  editorState.pendingScrollCardId = cardId || null;
}

function addEditorCard(draft) {
  const activeCard = getEditorActiveCard(draft);
  const nextCard = {
    id: generateId("card"),
    subject: activeCard?.subject || draft.setName || "Genel",
    question: "",
    explanationMarkdown: "",
  };
  draft.cards.push(nextCard);
  setEditorActiveCardIndex(draft, draft.cards.length - 1);
  editorState.focusedField = {
    setId: draft.setId,
    cardId: nextCard.id,
    field: "question",
  };
  markDraftDirty(draft.setId, true);
}

function deleteEditorCard(draft, cardId) {
  const targetIndex = draft.cards.findIndex((card) => card.id === cardId);
  if (targetIndex < 0) return;

  draft.cards.splice(targetIndex, 1);
  draft.deleteSelectionCardIds = draft.deleteSelectionCardIds.filter((selectedCardId) => selectedCardId !== cardId);
  if (editorState.focusedField?.cardId === cardId) {
    editorState.focusedField = null;
  }
  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    draft.toolbarExpandedCardId = null;
    draft.expandedCardId = null;
    markDraftDirty(draft.setId, true);
    return;
  }

  const nextIndex = targetIndex >= draft.cards.length ? draft.cards.length - 1 : targetIndex;
  setEditorActiveCardIndex(draft, nextIndex);
  markDraftDirty(draft.setId, true);
}

function toggleEditorDeleteSelectionMode(draft) {
  draft.deleteSelectionMode = !draft.deleteSelectionMode;
  if (!draft.deleteSelectionMode) {
    draft.deleteSelectionCardIds = [];
  }
}

function toggleEditorDeleteCardSelection(draft, cardId, shouldSelect) {
  const selectedIds = new Set(draft.deleteSelectionCardIds);
  if (shouldSelect) selectedIds.add(cardId);
  else selectedIds.delete(cardId);
  draft.deleteSelectionCardIds = draft.cards
    .map((card) => card.id)
    .filter((candidateId) => selectedIds.has(candidateId));
}

function deleteSelectedEditorCards(draft) {
  ensureEditorDraftUiState(draft);
  const selectedIds = draft.deleteSelectionCardIds.filter((cardId) => draft.cards.some((card) => card.id === cardId));
  if (!selectedIds.length) {
    showEditorStatus("Silmek için önce en az bir kart seç.", "error");
    return 0;
  }

  const confirmationMessage = selectedIds.length === 1
    ? "Seçili kartı silmek istediğine emin misin?"
    : `Seçili ${selectedIds.length} kartı silmek istediğine emin misin?`;

  if (!confirm(confirmationMessage)) return 0;

  const selectedIdSet = new Set(selectedIds);
  const currentActiveCardId = getEditorActiveCard(draft)?.id || null;
  draft.cards = draft.cards.filter((card) => !selectedIdSet.has(card.id));
  draft.deleteSelectionCardIds = [];
  draft.deleteSelectionMode = false;

  if (editorState.focusedField?.setId === draft.setId && selectedIdSet.has(editorState.focusedField.cardId)) {
    editorState.focusedField = null;
  }

  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    draft.toolbarExpandedCardId = null;
    draft.expandedCardId = null;
    draft.expandedPreviewCardId = null;
  } else if (currentActiveCardId && draft.cards.some((card) => card.id === currentActiveCardId)) {
    setEditorActiveCardById(draft, currentActiveCardId);
  } else {
    setEditorActiveCardIndex(draft, Math.min(draft.activeCardIndex, draft.cards.length - 1));
  }

  markDraftDirty(draft.setId, true);
  return selectedIds.length;
}

function refreshEditorPills() {
  const draft = getCurrentEditorDraft();
  const activeSetPill = document.getElementById("editor-active-set-pill");
  const dirtyPill = document.getElementById("editor-dirty-pill");
  const formatPill = document.getElementById("editor-format-pill");
  const toggleButton = document.getElementById("editor-view-toggle-btn");
  if (!draft) {
    if (activeSetPill) activeSetPill.textContent = "Set: -";
    if (dirtyPill) dirtyPill.textContent = "Durum: Kaydedildi";
    if (formatPill) formatPill.textContent = "Format: -";
    return;
  }
  if (activeSetPill) activeSetPill.textContent = `Set: ${draft.setName}`;
  if (dirtyPill) dirtyPill.textContent = `Durum: ${draft.dirty ? "Kaydedilmedi" : "Kaydedildi"}`;
  if (formatPill) formatPill.textContent = `Format: ${draft.sourceFormat === "markdown" ? "Markdown" : "JSON"}`;
  if (toggleButton) toggleButton.textContent = draft.viewMode === "form" ? "Raw Code" : "Form Görünümü";
}

function markDraftDirty(setId, dirty = true) {
  const draft = editorState.drafts[setId];
  if (!draft) return;
  draft.dirty = dirty;
  refreshEditorPills();
}

function buildRawSourceFromDraft(draft) {
  const nextRecord = buildSetFromEditorDraft(draft, loadedSets[draft.setId]);
  draft.rawSource = nextRecord.rawSource;
  draft.setName = nextRecord.setName;
}

function syncDraftFromRaw(draft) {
  const existingRecord = loadedSets[draft.setId];
  const nextRecord = parseSetText(
    draft.rawSource,
    existingRecord?.fileName || `${draft.setId}.${draft.sourceFormat === "markdown" ? "md" : "json"}`,
    existingRecord,
    draft.sourceFormat,
  );
  const nextDraft = buildEditorDraft(nextRecord);
  draft.cards = nextDraft.cards;
  draft.rawSource = nextDraft.rawSource;
  draft.setName = nextDraft.setName;
  ensureEditorDraftUiState(draft);
}

function resolveEditorDraftRecord(draft) {
  const previousRecord = loadedSets[draft.setId];
  const nextRecord = draft.viewMode === "raw"
    ? parseSetText(
        draft.rawSource,
        previousRecord?.fileName || `${draft.setId}.${draft.sourceFormat === "markdown" ? "md" : "json"}`,
        previousRecord,
        draft.sourceFormat,
      )
    : buildSetFromEditorDraft(draft, previousRecord);

  nextRecord.rawSource = backfillRawSource(nextRecord);
  return nextRecord;
}

function renderEditorTabs() {
  const select = document.getElementById("editor-set-select");
  if (!select) return;
  select.innerHTML = editorState.draftOrder
    .map((setId) => {
      const draft = editorState.drafts[setId];
      return `<option value="${setId}">${escapeMarkup(draft.setName)}${draft.dirty ? " *" : ""}</option>`;
    })
    .join("");
  const fallbackSetId = editorState.draftOrder[0] || "";
  if (!editorState.activeSetId || !editorState.drafts[editorState.activeSetId]) {
    editorState.activeSetId = fallbackSetId || null;
  }
  select.value = editorState.activeSetId || fallbackSetId;
  select.disabled = editorState.draftOrder.length <= 1;
  select.onchange = () => {
    if (!select.value || select.value === editorState.activeSetId) return;
    const currentDraft = getCurrentEditorDraft();
    if (currentDraft) persistCurrentEditorUiState(currentDraft);
    editorState.activeSetId = select.value;
    editorState.focusedField = null;
    renderEditor();
  };
}

function renderEditorToolbarButtons(actions, cardId) {
  return actions
    .map(
      (action) =>
        `<button type="button" class="btn btn-small btn-secondary editor-tool-btn" data-md-action="${action.id}" data-card-id="${cardId}" title="${action.title}" aria-label="${action.title}">${action.label}</button>`,
    )
    .join("");
}

function renderEditorFormattingToolbar(cardId) {
  return `
    <div class="editor-format-toolbar">
      <div class="editor-format-toolbar-head">
        <div class="editor-format-toolbar-label">
          <strong>Biçimlendirme</strong>
        </div>
      </div>
      <div class="editor-toolbar-shell" role="toolbar" aria-label="Soru ve açıklama biçimlendirme araçları">
        <div class="editor-toolbar editor-toolbar-primary">
          ${renderEditorToolbarButtons(allMarkdownActions, cardId)}
        </div>
      </div>
    </div>`;
}

function renderEditorCardList(draft) {
  const isDeleteSelectionMode = draft.deleteSelectionMode === true;
  const selectedDeleteIds = new Set(draft.deleteSelectionCardIds);
  const selectedCount = draft.deleteSelectionCardIds.length;
  const itemsMarkup = draft.cards.length
    ? draft.cards
        .map((card, index) => {
          const questionPreview = card.question.trim() || "Yeni kart";
          const isActiveCard = draft.activeCardIndex === index;
          const isSelectedForDelete = selectedDeleteIds.has(card.id);
          return `
            <div class="editor-list-row ${isDeleteSelectionMode ? "is-selection-enabled" : ""}">
              ${
                isDeleteSelectionMode
                  ? `<div class="editor-list-check-wrap">
                      <input
                        type="checkbox"
                        class="editor-list-check"
                        data-editor-delete-select="${card.id}"
                        aria-label="Kart ${index + 1} silmek için seç"
                        ${isSelectedForDelete ? "checked" : ""}
                      />
                    </div>`
                  : ""
              }
              <button
                type="button"
                class="editor-list-select ${isActiveCard ? "active" : ""}"
                data-editor-select-card="${card.id}"
                aria-pressed="${isActiveCard}"
              >
                <span class="editor-list-index">Kart ${index + 1}</span>
                <span class="editor-list-question" data-editor-list-question="${card.id}">${escapeMarkup(questionPreview)}</span>
              </button>
            </div>`;
        })
        .join("")
    : `<div class="editor-list-empty">Bu sette henüz kart yok.</div>`;

  return `
    <aside class="editor-list-panel">
      <div class="editor-list-header">
        <div class="editor-list-title">KARTLAR</div>
        <div class="editor-list-actions">
          <button type="button" class="btn btn-small" id="editor-add-card-btn">Kart Ekle</button>
          <button
            type="button"
            class="btn btn-small btn-secondary editor-list-action-toggle ${isDeleteSelectionMode ? "active" : ""}"
            data-editor-toggle-delete-mode
          >
            ${isDeleteSelectionMode ? "Seçimi Kapat" : "Kart Sil"}
          </button>
          ${
            isDeleteSelectionMode
              ? `<button
                  type="button"
                  class="btn btn-small btn-danger"
                  data-editor-delete-selected
                  ${selectedCount ? "" : "disabled"}
                >Seçilileri Sil${selectedCount ? ` (${selectedCount})` : ""}</button>`
              : ""
          }
        </div>
      </div>
      <div class="editor-list-items">
        ${itemsMarkup}
      </div>
    </aside>`;
}

function renderEditorCardDetail(draft, card, index) {
  const subjectFieldId = `editor-subject-${card.id}`;
  const questionFieldId = `editor-question-${card.id}`;
  const answerFieldId = `editor-answer-${card.id}`;
  const questionHeight = getEditorFieldHeight(draft, "question");
  const answerHeight = getEditorFieldHeight(draft, "answer");
  const previewHeight = getEditorFieldHeight(draft, "preview");
  const splitRatio = getEditorSplitRatio(draft);
  return `
    <section class="editor-card editor-card--detail is-open is-active" data-editor-card-root="${card.id}">
      <div class="editor-card-head">
        <div class="editor-card-head-main">
          <div class="editor-card-title">Kart No ${index + 1}</div>
        </div>
        <div class="editor-card-head-side">
          <label class="status-pill editor-subject-shell" for="${subjectFieldId}">
            <span class="editor-subject-prefix">Konu</span>
            <input
              type="text"
              id="${subjectFieldId}"
              class="editor-subject-input"
              data-editor-subject-input="${card.id}"
              name="editor-subject-${card.id}"
              value="${escapeMarkup(card.subject)}"
              placeholder="Genel"
              spellcheck="false"
              aria-label="Kart konusu"
            />
          </label>
        </div>
      </div>
      <div class="editor-card-body" data-editor-card-body="${card.id}">
        ${renderEditorFormattingToolbar(card.id)}
        <div class="field-group">
          <label for="${questionFieldId}">Soru</label>
          <textarea
            id="${questionFieldId}"
            class="editor-input-question"
            data-editor-field="question"
            data-card-id="${card.id}"
            name="editor-question-${card.id}"
            placeholder="Soruyu yaz..."
            style="height:${questionHeight}px;"
          >${escapeMarkup(card.question)}</textarea>
        </div>
        <div
          class="editor-split"
          data-editor-split="${card.id}"
          style="--editor-answer-fr:${splitRatio}fr; --editor-preview-fr:${100 - splitRatio}fr;"
        >
          <div class="editor-split-pane">
            <div class="field-group">
              <div class="editor-markdown-head">
                <label for="${answerFieldId}">Açıklama (Markdown)</label>
              </div>
              <textarea
                id="${answerFieldId}"
                class="editor-input-answer"
                data-editor-field="answer"
                data-card-id="${card.id}"
                name="editor-answer-${card.id}"
                placeholder="Markdown açıklamasını yaz..."
                style="height:${answerHeight}px;"
              >${escapeMarkup(card.explanationMarkdown)}</textarea>
            </div>
          </div>
          <button
            type="button"
            class="editor-split-handle"
            data-editor-split-handle="${card.id}"
            role="slider"
            aria-label="Açıklama ve önizleme genişliğini ayarla"
            aria-valuemin="${MIN_EDITOR_SPLIT_RATIO}"
            aria-valuemax="${MAX_EDITOR_SPLIT_RATIO}"
            aria-valuenow="${splitRatio}"
            aria-valuetext="Açıklama %${splitRatio}, önizleme %${100 - splitRatio}"
          ></button>
          <div class="editor-split-pane">
            <div class="field-group">
              <div class="editor-preview-head">
                <label>Canlı Önizleme</label>
              </div>
              <div
                class="editor-preview editor-preview-answer"
                data-editor-preview="${card.id}"
                data-editor-height-field="preview"
                style="height:${previewHeight}px;"
              >${renderAnswerMarkdown(card.explanationMarkdown)}</div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

function renderEditorForm(draft) {
  ensureEditorDraftUiState(draft);
  const activeCard = getEditorActiveCard(draft);
  const isListOpen = draft.listPanelOpen !== false;

  return `
    <div class="editor-workspace ${isListOpen ? "is-list-open" : "is-list-closed"}">
      <div class="editor-list-sidebar">
        <button
          type="button"
          class="editor-list-handle"
          data-editor-toggle-list
          aria-expanded="${isListOpen}"
          aria-label="${isListOpen ? "Kart listesini kapat" : "Kart listesini aç"}"
          title="${isListOpen ? "Kart listesini kapat" : "Kart listesini aç"}"
        >
          <span class="editor-list-handle-icon">${isListOpen ? "←" : "→"}</span>
          <span class="editor-list-handle-text">${isListOpen ? "Listeyi Daralt" : "Kartlar"}</span>
        </button>
        <div class="editor-list-drawer">
          ${renderEditorCardList(draft)}
        </div>
      </div>
      <div class="editor-detail-panel">
        ${
          activeCard
            ? renderEditorCardDetail(draft, activeCard, draft.activeCardIndex)
            : `<div class="editor-empty-state">Kart ekleyerek düzenlemeye başlayabilirsin.</div>`
        }
      </div>
    </div>`;
}

const renderEditorRaw = (draft) => {
  const rawEditorState = ensureEditorRawState(draft.rawEditorState);
  const rawHeightStyle = Number.isFinite(rawEditorState.height) ? ` style="height:${rawEditorState.height}px;"` : "";
  return `<div class="field-group"><label for="editor-raw-input">Raw Code</label><textarea id="editor-raw-input" name="editor-raw-input" class="editor-raw" spellcheck="false"${rawHeightStyle}>${draft.rawSource}</textarea></div>`;
};

function applyMarkdownSnippet(textarea, action) {
  restoreEditorFieldSelection(textarea);
  const selectionStart = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  const selectedText = textarea.value.slice(selectionStart, selectionEnd);
  let replacement = selectedText || "metin";
  let selectionOffsetStart = 0;
  let selectionOffsetEnd = replacement.length;

  if (action === "bold") {
    replacement = `**${selectedText || "kalın metin"}**`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "italic") {
    replacement = `*${selectedText || "italik metin"}*`;
    selectionOffsetStart = 1;
    selectionOffsetEnd = replacement.length - 1;
  } else if (action === "critical") {
    replacement = `==${selectedText || "kritik bilgi"}==`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "warning") {
    replacement = `> ⚠️ ${selectedText || "Dikkat edilmesi gereken nokta"}`;
    selectionOffsetStart = 5;
    selectionOffsetEnd = replacement.length;
  } else if (action === "quote") {
    replacement = `> ${selectedText || "Alıntı veya not"}`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length;
  } else if (action === "strike") {
    replacement = `~~${selectedText || "üstü çizili metin"}~~`;
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length - 2;
  } else if (action === "heading") {
    replacement = `## ${selectedText || "Başlık"}`;
    selectionOffsetStart = 3;
    selectionOffsetEnd = replacement.length;
  } else if (action === "bulletList") {
    const lines = (selectedText || "Liste maddesi").split("\n").map((line) => line.trim() || "Liste maddesi");
    replacement = lines.map((line) => `- ${line}`).join("\n");
    selectionOffsetStart = 2;
    selectionOffsetEnd = replacement.length;
  } else if (action === "numberList") {
    const lines = (selectedText || "Liste maddesi").split("\n").map((line) => line.trim() || "Liste maddesi");
    replacement = lines.map((line, index) => `${index + 1}. ${line}`).join("\n");
    selectionOffsetStart = 3;
    selectionOffsetEnd = replacement.length;
  } else if (action === "link") {
    const label = selectedText || "bağlantı metni";
    replacement = `[${label}](https://example.com)`;
    selectionOffsetStart = replacement.indexOf("https://");
    selectionOffsetEnd = selectionOffsetStart + "https://example.com".length;
  } else if (action === "code") {
    const codeText = selectedText || "kod";
    if (codeText.includes("\n")) {
      replacement = `\`\`\`\n${codeText}\n\`\`\``;
      selectionOffsetStart = 4;
      selectionOffsetEnd = 4 + codeText.length;
    } else {
      replacement = `\`${codeText}\``;
      selectionOffsetStart = 1;
      selectionOffsetEnd = replacement.length - 1;
    }
  } else if (action === "divider") {
    replacement = "\n\n---\n\n";
    selectionOffsetStart = replacement.length;
    selectionOffsetEnd = replacement.length;
  } else if (action === "table") {
    replacement = "| Başlık | Değer |\n| --- | --- |\n| Satır | Açıklama |";
    selectionOffsetStart = replacement.indexOf("Başlık");
    selectionOffsetEnd = selectionOffsetStart + "Başlık".length;
  }

  textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
  textarea.focus();
  textarea.setSelectionRange(selectionStart + selectionOffsetStart, selectionStart + selectionOffsetEnd);
  rememberEditorFieldSelection(textarea);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function getEditorFieldNameFromElement(textarea) {
  return textarea.getAttribute("data-editor-field") === "question" ? "question" : "answer";
}

function getEditorFieldHeight(draft, field) {
  ensureEditorDraftUiState(draft);
  return draft.fieldHeights?.[field] || getDefaultEditorFieldHeight(field);
}

function getEditorSplitRatio(draft) {
  ensureEditorDraftUiState(draft);
  return normalizeEditorSplitRatio(draft.splitRatio);
}

function setEditorSplitRatio(draft, cardId, value) {
  const splitRatio = normalizeEditorSplitRatio(value);
  draft.splitRatio = splitRatio;
  updateEditorSplitElement(cardId, splitRatio);
  return splitRatio;
}

function getEditorSplitRatioFromPointer(splitElement, clientX) {
  if (!splitElement || !Number.isFinite(clientX)) return null;
  const rect = splitElement.getBoundingClientRect();
  if (!rect.width) return null;
  return normalizeEditorSplitRatio(((clientX - rect.left) / rect.width) * 100);
}

function stopEditorSplitDrag() {
  if (!editorSplitDragState) return;
  document.removeEventListener("pointermove", editorSplitDragState.handlePointerMove);
  document.removeEventListener("pointerup", editorSplitDragState.handlePointerUp);
  document.removeEventListener("pointercancel", editorSplitDragState.handlePointerUp);
  editorSplitDragState.handle.classList.remove("is-active");
  document.body.classList.remove("is-editor-split-dragging");
  editorSplitDragState = null;
}

function startEditorSplitDrag(draft, cardId, handle, event) {
  if (!handle || !draft) return;
  if (event.button !== undefined && event.button !== 0) return;
  stopEditorSplitDrag();
  persistFocusedEditorFieldState(draft);
  const splitElement = document.querySelector(`[data-editor-split="${cardId}"]`);
  if (!splitElement) return;

  const handlePointerMove = (moveEvent) => {
    const nextRatio = getEditorSplitRatioFromPointer(splitElement, moveEvent.clientX);
    if (nextRatio === null) return;
    setEditorSplitRatio(draft, cardId, nextRatio);
  };

  const handlePointerUp = () => {
    stopEditorSplitDrag();
  };

  editorSplitDragState = {
    handle,
    handlePointerMove,
    handlePointerUp,
  };

  handle.classList.add("is-active");
  document.body.classList.add("is-editor-split-dragging");
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);

  if (typeof handle.setPointerCapture === "function" && Number.isInteger(event.pointerId)) {
    handle.setPointerCapture(event.pointerId);
  }

  handlePointerMove(event);
}

function handleEditorSplitHandleKeydown(draft, cardId, event) {
  let nextRatio = null;
  const currentRatio = getEditorSplitRatio(draft);
  if (event.key === "ArrowLeft") {
    nextRatio = currentRatio - EDITOR_SPLIT_KEYBOARD_STEP;
  } else if (event.key === "ArrowRight") {
    nextRatio = currentRatio + EDITOR_SPLIT_KEYBOARD_STEP;
  } else if (event.key === "Home") {
    nextRatio = MIN_EDITOR_SPLIT_RATIO;
  } else if (event.key === "End") {
    nextRatio = MAX_EDITOR_SPLIT_RATIO;
  }

  if (nextRatio === null) return;
  event.preventDefault();
  setEditorSplitRatio(draft, cardId, nextRatio);
}

function getEditorFieldHistory(draft, cardId, field, currentValue = "") {
  if (!draft.fieldHistory[cardId]) draft.fieldHistory[cardId] = {};
  if (!draft.fieldHistory[cardId][field]) {
    draft.fieldHistory[cardId][field] = createEditorFieldHistoryState(currentValue);
  }
  return draft.fieldHistory[cardId][field];
}

function recordEditorFieldHistory(draft, cardId, field, value) {
  const normalizedValue = String(value ?? "");
  const history = getEditorFieldHistory(draft, cardId, field, normalizedValue);
  if (history.entries[history.index] === normalizedValue) return;
  history.entries = [...history.entries.slice(0, history.index + 1), normalizedValue].slice(-MAX_EDITOR_HISTORY_LENGTH);
  history.index = history.entries.length - 1;
}

function rememberEditorFieldSelection(textarea) {
  const activeDraft = getCurrentEditorDraft();
  if (!textarea || !activeDraft) return;

  editorState.focusedField = {
    setId: activeDraft.setId,
    cardId: textarea.getAttribute("data-card-id"),
    field: getEditorFieldNameFromElement(textarea),
    selectionStart: typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length,
    selectionEnd: typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : textarea.value.length,
    scrollTop: textarea.scrollTop || 0,
  };
}

function restoreEditorFieldSelection(textarea) {
  const focusedField = editorState.focusedField;
  if (!textarea || !focusedField) return;
  if (
    textarea.getAttribute("data-card-id") !== focusedField.cardId
    || getEditorFieldNameFromElement(textarea) !== focusedField.field
  ) {
    return;
  }

  textarea.focus();
  const valueLength = textarea.value.length;
  const selectionStart = Math.min(focusedField.selectionStart ?? valueLength, valueLength);
  const selectionEnd = Math.min(focusedField.selectionEnd ?? selectionStart, valueLength);
  textarea.setSelectionRange(selectionStart, selectionEnd);
  textarea.scrollTop = focusedField.scrollTop || 0;
}

function getEditorHeightFieldName(element) {
  const explicitField = element?.getAttribute("data-editor-height-field");
  if (explicitField === "question" || explicitField === "answer" || explicitField === "preview") return explicitField;
  return element ? getEditorFieldNameFromElement(element) : null;
}

function saveEditorFieldHeight(draft, element) {
  if (!draft || !element) return;
  ensureEditorDraftUiState(draft);
  const field = getEditorHeightFieldName(element);
  if (!field) return;
  draft.fieldHeights[field] = Math.max(Math.round(element.offsetHeight), getEditorFieldMinimumHeight(field));
}

function saveRawEditorState(draft, rawInput = document.getElementById("editor-raw-input")) {
  if (!draft || !rawInput) return;
  draft.rawEditorState = ensureEditorRawState({
    ...draft.rawEditorState,
    height: rawInput.offsetHeight || rawInput.getBoundingClientRect().height || draft.rawEditorState?.height,
    scrollTop: rawInput.scrollTop || 0,
    selectionStart: typeof rawInput.selectionStart === "number" ? rawInput.selectionStart : null,
    selectionEnd: typeof rawInput.selectionEnd === "number" ? rawInput.selectionEnd : null,
    shouldRestoreFocus: document.activeElement === rawInput,
  });
}

function restoreRawEditorState(draft) {
  const rawInput = document.getElementById("editor-raw-input");
  if (!draft || !rawInput) return;
  const rawEditorState = ensureEditorRawState(draft.rawEditorState);
  draft.rawEditorState = rawEditorState;
  if (Number.isFinite(rawEditorState.height)) {
    rawInput.style.height = `${rawEditorState.height}px`;
  }
  rawInput.scrollTop = rawEditorState.scrollTop || 0;
  if (!rawEditorState.shouldRestoreFocus) return;

  rawInput.focus();
  const valueLength = rawInput.value.length;
  const selectionStart = Math.min(rawEditorState.selectionStart ?? valueLength, valueLength);
  const selectionEnd = Math.min(rawEditorState.selectionEnd ?? selectionStart, valueLength);
  rawInput.setSelectionRange(selectionStart, selectionEnd);
}

function persistFocusedEditorFieldState(draft) {
  const focusedField = getFocusedEditorFieldElement();
  if (!focusedField) return;
  rememberEditorFieldSelection(focusedField);
  saveEditorFieldHeight(draft, focusedField);
}

function persistCurrentEditorUiState(draft) {
  if (!draft) return;
  persistFocusedEditorFieldState(draft);
  saveRawEditorState(draft);
}

function syncEditorFieldFromTextarea(draft, textarea, options = {}) {
  const cardId = textarea.getAttribute("data-card-id");
  const field = getEditorFieldNameFromElement(textarea);
  const card = draft.cards.find((item) => item.id === cardId);
  if (!card) return;

  if (field === "question") {
    card.question = textarea.value;
    const questionPreview = document.querySelector(`[data-editor-list-question="${card.id}"]`);
    if (questionPreview) questionPreview.textContent = card.question.trim() || "Yeni kart";
  } else {
    card.explanationMarkdown = textarea.value;
    const preview = document.querySelector(`[data-editor-preview="${card.id}"]`);
    if (preview) preview.innerHTML = renderAnswerMarkdown(card.explanationMarkdown);
  }

  if (options.recordHistory !== false) {
    recordEditorFieldHistory(draft, cardId, field, textarea.value);
  }
  rememberEditorFieldSelection(textarea);
  saveEditorFieldHeight(draft, textarea);
  markDraftDirty(draft.setId, true);
  renderEditorTabs();
}

function setFocusedEditorField(textarea) {
  rememberEditorFieldSelection(textarea);
}

function getFocusedEditorFieldElement(options = {}) {
  const focusedField = editorState.focusedField;
  if (!focusedField || focusedField.setId !== getCurrentEditorDraft()?.setId) return null;
  const targetField = document.querySelector(`[data-editor-field="${focusedField.field}"][data-card-id="${focusedField.cardId}"]`);
  if (targetField && options.restoreSelection) restoreEditorFieldSelection(targetField);
  return targetField;
}

function resolveEditorToolbarTarget(cardId) {
  const focusedField = getFocusedEditorFieldElement({ restoreSelection: true });
  if (focusedField && focusedField.getAttribute("data-card-id") === cardId) {
    return focusedField;
  }

  return document.querySelector(`[data-editor-field="question"][data-card-id="${cardId}"]`)
    || document.querySelector(`[data-editor-field="answer"][data-card-id="${cardId}"]`);
}

function bindEditorTextareaState(draft, textarea) {
  const syncSelection = () => rememberEditorFieldSelection(textarea);

  textarea.addEventListener("focus", () => setFocusedEditorField(textarea));
  textarea.addEventListener("click", syncSelection);
  textarea.addEventListener("input", () => syncEditorFieldFromTextarea(draft, textarea));
  textarea.addEventListener("keyup", syncSelection);
  textarea.addEventListener("mouseup", () => {
    syncSelection();
    saveEditorFieldHeight(draft, textarea);
  });
  textarea.addEventListener("select", syncSelection);
  textarea.addEventListener("scroll", syncSelection);
  textarea.addEventListener("blur", syncSelection);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => saveEditorFieldHeight(draft, textarea));
    resizeObserver.observe(textarea);
  }
}

function bindEditorPreviewState(draft, preview) {
  const syncPreviewHeight = () => saveEditorFieldHeight(draft, preview);
  preview.addEventListener("mouseup", syncPreviewHeight);
  preview.addEventListener("pointerup", syncPreviewHeight);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(syncPreviewHeight);
    resizeObserver.observe(preview);
  }
}

function applyEditorHistoryAction(draft, action) {
  const textarea = getFocusedEditorFieldElement({ restoreSelection: true });
  if (!textarea) {
    showEditorStatus("Geri al / ileri al için önce bir metin alanına tıkla.", "error");
    return;
  }

  const cardId = textarea.getAttribute("data-card-id");
  const field = getEditorFieldNameFromElement(textarea);
  const history = getEditorFieldHistory(draft, cardId, field, textarea.value);
  const nextIndex = action === "undo" ? history.index - 1 : history.index + 1;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return;

  history.index = nextIndex;
  textarea.value = history.entries[nextIndex];
  syncEditorFieldFromTextarea(draft, textarea, { recordHistory: false });
  textarea.focus();
  const valueLength = textarea.value.length;
  textarea.setSelectionRange(valueLength, valueLength);
  rememberEditorFieldSelection(textarea);
}

function bindEditorEvents(draft) {
  document.querySelectorAll("[data-editor-toggle-list]").forEach((button) => {
    button.addEventListener("click", () => {
      persistFocusedEditorFieldState(draft);
      draft.listPanelOpen = !draft.listPanelOpen;
      renderEditor();
    });
  });
  document.getElementById("editor-add-card-btn")?.addEventListener("click", () => {
    persistFocusedEditorFieldState(draft);
    addEditorCard(draft);
    renderEditor();
  });
  document.querySelectorAll("[data-editor-toggle-delete-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleEditorDeleteSelectionMode(draft);
      renderEditor();
    });
  });
  document.querySelectorAll("[data-editor-delete-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      toggleEditorDeleteCardSelection(draft, checkbox.getAttribute("data-editor-delete-select"), event.currentTarget?.checked === true);
      renderEditor();
    });
  });
  document.querySelectorAll("[data-editor-delete-selected]").forEach((button) => {
    button.addEventListener("click", () => {
      const deletedCount = deleteSelectedEditorCards(draft);
      if (!deletedCount) return;
      renderEditor();
      showEditorStatus(
        deletedCount === 1 ? "Seçili kart silindi." : `${deletedCount} kart silindi.`,
        "success",
      );
    });
  });
  document.querySelectorAll("[data-editor-select-card]").forEach((button) => {
    button.addEventListener("click", () => {
      persistFocusedEditorFieldState(draft);
      const cardId = button.getAttribute("data-editor-select-card");
      setEditorActiveCardById(draft, cardId);
      renderEditor();
    });
  });
  document.querySelectorAll("[data-preview-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-preview-toggle");
      draft.expandedPreviewCardId = draft.expandedPreviewCardId === cardId ? null : cardId;
      renderEditor();
    });
  });
  document.querySelectorAll("[data-editor-split-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const cardId = handle.getAttribute("data-editor-split-handle");
      startEditorSplitDrag(draft, cardId, handle, event);
    });
    handle.addEventListener("keydown", (event) => {
      const cardId = handle.getAttribute("data-editor-split-handle");
      handleEditorSplitHandleKeydown(draft, cardId, event);
    });
  });
  document.querySelectorAll('[data-editor-field="question"], [data-editor-field="answer"]').forEach((textarea) => {
    bindEditorTextareaState(draft, textarea);
  });
  document.querySelectorAll("[data-editor-height-field='preview']").forEach((preview) => {
    bindEditorPreviewState(draft, preview);
  });
  document.querySelectorAll("[data-editor-subject-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const card = draft.cards.find((item) => item.id === input.getAttribute("data-editor-subject-input"));
      if (!card) return;
      card.subject = input.value;
      markDraftDirty(draft.setId, true);
      renderEditorTabs();
    });
  });
  document.querySelectorAll("[data-md-action]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-md-action");
      if (action === "undo" || action === "redo") {
        applyEditorHistoryAction(draft, action);
        return;
      }
      const cardId = button.getAttribute("data-card-id");
      const textarea = resolveEditorToolbarTarget(cardId);
      if (textarea) {
        setFocusedEditorField(textarea);
        applyMarkdownSnippet(textarea, action);
      }
    });
  });
  const rawInput = document.getElementById("editor-raw-input");
  if (rawInput) {
    const syncRawInputState = () => saveRawEditorState(draft, rawInput);
    rawInput.addEventListener("input", () => {
      draft.rawSource = rawInput.value;
      markDraftDirty(draft.setId, true);
      renderEditorTabs();
      syncRawInputState();
    });
    rawInput.addEventListener("click", syncRawInputState);
    rawInput.addEventListener("focus", syncRawInputState);
    rawInput.addEventListener("keyup", syncRawInputState);
    rawInput.addEventListener("mouseup", syncRawInputState);
    rawInput.addEventListener("select", syncRawInputState);
    rawInput.addEventListener("scroll", syncRawInputState);
    rawInput.addEventListener("blur", syncRawInputState);
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(syncRawInputState);
      resizeObserver.observe(rawInput);
    }
  }
}

function flushEditorPendingScroll() {
  if (!editorState.pendingScrollCardId) return;
  const targetCard = document.querySelector(`[data-editor-card-root="${editorState.pendingScrollCardId}"]`);
  editorState.pendingScrollCardId = null;
  if (!targetCard) return;
  targetCard.scrollIntoView({ block: "nearest", behavior: "auto" });
}

function flushEditorFocusedField() {
  const targetField = getFocusedEditorFieldElement({ restoreSelection: true });
  if (!targetField) return;
  saveEditorFieldHeight(getCurrentEditorDraft(), targetField);
}

function renderEditor() {
  stopEditorSplitDrag();
  const previousDraft = getCurrentEditorDraft();
  if (previousDraft) {
    persistCurrentEditorUiState(previousDraft);
  }
  renderEditorTabs();
  refreshEditorPills();
  showEditorStatus("", "");
  const panel = document.getElementById("editor-panel");
  const draft = getCurrentEditorDraft();
  if (!panel || !draft) {
    if (panel) panel.innerHTML = "";
    return;
  }
  ensureEditorDraftUiState(draft);
  panel.className = `editor-panel ${draft.viewMode === "form" ? "editor-panel--form" : "editor-panel--raw"}`;
  panel.innerHTML = draft.viewMode === "form" ? renderEditorForm(draft) : renderEditorRaw(draft);
  bindEditorEvents(draft);
  flushEditorPendingScroll();
  flushEditorFocusedField();
  restoreRawEditorState(draft);
}

function confirmLeaveEditor() {
  return !Object.values(editorState.drafts).some((draft) => draft.dirty) || confirm("Kaydedilmemiş değişiklikler var. Editörden çıkmak istediğine emin misin?");
}

function closeEditor(force = false) {
  if (!force && !confirmLeaveEditor()) return;
  editorState = {
    isOpen: false,
    activeSetId: null,
    draftOrder: [],
    drafts: {},
    focusedField: null,
    pendingScrollCardId: null,
  };
  renderSetList();
  showScreen("manager");
}

function openEditorForSelectedSets() {
  const targetSetIds = [...selectedSets].filter((setId) => loadedSets[setId]);
  if (!targetSetIds.length) return;
  editorState = {
    isOpen: true,
    activeSetId: targetSetIds[0],
    draftOrder: targetSetIds,
    drafts: Object.fromEntries(targetSetIds.map((setId) => [setId, createEditorDraft(loadedSets[setId])])),
    focusedField: null,
    pendingScrollCardId: null,
  };
  showScreen("editor");
  renderEditor();
}

async function toggleEditorViewMode() {
  const draft = getCurrentEditorDraft();
  if (!draft) return;
  try {
    persistCurrentEditorUiState(draft);
    if (draft.viewMode === "form") {
      buildRawSourceFromDraft(draft);
      draft.viewMode = "raw";
    } else {
      syncDraftFromRaw(draft);
      draft.viewMode = "form";
    }
    renderEditor();
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Raw içerik çözümlenemedi.", "error");
  }
}

function formatEditorConflictTimestamp(isoValue) {
  if (!isoValue) return "bilinmeyen bir zamanda";
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) return isoValue;
  return parsedDate.toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function resolveEditorConflictDraft(draft, remoteRecord) {
  loadedSets[remoteRecord.id] = remoteRecord;
  syncPersistedSetSourcePaths();
  const refreshedDraft = createEditorDraft(remoteRecord, draft);
  refreshedDraft.viewMode = draft.viewMode;
  if (refreshedDraft.viewMode === "raw") refreshedDraft.rawSource = remoteRecord.rawSource;
  editorState.drafts[remoteRecord.id] = refreshedDraft;
}

async function saveEditorDrafts() {
  if (!editorState.draftOrder.length) return;
  try {
    persistCurrentEditorUiState(getCurrentEditorDraft());
    showEditorStatus("Değişiklikler kaydediliyor...");
    const savePlan = editorState.draftOrder.map((setId) => {
      const draft = editorState.drafts[setId];
      return {
        setId,
        draft,
        previousRecord: loadedSets[setId],
        nextRecord: {
          ...resolveEditorDraftRecord(draft),
          baseUpdatedAt: draft.baseUpdatedAt,
        },
      };
    });
    const browserLinkPreparation = await primeBrowserLinkedSaveTargets(
      savePlan.map((entry) => entry.nextRecord),
    );
    if (!browserLinkPreparation.ready) {
      showEditorStatus("Kaydetme iptal edildi. Bağlı dosyayı seçmeden aynı dosyaya yazılamaz.", "error");
      return;
    }
    let sourceWriteCount = 0;
    let browserRelinkCount = 0;
    for (const planEntry of savePlan) {
      const { setId, draft, previousRecord, nextRecord } = planEntry;
      let savedRecord = null;

      try {
        savedRecord = await platformAdapter.saveSet(nextRecord);
      } catch (error) {
        if (error?.code !== "REMOTE_CONFLICT" || !error.remoteRecord) {
          throw error;
        }

        const remoteRecord = normalizeSetRecord(error.remoteRecord, { previousRecord: error.remoteRecord });
        remoteRecord.rawSource = backfillRawSource(remoteRecord);
        const shouldLoadRemote = confirm(
          `"${remoteRecord.setName}" setinin bulutta ${formatEditorConflictTimestamp(remoteRecord.updatedAt)} tarihinde kaydedilmiş daha yeni bir sürümü var.\n\nTamam: Buluttaki sürümü yükle\nİptal: Benim değişikliklerimle üzerine yaz`,
        );

        if (shouldLoadRemote) {
          resolveEditorConflictDraft(draft, remoteRecord);
          renderSetList();
          renderEditor();
          showEditorStatus("Buluttaki daha yeni sürüm yüklendi. İstersen bu sürüm üzerinde devam edebilirsin.", "success");
          return;
        }

        savedRecord = await platformAdapter.saveSet({
          ...nextRecord,
          baseUpdatedAt: null,
          forceOverwrite: true,
        });
      }

      cleanupAssessmentsForSet(savedRecord, previousRecord);
      if (savedRecord?.sourcePath) {
        if (
          isDesktopRuntime() &&
          typeof platformAdapter.writeSetSourceFile === "function"
        ) {
          await platformAdapter.writeSetSourceFile(savedRecord.sourcePath, savedRecord.rawSource);
          sourceWriteCount += 1;
        } else if (isBrowserRelinkableSourcePath(savedRecord.sourcePath)) {
          const browserWriteResult = await writeBrowserLinkedSourceFile(
            savedRecord.sourcePath,
            savedRecord.rawSource,
          );
          if (browserWriteResult.wrote) {
            sourceWriteCount += 1;
          } else if (browserWriteResult.relinkRequired) {
            browserRelinkCount += 1;
          }
        }
      }
      loadedSets[savedRecord.id] = savedRecord;
      const refreshedDraft = createEditorDraft(savedRecord, draft);
      refreshedDraft.viewMode = draft.viewMode;
      if (refreshedDraft.viewMode === "raw") refreshedDraft.rawSource = savedRecord.rawSource;
      editorState.drafts[setId] = refreshedDraft;
    }
    syncPersistedSetSourcePaths();
    saveStudyState();
    renderSetList();
    renderEditor();
    showEditorStatus(
      browserRelinkCount > 0
        ? "Değişiklikler kaydedildi. Dış dosyaya yeniden bağlanmak için dosyayı seçmelisin."
        : sourceWriteCount > 0
        ? "Değişiklikler kaydedildi ve bağlı yerel dosyalara yazıldı."
        : "Değişiklikler kaydedildi.",
      "success",
    );
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Kaydetme sırasında hata oluştu.", "error");
  }
}

function exportActiveEditorDraft() {
  const draft = getCurrentEditorDraft();
  if (!draft) return;

  try {
    const nextRecord = resolveEditorDraftRecord(draft);
    const fileName =
      nextRecord.fileName ||
      `${slugify(nextRecord.setName)}.${nextRecord.sourceFormat === "markdown" ? "md" : "json"}`;
    const mimeType =
      nextRecord.sourceFormat === "markdown"
        ? "text/markdown;charset=utf-8"
        : "application/json;charset=utf-8";
    const downloadUrl = URL.createObjectURL(new Blob([nextRecord.rawSource], { type: mimeType }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    showEditorStatus(`Dosya dışa aktarıldı: ${fileName}`, "success");
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Dosya dışa aktarılamadı.", "error");
  }
}

function setAutoAdvance(isEnabled) {
  autoAdvanceEnabled = Boolean(isEnabled);
  syncAutoAdvanceToggleUI();
  saveStudyState();
}

function formatBuildDate(isoDate) {
  if (!isoDate) return "tarih-bilinmiyor";
  const parsedDate = new Date(isoDate);
  if (Number.isNaN(parsedDate.getTime())) return isoDate;
  return parsedDate.toLocaleString("tr-TR", { hour12: false });
}

function shouldShowBuildMeta() {
  const params = new URLSearchParams(window.location.search);
  return params.get("buildMeta") === "1" || localStorage.getItem("show-build-meta") === "1";
}

function renderBuildMeta() {
  const metaElement = document.getElementById("build-meta");
  const buildInfo = window.__BUILD_INFO__;
  if (!metaElement || !buildInfo || !shouldShowBuildMeta()) {
    if (metaElement) {
      metaElement.textContent = "";
      metaElement.style.display = "none";
    }
    return;
  }
  metaElement.textContent = `Build ${buildInfo.version || "unknown"} (${buildInfo.commit || "nogit"}) | ${formatBuildDate(buildInfo.builtAt)} | ${buildInfo.source || "unknown"} | ${buildInfo.buildId || "unknown"}`;
  metaElement.style.display = "block";
}

function initGoogleDrive() {
  if (!window.google || !window.google.accounts || !window.gapi) {
    setTimeout(initGoogleDrive, 500);
    return;
  }
  gapi.load("picker", () => {
    pickerApiLoaded = true;
  });
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: DRIVE_CLIENT_ID,
    scope: DRIVE_SCOPES,
    callback: (tokenResponse) => {
      if (tokenResponse?.access_token) {
        driveAccessToken = tokenResponse.access_token;
        launchDrivePicker();
      }
    },
  });
}

function authGoogleDrive() {
  if (!tokenClient || !pickerApiLoaded) {
    alert("Google Drive entegrasyonu henüz hazır değil.");
    return;
  }
  tokenClient.requestAccessToken({ prompt: "" });
}

function launchDrivePicker() {
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

function pickerCallback(data) {
  if (data.action === google.picker.Action.PICKED) {
    const file = data.docs[0];
    void downloadAndLoadDriveFile(file.id, file.name);
  }
}

async function downloadAndLoadDriveFile(fileId, fileName) {
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

function bindStaticEvents() {
  document.getElementById("auth-signin-btn")?.addEventListener("click", () => void attemptAuth("signin"));
  document.getElementById("auth-signup-btn")?.addEventListener("click", () => void attemptAuth("signup"));
  document.getElementById("auth-demo-btn")?.addEventListener("click", () => void handleDemoAuth());
  document.getElementById("auth-remember-me")?.addEventListener("change", (event) => {
    setRememberMePreference(event.currentTarget?.checked !== false);
  });
  document.getElementById("check-updates-btn")?.addEventListener("click", () => void checkDesktopForUpdates("manual"));
  document.getElementById("sign-out-btn")?.addEventListener("click", () => void signOut());
  document.getElementById("editor-back-btn")?.addEventListener("click", () => closeEditor());
  document.getElementById("editor-view-toggle-btn")?.addEventListener("click", () => void toggleEditorViewMode());
  document.getElementById("editor-export-btn")?.addEventListener("click", () => exportActiveEditorDraft());
  document.getElementById("editor-save-btn")?.addEventListener("click", () => void saveEditorDrafts());
  document.getElementById("jump-input")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    jumpToCard();
  });
  document.addEventListener("keydown", (event) => {
    const tagName = event.target?.tagName;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editorState.isOpen) {
      event.preventDefault();
      void saveEditorDrafts();
      return;
    }
    if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") return;
    if ((event.key === "f" || event.key === "F") && document.getElementById("app-container").style.display !== "none") {
      event.preventDefault();
      toggleFullscreen();
      return;
    }
    if ((event.key === "s" || event.key === "S") && document.getElementById("app-container").style.display !== "none") {
      event.preventDefault();
      flipCard();
      return;
    }
    if (event.key === "Escape" && isFullscreen) {
      toggleFullscreen();
      return;
    }
    if (event.key === "ArrowLeft") previousCard();
    else if (event.key === "ArrowRight") nextCard();
    else if (event.key === " ") {
      event.preventDefault();
      flipCard();
    } else if (event.key === "1" && isFlipped) {
      event.preventDefault();
      assessCard("know");
    } else if (event.key === "2" && isFlipped) {
      event.preventDefault();
      assessCard("review");
    } else if (event.key === "3" && isFlipped) {
      event.preventDefault();
      assessCard("dunno");
    } else if (event.key === "ArrowDown" && isFlipped) {
      event.preventDefault();
      document.querySelector(".card-back").scrollTop += 50;
    } else if (event.key === "ArrowUp" && isFlipped) {
      event.preventDefault();
      document.querySelector(".card-back").scrollTop -= 50;
    }
  });
  if (hasSupabaseConfig()) document.getElementById("auth-demo-btn")?.setAttribute("hidden", "hidden");
  syncDesktopUpdateButton();
}

function exposeWindowApi() {
  Object.assign(window, {
    assessCard,
    authGoogleDrive,
    clearSetSelection,
    deleteSet,
    filterByTopic,
    flipCard,
    handleFileSelect,
    jumpToCard,
    nextCard,
    openEditorForSelectedSets,
    previousCard,
    printCards,
    removeSelectedSets,
    resetProgress,
    selectAllSets,
    setAutoAdvance,
    setFilter,
    showSetManager,
    shuffleCards,
    startStudy,
    triggerSetImport,
    toggleBulkSetSelection,
    toggleFullscreen,
    toggleSetCheck,
    toggleTheme,
    undoLastRemoval,
  });
}

async function bootstrap() {
  renderBuildMeta();
  window.ThemeManager.renderThemeOptions(THEME_CONTROL_IDS);
  window.ThemeManager.initThemeFromStorage({
    storageKey: THEME_KEY,
    storageApi: storage,
    controlIds: THEME_CONTROL_IDS,
  });
  syncThemeControlsUI();
  syncRememberMeUi();
  bindStaticEvents();
  updateManagerUserChip();
  exposeWindowApi();
  platformAdapter.subscribeAuthState((user, event) => {
    void handleAuthStateChange(user, event);
  });
  initGoogleDrive();
}

bootstrap().catch((error) => {
  console.error(error);
  showAuthStatus(error.message || "Uygulama başlatılamadı.", "error");
  showScreen("auth");
  markAppReady();
});
