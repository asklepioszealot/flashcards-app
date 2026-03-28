// src/app/state.js
// Central mutable state module. All other modules import state from here.
// Only imports from shared/utils.js — no circular dependencies.

// ── Auth & User ──
export let currentUser = null;
export function setCurrentUser(user) { currentUser = user ?? null; }

// ── Set Data ──
export let loadedSets = {};
export function setLoadedSets(value) { loadedSets = value; }

export let selectedSets = new Set();
export function setSelectedSets(value) { selectedSets = value; }

// ── Undo ──
export let lastRemovedSets = [];
export let undoTimeoutId = null;
export function setLastRemovedSets(v) { lastRemovedSets = v; }
export function setUndoTimeoutId(v) { undoTimeoutId = v; }

// ── Study Session ──
export let currentCardIndex = 0;
export let isFlipped = false;
export let allFlashcards = [];
export let filteredFlashcards = [];
export let cardOrder = [];
export let assessments = {};
export let activeFilter = "all";
export let isFullscreen = false;
export let autoAdvanceEnabled = true;
export let authStateToken = 0;
export let currentScreen = "auth";

export function setCurrentCardIndex(v) { currentCardIndex = v; }
export function setIsFlipped(v) { isFlipped = v; }
export function setAllFlashcards(v) { allFlashcards = v; }
export function setFilteredFlashcards(v) { filteredFlashcards = v; }
export function setCardOrder(v) { cardOrder = v; }
export function setAssessments(v) { assessments = v; }
export function setActiveFilter(v) { activeFilter = v; }
export function setIsFullscreen(v) { isFullscreen = v; }
export function setAutoAdvanceEnabled(v) { autoAdvanceEnabled = Boolean(v); }
export function incrementAuthStateToken() { authStateToken += 1; return authStateToken; }
export function setCurrentScreen(v) { currentScreen = v; }

// ── Editor ──
export let editorState = {
  isOpen: false,
  activeSetId: null,
  draftOrder: [],
  drafts: {},
  focusedField: null,
  pendingScrollCardId: null,
};
export function setEditorState(v) { editorState = v; }
export function resetEditorState() {
  editorState = { isOpen: false, activeSetId: null, draftOrder: [], drafts: {}, focusedField: null, pendingScrollCardId: null };
}

// ── Desktop Update ──
export const desktopUpdateState = {
  startupCheckScheduled: false,
  startupCheckCompleted: false,
  isChecking: false,
  isInstalling: false,
  buttonLabel: "Güncellemeleri Kontrol Et",
};

// ── Google Drive ──
export let tokenClient = null;
export let driveAccessToken = null;
export let pickerApiLoaded = false;
export function setTokenClient(v) { tokenClient = v; }
export function setDriveAccessToken(v) { driveAccessToken = v; }
export function setPickerApiLoaded(v) { pickerApiLoaded = v; }

// ── Remote Sync ──
export let pendingRemoteStudyStateSnapshot = null;
export let remoteStudyStateSyncTimer = null;
export function setPendingRemoteStudyStateSnapshot(v) { pendingRemoteStudyStateSnapshot = v; }
export function setRemoteStudyStateSyncTimer(v) { remoteStudyStateSyncTimer = v; }

// ── Editor Split Drag ──
export let editorSplitDragState = null;
export function setEditorSplitDragState(v) { editorSplitDragState = v; }

// ── Browser File Handles (in-memory) ──
export const browserFileHandles = new Map();

// ── Storage & Platform (set during bootstrap) ──
export let storage = null;
export let platformAdapter = null;
export function setStorage(v) { storage = v; }
export function setPlatformAdapter(v) { platformAdapter = v; }
