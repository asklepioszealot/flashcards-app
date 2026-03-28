// src/features/study-state/study-state.js
// Study state persistence: snapshots, sync, migration, workspace loading.

import {
  APP_NAMESPACE, USER_STUDY_STATE_KEY, LEGACY_KEYS,
} from "../../shared/constants.js";
import { nowIso, cloneData, isPlainObject, normalizeStudyStateSnapshot, safeJsonParse } from "../../shared/utils.js";
import {
  currentUser,
  loadedSets,
  selectedSets, setSelectedSets,
  assessments, setAssessments,
  reviewSchedule, setReviewSchedule,
  autoAdvanceEnabled, setAutoAdvanceEnabled,
  isAnalyticsVisible, setIsAnalyticsVisible,
  filteredFlashcards,
  cardOrder,
  currentCardIndex,
  activeFilter,
  pendingRemoteStudyStateSnapshot, setPendingRemoteStudyStateSnapshot,
  remoteStudyStateSyncTimer, setRemoteStudyStateSyncTimer,
  storage,
  platformAdapter,
} from "../../app/state.js";
import { backfillRawSource, normalizeSetRecord, slugify } from "../../core/set-codec.js";
import { getCardKey, buildCardKey, legacyCardId } from "../study/assessment.js";
import {
  hydrateLoadedSets,
  normalizeSetCollection,
  restoreBrowserFileHandles,
  initStorageHelpers,
  syncPersistedSetSourcePaths,
} from "../set-manager/set-manager.js";

// ── Scoped storage helpers ──
const userScopedStorageKey = (key) => `${APP_NAMESPACE}::user::${currentUser?.id || "anonymous"}::${key}`;
const getUserJson = (key, fallbackValue) => safeJsonParse(storage.getItem(userScopedStorageKey(key)), fallbackValue);
const setUserJson = (key, value) => storage.setItem(userScopedStorageKey(key), JSON.stringify(value));
const getUserText = (key) => storage.getItem(userScopedStorageKey(key));
const setUserText = (key, value) => storage.setItem(userScopedStorageKey(key), value);

export const getLocalStorageText = (key) =>
  typeof storage.getLocalItem === "function" ? storage.getLocalItem(key) : storage.getItem(key);
export const setLocalStorageText = (key, value) =>
  typeof storage.setLocalItem === "function" ? storage.setLocalItem(key, value) : storage.setItem(key, value);

// Initialize set-manager's storage helper references (avoids circular import)
initStorageHelpers(getUserJson, setUserJson);

export { getUserJson, setUserJson, getUserText, setUserText, userScopedStorageKey };

// ── Legacy state retrieval ──
export function getLegacyStudyStateSnapshot() {
  const storedSelected = getUserJson("selected_sets", []);
  const storedAssessments = getUserJson("assessments", {});
  const storedReviewSchedule = getUserJson("review_schedule", {});
  const storedSession = getUserJson("session", null);
  const autoAdvanceRaw = getUserText("auto_advance");
  const analyticsVisibleRaw = getUserText("analytics_visible");
  return normalizeStudyStateSnapshot({
    selectedSetIds: Array.isArray(storedSelected) ? storedSelected : [],
    assessments: isPlainObject(storedAssessments) ? storedAssessments : {},
    reviewSchedule: isPlainObject(storedReviewSchedule) ? storedReviewSchedule : {},
    session: isPlainObject(storedSession) ? storedSession : null,
    autoAdvanceEnabled: autoAdvanceRaw === null ? true : autoAdvanceRaw === "1",
    isAnalyticsVisible: analyticsVisibleRaw === "1",
    updatedAt: null,
  });
}

export function getPersistedStudyStateSnapshot() {
  const syncedSnapshot = getUserJson(USER_STUDY_STATE_KEY, null);
  if (isPlainObject(syncedSnapshot)) {
    return normalizeStudyStateSnapshot(syncedSnapshot);
  }
  return getLegacyStudyStateSnapshot();
}

export function buildCurrentStudyStateSnapshot(options = {}) {
  const persistedSession = getPersistedStudyStateSnapshot().session;
  const activeCard = filteredFlashcards.length > 0 ? filteredFlashcards[cardOrder[currentCardIndex]] : null;
  return normalizeStudyStateSnapshot({
    selectedSetIds: [...selectedSets],
    assessments,
    reviewSchedule,
    session: {
      currentCardIndex: activeCard ? currentCardIndex : Number.isInteger(persistedSession?.currentCardIndex) ? persistedSession.currentCardIndex : 0,
      currentCardKey: activeCard ? getCardKey(activeCard) : typeof persistedSession?.currentCardKey === "string" ? persistedSession.currentCardKey : null,
      topic: document.getElementById("topic-select")?.value || persistedSession?.topic || "hepsi",
      activeFilter: activeFilter || persistedSession?.activeFilter || "all",
      autoAdvanceEnabled,
    },
    autoAdvanceEnabled,
    isAnalyticsVisible,
    updatedAt: options.updatedAt || nowIso(),
  });
}

export function persistStudyStateSnapshot(snapshot) {
  if (!currentUser) return;
  const normalizedSnapshot = normalizeStudyStateSnapshot(snapshot);
  setUserJson(USER_STUDY_STATE_KEY, normalizedSnapshot);
  setUserJson("selected_sets", normalizedSnapshot.selectedSetIds);
  setUserJson("assessments", normalizedSnapshot.assessments);
  setUserJson("review_schedule", normalizedSnapshot.reviewSchedule);
  setUserText("auto_advance", normalizedSnapshot.autoAdvanceEnabled ? "1" : "0");
  setUserText("analytics_visible", normalizedSnapshot.isAnalyticsVisible ? "1" : "0");
  setUserJson("session", normalizedSnapshot.session);
}

export function pickNewerStudyStateSnapshot(localSnapshot, remoteSnapshot) {
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

export function applyStudyStateSnapshot(snapshot) {
  const normalizedSnapshot = normalizeStudyStateSnapshot(snapshot);
  setSelectedSets(
    normalizedSnapshot.selectedSetIds.length
      ? new Set(normalizedSnapshot.selectedSetIds.filter((setId) => loadedSets[setId]))
      : new Set(Object.keys(loadedSets)),
  );
  let newAssessments = isPlainObject(normalizedSnapshot.assessments) ? normalizedSnapshot.assessments : {};
  if (!newAssessments || Array.isArray(newAssessments)) newAssessments = {};
  setAssessments(newAssessments);
  setReviewSchedule(isPlainObject(normalizedSnapshot.reviewSchedule) ? normalizedSnapshot.reviewSchedule : {});
  setAutoAdvanceEnabled(normalizedSnapshot.autoAdvanceEnabled !== false);
  setIsAnalyticsVisible(normalizedSnapshot.isAnalyticsVisible === true);
  import("../study/study.js").then(({ syncAutoAdvanceToggleUI, syncReviewScheduleUi }) => {
    syncAutoAdvanceToggleUI();
    syncReviewScheduleUi();
  });
  import("../analytics/analytics.js").then(({ syncAnalyticsDashboard, syncAnalyticsVisibility }) => {
    syncAnalyticsVisibility();
    syncAnalyticsDashboard();
  });
}

export async function flushRemoteStudyStateSync() {
  if (!currentUser || typeof platformAdapter.saveUserState !== "function" || !pendingRemoteStudyStateSnapshot) return;
  const snapshotToSync = normalizeStudyStateSnapshot(pendingRemoteStudyStateSnapshot);
  setPendingRemoteStudyStateSnapshot(null);
  try {
    const remoteSnapshot = await platformAdapter.saveUserState(snapshotToSync);
    if (remoteSnapshot) {
      persistStudyStateSnapshot(remoteSnapshot);
    }
  } catch (error) {
    console.error(error);
  }
}

export function scheduleRemoteStudyStateSync(snapshot) {
  if (!currentUser || typeof platformAdapter.saveUserState !== "function") return;
  setPendingRemoteStudyStateSnapshot(normalizeStudyStateSnapshot(snapshot));
  if (remoteStudyStateSyncTimer) clearTimeout(remoteStudyStateSyncTimer);
  setRemoteStudyStateSyncTimer(setTimeout(() => {
    setRemoteStudyStateSyncTimer(null);
    void flushRemoteStudyStateSync();
  }, 600));
}

export function saveSelectedSets() {
  if (!currentUser) return;
  const snapshot = buildCurrentStudyStateSnapshot();
  persistStudyStateSnapshot(snapshot);
  scheduleRemoteStudyStateSync(snapshot);
}

export function saveStudyState() {
  if (!currentUser) return;
  const snapshot = buildCurrentStudyStateSnapshot();
  persistStudyStateSnapshot(snapshot);
  scheduleRemoteStudyStateSync(snapshot);
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

export async function migrateLegacyLocalData() {
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

export function migrateLegacyAssessmentsIfNeeded() {
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
    setAssessments(migrated);
    const snapshot = buildCurrentStudyStateSnapshot();
    persistStudyStateSnapshot(snapshot);
    scheduleRemoteStudyStateSync(snapshot);
  }
}

export async function loadUserStudyState() {
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

export async function loadUserWorkspace() {
  const { updateManagerUserChip, renderSetList } = await import("../set-manager/set-manager.js");
  let records = await platformAdapter.loadSets();
  const persistedSourcePaths = getUserJson("set_source_paths", {});
  hydrateLoadedSets(records, persistedSourcePaths);
  await restoreBrowserFileHandles(Object.values(loadedSets));
  if (await migrateLegacyLocalData()) {
    records = await platformAdapter.loadSets();
    hydrateLoadedSets(records, persistedSourcePaths);
    await restoreBrowserFileHandles(Object.values(loadedSets));
  }
  await loadUserStudyState();
  updateManagerUserChip();
  renderSetList();
}
