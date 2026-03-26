import { createPlatformAdapter } from "../core/platform-adapter.js";
import { hasSupabaseConfig } from "../core/runtime-config.js";
import {
  backfillRawSource,
  buildEditorDraft,
  buildSetFromEditorDraft,
  normalizeSetRecord,
  parseSetText,
  renderAnswerMarkdown,
  slugify,
} from "../core/set-codec.js";

const APP_NAMESPACE = "fc_v2";
const THEME_KEY = "fc_theme";
const LEGACY_KEYS = {
  session: "fc_session",
  sets: "fc_loaded_sets",
  assessments: "fc_assessments",
  autoAdvance: "fc_auto_advance",
  selectedSets: "fc_selected_sets",
  legacyState: "flashcards_state_v6",
};

const DRIVE_CLIENT_ID = "102976125468-1mq0m7ptikns377eso8gmnaaioac17fv.apps.googleusercontent.com";
const DRIVE_API_KEY = "AIzaSyCUvy3PvFNpAVL9FYvLF22lzUPJ9xZHWrw";
const DRIVE_APP_ID = "102976125468";
const DRIVE_SCOPES = "https://www.googleapis.com/auth/drive.readonly";

const storage = window.AppStorage;
const platformAdapter = createPlatformAdapter(storage);

let currentUser = null;
let loadedSets = {};
let selectedSets = new Set();
let removeCandidateSets = new Set();
let deleteMode = false;
let editMode = false;
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

let editorState = { isOpen: false, activeSetId: null, draftOrder: [], drafts: {}, focusedField: null };

let tokenClient = null;
let driveAccessToken = null;
let pickerApiLoaded = false;

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

function markAppReady() {
  document.body.classList.remove("app-booting");
}

function syncThemeToggleUI() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  const themeToggle = document.getElementById("theme-toggle");
  const managerToggle = document.getElementById("theme-toggle-manager");
  if (themeToggle) themeToggle.checked = isDark;
  if (managerToggle) managerToggle.checked = isDark;
}

function toggleTheme(isChecked) {
  window.ThemeManager.toggleTheme({
    isChecked,
    primaryToggleId: "theme-toggle",
    managerToggleId: "theme-toggle-manager",
    storageKey: THEME_KEY,
    storageApi: storage,
  });
  syncThemeToggleUI();
}

function syncAutoAdvanceToggleUI() {
  const toggle = document.getElementById("auto-advance-toggle-manager");
  const status = document.getElementById("auto-advance-status");
  if (toggle) toggle.checked = autoAdvanceEnabled;
  if (status) status.textContent = autoAdvanceEnabled ? "Otomatik sonraki soru: Açık" : "Otomatik sonraki soru: Kapalı";
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
  setUserJson("selected_sets", [...selectedSets]);
}

function saveStudyState() {
  if (!currentUser) return;
  setUserJson("assessments", assessments);
  setUserText("auto_advance", autoAdvanceEnabled ? "1" : "0");
  const activeCard = filteredFlashcards.length > 0 ? filteredFlashcards[cardOrder[currentCardIndex]] : null;
  setUserJson("session", {
    currentCardIndex,
    currentCardKey: activeCard ? getCardKey(activeCard) : null,
    topic: document.getElementById("topic-select")?.value || "hepsi",
    activeFilter,
    autoAdvanceEnabled,
  });
  saveSelectedSets();
}

function hydrateLoadedSets(records) {
  loadedSets = {};
  normalizeSetCollection(records).forEach((record) => {
    loadedSets[record.id] = record;
  });
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
    setUserJson("assessments", assessments);
  }
}

function loadUserStudyState() {
  const storedSelected = getUserJson("selected_sets", []);
  selectedSets = Array.isArray(storedSelected) && storedSelected.length
    ? new Set(storedSelected.filter((setId) => loadedSets[setId]))
    : new Set(Object.keys(loadedSets));
  assessments = getUserJson("assessments", {});
  if (!assessments || typeof assessments !== "object" || Array.isArray(assessments)) assessments = {};
  const autoAdvanceRaw = getUserText("auto_advance");
  autoAdvanceEnabled = autoAdvanceRaw === null ? true : autoAdvanceRaw === "1";
  syncAutoAdvanceToggleUI();
  migrateLegacyAssessmentsIfNeeded();
}

async function loadUserWorkspace() {
  let records = await platformAdapter.loadSets();
  hydrateLoadedSets(records);
  if (await migrateLegacyLocalData()) {
    records = await platformAdapter.loadSets();
    hydrateLoadedSets(records);
  }
  loadUserStudyState();
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
    loadedSets = {};
    selectedSets = new Set();
    removeCandidateSets.clear();
    assessments = {};
    editorState = { isOpen: false, activeSetId: null, draftOrder: [], drafts: {}, focusedField: null };
    renderSetList();
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
      showScreen("auth");
      markAppReady();
    }
  }
}

async function attemptAuth(action) {
  const email = document.getElementById("auth-email")?.value || "";
  const password = document.getElementById("auth-password")?.value || "";
  try {
    showAuthStatus(action === "signup" ? "Hesap oluşturuluyor..." : "Giriş yapılıyor...");
    if (action === "signup") {
      const response = await platformAdapter.signUp(email, password);
      if (response?.needsConfirmation) {
        showAuthStatus("Kayıt oluşturuldu. E-posta doğrulaması gerekebilir.", "success");
        return;
      }
    } else {
      await platformAdapter.signIn(email, password);
    }
    showAuthStatus("", "");
  } catch (error) {
    console.error(error);
    showAuthStatus(error.message || "Giriş başarısız oldu.", "error");
  }
}

async function handleDemoAuth() {
  try {
    showAuthStatus("Yerel demo oturumu açılıyor...");
    await platformAdapter.signInDemo();
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

async function importSetFromText(text, fileName) {
  const existingRecord = findExistingSetMatch(fileName);
  const nextRecord = parseSetText(text, fileName, existingRecord, existingRecord?.sourceFormat);
  const savedRecord = await platformAdapter.saveSet(nextRecord);
  loadedSets[savedRecord.id] = savedRecord;
  selectedSets.add(savedRecord.id);
  saveSelectedSets();
  renderSetList();
  return savedRecord;
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
  if (deleteMode) {
    if (removeCandidateSets.has(setId)) removeCandidateSets.delete(setId);
    else removeCandidateSets.add(setId);
    renderSetList();
    return;
  }
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
      delete loadedSets[entry.setId];
      selectedSets.delete(entry.setId);
      removeCandidateSets.delete(entry.setId);
    });
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
  if (deleteMode) {
    removeCandidateSets = new Set(Object.keys(loadedSets));
    renderSetList();
    return;
  }
  selectedSets = new Set(Object.keys(loadedSets));
  saveSelectedSets();
  renderSetList();
}

function clearSetSelection() {
  if (deleteMode) {
    removeCandidateSets.clear();
    renderSetList();
    return;
  }
  selectedSets.clear();
  saveSelectedSets();
  renderSetList();
}

async function removeSelectedSets() {
  if (!deleteMode || !removeCandidateSets.size) return;
  await removeSets([...removeCandidateSets]);
}

function toggleDeleteMode() {
  deleteMode = !deleteMode;
  if (deleteMode) {
    editMode = false;
  } else {
    removeCandidateSets.clear();
  }
  renderSetList();
}

function toggleEditMode() {
  editMode = !editMode;
  if (editMode) {
    deleteMode = false;
    removeCandidateSets.clear();
  }
  renderSetList();
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
    saveSelectedSets();
    renderSetList();
    document.getElementById("undo-toast").style.display = "none";
    lastRemovedSets = [];
  } catch (error) {
    console.error(error);
    showUndoToast("Geri alma tamamlanamadı.");
  }
}

function renderSetList() {
  const listElement = document.getElementById("set-list");
  const toolsElement = document.getElementById("set-list-tools");
  const startButton = document.getElementById("start-btn");
  const removeSelectedButton = document.getElementById("remove-selected-btn");
  const deleteModeButton = document.getElementById("delete-mode-btn");
  const editModeButton = document.getElementById("edit-mode-btn");
  const editSelectedButton = document.getElementById("edit-selected-btn");
  const selectAllButton = document.getElementById("select-all-btn");
  const clearSelectionButton = document.getElementById("clear-selection-btn");
  const modeHint = document.getElementById("mode-hint");
  if (!listElement) return;
  const setIds = Object.keys(loadedSets);
  if (!setIds.length) {
    listElement.innerHTML = '<div class="set-item empty">Henüz set yüklenmedi.</div>';
    if (toolsElement) toolsElement.style.display = "none";
    if (startButton) startButton.disabled = true;
    if (removeSelectedButton) removeSelectedButton.disabled = true;
    if (editSelectedButton) editSelectedButton.disabled = true;
    return;
  }
  if (toolsElement) toolsElement.style.display = "flex";
  if (startButton) startButton.disabled = selectedSets.size === 0 || editMode;
  if (deleteModeButton) {
    deleteModeButton.textContent = deleteMode ? "Silme Modu: Açık" : "Silme Modu: Kapalı";
    deleteModeButton.className = deleteMode ? "btn btn-small btn-danger" : "btn btn-small btn-secondary";
  }
  if (editModeButton) {
    editModeButton.textContent = editMode ? "Düzenleme Modu: Açık" : "Düzenleme Modu: Kapalı";
    editModeButton.className = editMode ? "btn btn-small" : "btn btn-small btn-secondary";
  }
  if (selectAllButton) selectAllButton.textContent = deleteMode ? "Silineceklerin Tümünü Seç" : editMode ? "Düzenleneceklerin Tümünü Seç" : "Tümünü Derse Dahil Et";
  if (clearSelectionButton) clearSelectionButton.textContent = deleteMode ? "Silme Seçimini Temizle" : editMode ? "Düzenleme Seçimini Temizle" : "Ders Seçimini Temizle";
  if (removeSelectedButton) {
    removeSelectedButton.disabled = !deleteMode || removeCandidateSets.size === 0;
    removeSelectedButton.textContent = `Seçilileri Kaldır (${removeCandidateSets.size})`;
  }
  if (editSelectedButton) {
    editSelectedButton.disabled = !editMode || selectedSets.size === 0;
    editSelectedButton.textContent = `Kartları Düzenle (${selectedSets.size})`;
  }
  if (modeHint) {
    modeHint.textContent = deleteMode
      ? "Mod: Sileceğin setleri işaretliyorsun."
      : editMode
        ? "Mod: Düzenleyeceğin setleri seçiyorsun."
        : "Mod: Derse dahil edilecek setleri seçiyorsun.";
  }
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
    const isSelected = deleteMode ? removeCandidateSets.has(setId) : selectedSets.has(setId);
    const row = document.createElement("div");
    row.className = "set-item";
    row.innerHTML = `
      <div class="set-info" data-set-select="${setId}">
        <input type="checkbox" ${isSelected ? "checked" : ""} data-set-checkbox="${setId}">
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
}

const getPersistedSession = () => {
  const session = getUserJson("session", null);
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
  if (!selectedSets.size || editMode) return;
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
  document.getElementById("question-text").textContent = card.q;
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
  if (isFullscreen) {
    container.classList.add("fullscreen-active");
    document.body.style.overflow = "hidden";
    document.getElementById("fullscreen-toggle-btn").textContent = "✕";
    document.getElementById("fullscreen-toggle-btn").title = "Tam ekrandan çık (ESC / F)";
  } else {
    container.classList.remove("fullscreen-active");
    document.body.style.overflow = "auto";
    document.getElementById("fullscreen-toggle-btn").textContent = "⛶";
    document.getElementById("fullscreen-toggle-btn").title = "Tam ekran (F)";
  }
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
      <div style="font-size:15px; font-weight:600; margin-bottom:12px; color:#21302a; white-space:pre-line;">${card.q}</div>
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
  const availableCardIds = new Set((draft?.cards || []).map((card) => card.id));
  if (!availableCardIds.size) {
    draft.expandedCardId = null;
    draft.toolbarExpandedCardId = null;
    draft.expandedPreviewCardId = null;
    return draft;
  }
  if (draft.expandedCardId === undefined) {
    draft.expandedCardId = null;
  } else if (draft.expandedCardId !== null && !availableCardIds.has(draft.expandedCardId)) {
    draft.expandedCardId = null;
  }
  if (draft.toolbarExpandedCardId && !availableCardIds.has(draft.toolbarExpandedCardId)) {
    draft.toolbarExpandedCardId = null;
  }
  if (draft.expandedPreviewCardId && !availableCardIds.has(draft.expandedPreviewCardId)) {
    draft.expandedPreviewCardId = null;
  }
  return draft;
}

const getCurrentEditorDraft = () => editorState.activeSetId ? editorState.drafts[editorState.activeSetId] : null;
function createEditorDraft(setRecord, previousDraft = null) {
  const baseDraft = buildEditorDraft(setRecord);
  return ensureEditorDraftUiState({
    ...baseDraft,
    dirty: false,
    expandedCardId: previousDraft ? previousDraft.expandedCardId : null,
    toolbarExpandedCardId: previousDraft?.toolbarExpandedCardId ?? null,
    expandedPreviewCardId: previousDraft?.expandedPreviewCardId ?? null,
  });
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

function renderEditorForm(draft) {
  ensureEditorDraftUiState(draft);
  return `<div class="editor-card-list">${draft.cards.map((card, index) => {
    const isExpanded = draft.expandedCardId === card.id;
    const isOverflowOpen = draft.toolbarExpandedCardId === card.id;
    const questionPreview = card.question?.trim() || "Soru eklenmedi.";
    return `
      <section class="editor-card ${isExpanded ? "is-open" : ""}">
        <button type="button" class="editor-card-toggle" data-editor-toggle="${card.id}" aria-expanded="${isExpanded}">
          <div class="editor-card-head">
            <div class="editor-card-head-main">
              <div class="editor-card-title">Kart ${index + 1}</div>
              <div class="editor-card-question" data-editor-question-preview="${card.id}">${escapeMarkup(questionPreview)}</div>
              <div class="editor-card-summary" data-editor-summary-preview="${card.id}">${escapeMarkup(summarizeMarkdownText(card.explanationMarkdown))}</div>
            </div>
            <div class="editor-card-head-side">
              <span class="status-pill">Konu: ${escapeMarkup(card.subject)}</span>
              <span class="editor-card-chevron" aria-hidden="true">${isExpanded ? "−" : "+"}</span>
            </div>
          </div>
        </button>
        <div class="editor-card-body ${isExpanded ? "" : "hidden"}">
          <div class="field-group">
            <label>Soru</label>
            <textarea data-editor-field="question" data-card-id="${card.id}" style="min-height:90px;" placeholder="Soruyu yaz...">${escapeMarkup(card.question)}</textarea>
          </div>
          <div class="editor-split">
            <div>
              <div class="field-group">
                <label>Açıklama (Markdown)</label>
                <textarea data-editor-field="answer" data-card-id="${card.id}" style="min-height:220px;" placeholder="Markdown açıklamasını yaz...">${escapeMarkup(card.explanationMarkdown)}</textarea>
              </div>
              <div class="editor-toolbar-shell">
                <div class="editor-toolbar editor-toolbar-primary">
                  ${renderEditorToolbarButtons(primaryMarkdownActions, card.id)}
                  <button type="button" class="btn btn-small btn-secondary editor-toolbar-overflow ${isOverflowOpen ? "active" : ""}" data-toolbar-toggle="${card.id}" aria-expanded="${isOverflowOpen}" title="Daha fazla araç" aria-label="Daha fazla araç">...</button>
                </div>
                <div class="editor-toolbar editor-toolbar-secondary ${isOverflowOpen ? "" : "hidden"}">
                  ${renderEditorToolbarButtons(overflowMarkdownActions, card.id)}
                </div>
              </div>
            </div>
            <div>
              <div class="field-group">
                <div class="editor-preview-head">
                  <label>Canlı Önizleme</label>
                  <span class="editor-preview-hint">Aşağı çekerek büyüt</span>
                </div>
                <div class="editor-preview" data-editor-preview="${card.id}">${renderAnswerMarkdown(card.explanationMarkdown)}</div>
              </div>
            </div>
          </div>
        </div>
      </section>`;
  }).join("")}</div>`;
}

const renderEditorRaw = (draft) => `<div class="field-group"><label>Raw Code</label><textarea id="editor-raw-input" class="editor-raw">${draft.rawSource}</textarea></div>`;

function applyMarkdownSnippet(textarea, action) {
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
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncEditorFieldFromTextarea(draft, textarea) {
  const card = draft.cards.find((item) => item.id === textarea.getAttribute("data-card-id"));
  if (!card) return;

  if (textarea.getAttribute("data-editor-field") === "question") {
    card.question = textarea.value;
    const questionPreview = document.querySelector(`[data-editor-question-preview="${card.id}"]`);
    if (questionPreview) questionPreview.textContent = card.question.trim() || "Soru eklenmedi.";
  } else {
    card.explanationMarkdown = textarea.value;
    const preview = document.querySelector(`[data-editor-preview="${card.id}"]`);
    if (preview) preview.innerHTML = renderAnswerMarkdown(card.explanationMarkdown);
    const summaryPreview = document.querySelector(`[data-editor-summary-preview="${card.id}"]`);
    if (summaryPreview) summaryPreview.textContent = summarizeMarkdownText(card.explanationMarkdown);
  }

  markDraftDirty(draft.setId, true);
  renderEditorTabs();
}

function setFocusedEditorField(textarea) {
  editorState.focusedField = {
    setId: getCurrentEditorDraft()?.setId || null,
    cardId: textarea.getAttribute("data-card-id"),
    field: textarea.getAttribute("data-editor-field"),
  };
}

function getFocusedEditorFieldElement() {
  const focusedField = editorState.focusedField;
  if (!focusedField || focusedField.setId !== getCurrentEditorDraft()?.setId) return null;
  return document.querySelector(`[data-editor-field="${focusedField.field}"][data-card-id="${focusedField.cardId}"]`);
}

function applyEditorHistoryAction(draft, action) {
  const textarea = getFocusedEditorFieldElement();
  if (!textarea) {
    showEditorStatus("Geri al / ileri al için önce bir metin alanına tıkla.", "error");
    return;
  }

  textarea.focus();
  if (typeof document.execCommand === "function") {
    document.execCommand(action === "undo" ? "undo" : "redo");
    queueMicrotask(() => syncEditorFieldFromTextarea(draft, textarea));
    return;
  }

  showEditorStatus("Tarayıcı bu geri al / ileri al kısayolunu desteklemiyor.", "error");
}

function bindEditorEvents(draft) {
  document.querySelectorAll("[data-editor-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-editor-toggle");
      draft.expandedCardId = draft.expandedCardId === cardId ? null : cardId;
      if (draft.toolbarExpandedCardId && draft.toolbarExpandedCardId !== draft.expandedCardId) {
        draft.toolbarExpandedCardId = null;
      }
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
  document.querySelectorAll("[data-toolbar-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-toolbar-toggle");
      draft.toolbarExpandedCardId = draft.toolbarExpandedCardId === cardId ? null : cardId;
      renderEditor();
    });
  });
  document.querySelectorAll('[data-editor-field="question"]').forEach((textarea) => {
    textarea.addEventListener("focus", () => setFocusedEditorField(textarea));
    textarea.addEventListener("click", () => setFocusedEditorField(textarea));
    textarea.addEventListener("input", () => syncEditorFieldFromTextarea(draft, textarea));
  });
  document.querySelectorAll('[data-editor-field="answer"]').forEach((textarea) => {
    textarea.addEventListener("focus", () => setFocusedEditorField(textarea));
    textarea.addEventListener("click", () => setFocusedEditorField(textarea));
    textarea.addEventListener("input", () => syncEditorFieldFromTextarea(draft, textarea));
  });
  document.querySelectorAll("[data-md-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-md-action");
      if (action === "undo" || action === "redo") {
        applyEditorHistoryAction(draft, action);
        return;
      }
      const cardId = button.getAttribute("data-card-id");
      const textarea = document.querySelector(`[data-editor-field="answer"][data-card-id="${cardId}"]`);
      if (textarea) {
        setFocusedEditorField(textarea);
        applyMarkdownSnippet(textarea, action);
      }
    });
  });
  const rawInput = document.getElementById("editor-raw-input");
  if (rawInput) {
    rawInput.addEventListener("input", () => {
      draft.rawSource = rawInput.value;
      markDraftDirty(draft.setId, true);
      renderEditorTabs();
    });
  }
}

function renderEditor() {
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
  panel.innerHTML = draft.viewMode === "form" ? renderEditorForm(draft) : renderEditorRaw(draft);
  bindEditorEvents(draft);
}

function confirmLeaveEditor() {
  return !Object.values(editorState.drafts).some((draft) => draft.dirty) || confirm("Kaydedilmemiş değişiklikler var. Editörden çıkmak istediğine emin misin?");
}

function closeEditor(force = false) {
  if (!force && !confirmLeaveEditor()) return;
  editorState = { isOpen: false, activeSetId: null, draftOrder: [], drafts: {}, focusedField: null };
  editMode = false;
  renderSetList();
  showScreen("manager");
}

function openEditorForSelectedSets() {
  const targetSetIds = [...selectedSets].filter((setId) => loadedSets[setId]);
  if (!editMode || !targetSetIds.length) return;
  editorState = {
    isOpen: true,
    activeSetId: targetSetIds[0],
    draftOrder: targetSetIds,
    drafts: Object.fromEntries(targetSetIds.map((setId) => [setId, createEditorDraft(loadedSets[setId])])),
    focusedField: null,
  };
  showScreen("editor");
  renderEditor();
}

async function toggleEditorViewMode() {
  const draft = getCurrentEditorDraft();
  if (!draft) return;
  try {
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

async function saveEditorDrafts() {
  if (!editorState.draftOrder.length) return;
  try {
    showEditorStatus("Değişiklikler kaydediliyor...");
    for (const setId of editorState.draftOrder) {
      const draft = editorState.drafts[setId];
      const previousRecord = loadedSets[setId];
      const nextRecord = resolveEditorDraftRecord(draft);
      cleanupAssessmentsForSet(nextRecord, previousRecord);
      const savedRecord = await platformAdapter.saveSet(nextRecord);
      loadedSets[savedRecord.id] = savedRecord;
      const refreshedDraft = createEditorDraft(savedRecord, draft);
      refreshedDraft.viewMode = draft.viewMode;
      if (refreshedDraft.viewMode === "raw") refreshedDraft.rawSource = savedRecord.rawSource;
      editorState.drafts[setId] = refreshedDraft;
    }
    setUserJson("assessments", assessments);
    renderSetList();
    renderEditor();
    showEditorStatus("Değişiklikler kaydedildi.", "success");
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
  document.getElementById("sign-out-btn")?.addEventListener("click", () => void signOut());
  document.getElementById("editor-back-btn")?.addEventListener("click", () => closeEditor());
  document.getElementById("editor-view-toggle-btn")?.addEventListener("click", () => void toggleEditorViewMode());
  document.getElementById("editor-export-btn")?.addEventListener("click", () => exportActiveEditorDraft());
  document.getElementById("editor-save-btn")?.addEventListener("click", () => void saveEditorDrafts());
  document.getElementById("jump-input")?.addEventListener("keypress", (event) => {
    if (event.key === "Enter") jumpToCard();
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
    toggleDeleteMode,
    toggleEditMode,
    toggleFullscreen,
    toggleSetCheck,
    toggleTheme,
    undoLastRemoval,
  });
}

async function bootstrap() {
  renderBuildMeta();
  window.ThemeManager.initThemeFromStorage({
    storageKey: THEME_KEY,
    storageApi: storage,
    primaryToggleId: "theme-toggle",
    managerToggleId: "theme-toggle-manager",
  });
  syncThemeToggleUI();
  bindStaticEvents();
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
