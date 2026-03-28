// src/app/bootstrap.js
// Application bootstrap: theme init, static event binding, window API exposure.

import { storage, setStorage, setPlatformAdapter } from "./state.js";
import { THEME_KEY, THEME_CONTROL_IDS } from "../shared/constants.js";
import { createPlatformAdapter } from "../core/platform-adapter.js";
import { hasSupabaseConfig } from "../core/runtime-config.js";
import { handleAuthStateChange, syncRememberMeUi, showAuthStatus } from "../features/auth/auth.js";
import { showScreen } from "./screen.js";
import { scheduleStartupDesktopUpdateCheck, syncDesktopUpdateButton } from "../features/desktop-update/desktop-update.js";
import { initGoogleDrive } from "../features/google-drive/google-drive.js";
import { updateManagerUserChip } from "../features/set-manager/set-manager.js";

export function markAppReady() {
  document.body.classList.remove("app-booting");
  scheduleStartupDesktopUpdateCheck();
}

export function syncThemeControlsUI() {
  const themeName = window.ThemeManager.getCurrentTheme();
  THEME_CONTROL_IDS.forEach((controlId) => {
    const control = document.getElementById(controlId);
    if (control) control.value = themeName;
  });
}

export function toggleTheme(themeName) {
  window.ThemeManager.setTheme({
    themeName,
    controlIds: THEME_CONTROL_IDS,
    storageKey: THEME_KEY,
    storageApi: storage,
  });
  syncThemeControlsUI();
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

export function bindStaticEvents() {
  // Import feature functions lazily to avoid circular deps
  import("../features/auth/auth.js").then(({ attemptAuth, handleDemoAuth, signOut, setRememberMePreference }) => {
    document.getElementById("auth-signin-btn")?.addEventListener("click", () => void attemptAuth("signin"));
    document.getElementById("auth-signup-btn")?.addEventListener("click", () => void attemptAuth("signup"));
    document.getElementById("auth-demo-btn")?.addEventListener("click", () => void handleDemoAuth());
    document.getElementById("auth-remember-me")?.addEventListener("change", (event) => {
      setRememberMePreference(event.currentTarget?.checked !== false);
    });
    document.getElementById("sign-out-btn")?.addEventListener("click", () => void signOut());
  });

  import("../features/desktop-update/desktop-update.js").then(({ checkDesktopForUpdates }) => {
    document.getElementById("check-updates-btn")?.addEventListener("click", () => void checkDesktopForUpdates("manual"));
  });

  import("../features/editor/editor-state.js").then(({ closeEditor, toggleEditorViewMode, openEditorForSelectedSets }) => {
    document.getElementById("editor-back-btn")?.addEventListener("click", () => closeEditor());
    document.getElementById("editor-view-toggle-btn")?.addEventListener("click", () => void toggleEditorViewMode());
  });

  import("../features/editor/editor-save.js").then(({ saveEditorDrafts, exportActiveEditorDraft }) => {
    document.getElementById("editor-export-btn")?.addEventListener("click", () => exportActiveEditorDraft());
    document.getElementById("editor-save-btn")?.addEventListener("click", () => void saveEditorDrafts());
  });

  import("../features/study/study.js").then(({ jumpToCard, flipCard, toggleFullscreen, previousCard, nextCard, assessCard: _a }) => {
    document.getElementById("jump-input")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      jumpToCard();
    });
  });

  // Global keyboard handler
  document.addEventListener("keydown", async (event) => {
    const tagName = event.target?.tagName;

    const { editorState } = await import("./state.js");
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editorState.isOpen) {
      event.preventDefault();
      const { saveEditorDrafts } = await import("../features/editor/editor-save.js");
      void saveEditorDrafts();
      return;
    }
    if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") return;

    const { isFullscreen, isFlipped } = await import("./state.js");
    const { flipCard, toggleFullscreen, previousCard, nextCard } = await import("../features/study/study.js");
    const { assessCard } = await import("../features/study/assessment.js");

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

export function exposeWindowApi() {
  // All window API functions are dynamically imported to avoid circular deps at top level
  const lazy = (modulePromise, fnName) => (...args) => modulePromise.then((mod) => mod[fnName](...args));

  const studyMod = import("../features/study/study.js");
  const assessMod = import("../features/study/assessment.js");
  const setMgrMod = import("../features/set-manager/set-manager.js");
  const undoToastMod = import("../features/set-manager/undo-toast.js");
  const editorStateMod = import("../features/editor/editor-state.js");

  Object.assign(window, {
    assessCard: (...args) => assessMod.then((m) => m.assessCard(...args)),
    authGoogleDrive: () => import("../features/google-drive/google-drive.js").then((m) => m.authGoogleDrive()),
    clearSetSelection: () => setMgrMod.then((m) => m.clearSetSelection()),
    deleteSet: (...args) => setMgrMod.then((m) => m.deleteSet(...args)),
    filterByTopic: (...args) => studyMod.then((m) => m.filterByTopic(...args)),
    flipCard: () => studyMod.then((m) => m.flipCard()),
    handleFileSelect: (...args) => setMgrMod.then((m) => m.handleFileSelect(...args)),
    jumpToCard: () => studyMod.then((m) => m.jumpToCard()),
    nextCard: () => studyMod.then((m) => m.nextCard()),
    openExportModal: () => studyMod.then((m) => m.openExportModal()),
    toggleExportWarning: () => studyMod.then((m) => m.toggleExportWarning()),
    executeExport: () => studyMod.then((m) => m.executeExport()),
    openEditorForSelectedSets: () => editorStateMod.then((m) => m.openEditorForSelectedSets()),
    previousCard: () => studyMod.then((m) => m.previousCard()),
    printCards: () => studyMod.then((m) => m.printCards()),
    removeSelectedSets: () => setMgrMod.then((m) => m.removeSelectedSets()),
    resetProgress: () => assessMod.then((m) => m.resetProgress()),
    selectAllSets: () => setMgrMod.then((m) => m.selectAllSets()),
    setAutoAdvance: (...args) => studyMod.then((m) => m.setAutoAdvance(...args)),
    setFilter: (...args) => studyMod.then((m) => m.setFilter(...args)),
    showSetManager: () => studyMod.then((m) => m.showSetManager()),
    shuffleCards: () => studyMod.then((m) => m.shuffleCards()),
    startStudy: () => studyMod.then((m) => m.startStudy()),
    triggerSetImport: () => setMgrMod.then((m) => m.triggerSetImport()),
    toggleBulkSetSelection: () => setMgrMod.then((m) => m.toggleBulkSetSelection()),
    toggleFullscreen: () => studyMod.then((m) => m.toggleFullscreen()),
    toggleSetCheck: (...args) => setMgrMod.then((m) => m.toggleSetCheck(...args)),
    toggleTheme: (...args) => Promise.resolve(toggleTheme(...args)),
    undoLastRemoval: () => undoToastMod.then((m) => m.undoLastRemoval()),
  });
}

export async function bootstrap() {
  // Initialize storage and platform adapter
  const appStorage = window.AppStorage;
  setStorage(appStorage);
  const adapter = createPlatformAdapter(appStorage);
  setPlatformAdapter(adapter);

  renderBuildMeta();
  window.ThemeManager.renderThemeOptions(THEME_CONTROL_IDS);
  window.ThemeManager.initThemeFromStorage({
    storageKey: THEME_KEY,
    storageApi: appStorage,
    controlIds: THEME_CONTROL_IDS,
  });
  syncThemeControlsUI();
  syncRememberMeUi();
  bindStaticEvents();
  updateManagerUserChip();
  exposeWindowApi();
  adapter.subscribeAuthState((user, event) => {
    void handleAuthStateChange(user, event);
  });
  initGoogleDrive();
}
