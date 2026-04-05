// src/app/bootstrap.js
// Application bootstrap: theme init, static event binding, window API exposure.

import { storage, setStorage, setPlatformAdapter, editorState, isFlipped, isFullscreen } from "./state.js";
import { AppStorage } from "../core/storage.js";
import { BUILD_INFO } from "../generated/build-info.js";
import { THEME_KEY, THEME_CONTROL_IDS } from "../shared/constants.js";
import { createPlatformAdapter } from "../core/platform-adapter.js";
import { hasSupabaseConfig } from "../core/runtime-config.js";
import { handleAuthStateChange, syncRememberMeUi, showAuthStatus } from "../features/auth/auth.js";
import { ThemeManager } from "../ui/theme.js";
import { showScreen } from "./screen.js";
import { scheduleStartupDesktopUpdateCheck, syncDesktopUpdateButton } from "../features/desktop-update/desktop-update.js";
import { initGoogleDrive } from "../features/google-drive/google-drive.js";
import { updateManagerUserChip } from "../features/set-manager/set-manager.js";

export function markAppReady() {
  document.body.classList.remove("app-booting");
  scheduleStartupDesktopUpdateCheck();
}

export function syncThemeControlsUI() {
  const themeName = ThemeManager.getCurrentTheme();
  THEME_CONTROL_IDS.forEach((controlId) => {
    const control = document.getElementById(controlId);
    if (control) control.value = themeName;
  });
}

export function toggleTheme(themeName) {
  ThemeManager.setTheme({
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
  const buildInfo = BUILD_INFO;
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

function bindEvent(target, eventName, handler) {
  target?.addEventListener(eventName, handler);
}

function bindAll(selector, eventName, handler) {
  document.querySelectorAll(selector).forEach((target) => {
    target.addEventListener(eventName, handler);
  });
}

function closeDriveModal() {
  const modal = document.getElementById("drive-modal");
  if (modal) modal.style.display = "none";
}

export function bindStaticEvents() {
  THEME_CONTROL_IDS.forEach((controlId) => {
    bindEvent(document.getElementById(controlId), "change", (event) => {
      toggleTheme(event.currentTarget?.value);
    });
  });

  import("../features/auth/auth.js").then(({ attemptAuth, handleDemoAuth, signOut, setRememberMePreference }) => {
    bindEvent(document.getElementById("auth-form"), "submit", (event) => {
      event.preventDefault();
      void attemptAuth("signin");
    });
    bindEvent(document.getElementById("auth-signup-btn"), "click", () => void attemptAuth("signup"));
    bindEvent(document.getElementById("auth-demo-btn"), "click", () => void handleDemoAuth());
    bindEvent(document.getElementById("auth-remember-me"), "change", (event) => {
      setRememberMePreference(event.currentTarget?.checked !== false);
    });
    bindEvent(document.getElementById("sign-out-btn"), "click", () => void signOut());
  });

  import("../features/desktop-update/desktop-update.js").then(({ checkDesktopForUpdates }) => {
    bindEvent(document.getElementById("check-updates-btn"), "click", () => void checkDesktopForUpdates("manual"));
  });

  import("../features/editor/editor-state.js").then(({ closeEditor, toggleEditorViewMode, openEditorForSelectedSets }) => {
    bindEvent(document.getElementById("editor-back-btn"), "click", () => closeEditor());
    bindEvent(document.getElementById("editor-view-toggle-btn"), "click", () => void toggleEditorViewMode());
    bindEvent(document.getElementById("edit-selected-btn"), "click", () => void openEditorForSelectedSets());
  });

  import("../features/editor/editor-save.js").then(({ saveEditorDrafts, exportActiveEditorDraft }) => {
    bindEvent(document.getElementById("editor-export-btn"), "click", () => exportActiveEditorDraft());
    bindEvent(document.getElementById("editor-save-btn"), "click", () => void saveEditorDrafts());
  });

  import("../features/google-drive/google-drive.js").then(({ authGoogleDrive }) => {
    bindEvent(document.getElementById("drive-import-btn"), "click", () => authGoogleDrive());
  });

  import("../features/set-manager/set-manager.js").then(({ triggerSetImport, handleFileSelect, removeSelectedSets, toggleBulkSetSelection }) => {
    bindEvent(document.getElementById("set-import-btn"), "click", () => void triggerSetImport());
    bindEvent(document.getElementById("file-picker"), "change", (event) => void handleFileSelect(event));
    bindEvent(document.getElementById("remove-selected-btn"), "click", () => void removeSelectedSets());
    bindEvent(document.getElementById("set-bulk-toggle"), "click", () => toggleBulkSetSelection());
  });

  import("../features/analytics/analytics.js").then(({ toggleAnalyticsVisibility, closeAnalyticsDashboard }) => {
    bindEvent(document.getElementById("analytics-toggle-btn"), "click", () => toggleAnalyticsVisibility());
    bindEvent(document.getElementById("analytics-close-btn"), "click", () => closeAnalyticsDashboard());
  });

  import("../features/study/study.js").then(({
    jumpToCard,
    flipCard,
    toggleFullscreen,
    previousCard,
    nextCard,
    startStudy,
    setAutoAdvance,
    filterByTopic,
    setFilter,
    showSetManager,
    shuffleCards,
    openExportModal,
    toggleExportWarning,
    executeExport,
    closeExportModal,
    toggleCardContentSettingsPanel,
    closeCardContentSettingsPanel,
    syncCardContentPreferencesUi,
    syncReviewScheduleVisibilityUi,
    updateCardContentFontSize,
    resetCardContentPreferences,
    setReviewScheduleVisibility,
    setTopicSourceVisibility,
  }) => {
    bindEvent(document.getElementById("jump-input"), "keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      jumpToCard();
    });
    bindEvent(document.getElementById("start-btn"), "click", () => startStudy());
    bindEvent(document.getElementById("auto-advance-toggle-manager"), "change", (event) => {
      setAutoAdvance(event.currentTarget?.checked);
    });
    bindEvent(document.getElementById("review-schedule-visibility-toggle"), "change", (event) => {
      setReviewScheduleVisibility(event.currentTarget?.checked);
    });
    bindEvent(document.getElementById("topic-source-visibility-toggle"), "change", (event) => {
      setTopicSourceVisibility(event.currentTarget?.checked);
    });
    bindEvent(document.getElementById("card-content-settings-toggle-btn"), "click", () => {
      toggleCardContentSettingsPanel();
    });
    bindEvent(document.getElementById("card-content-settings-close-btn"), "click", () => {
      closeCardContentSettingsPanel();
    });
    bindEvent(document.getElementById("card-content-front-font-size"), "input", (event) => {
      updateCardContentFontSize("front", event.currentTarget?.value, { resync: false });
    });
    bindEvent(document.getElementById("card-content-back-font-size"), "input", (event) => {
      updateCardContentFontSize("back", event.currentTarget?.value, { resync: false });
    });
    bindEvent(document.getElementById("card-content-fullscreen-front-font-size"), "input", (event) => {
      updateCardContentFontSize("fullscreenFront", event.currentTarget?.value, { resync: false });
    });
    bindEvent(document.getElementById("card-content-fullscreen-back-font-size"), "input", (event) => {
      updateCardContentFontSize("fullscreenBack", event.currentTarget?.value, { resync: false });
    });
    bindEvent(document.getElementById("card-content-front-font-size"), "change", (event) => {
      updateCardContentFontSize("front", event.currentTarget?.value);
    });
    bindEvent(document.getElementById("card-content-back-font-size"), "change", (event) => {
      updateCardContentFontSize("back", event.currentTarget?.value);
    });
    bindEvent(document.getElementById("card-content-fullscreen-front-font-size"), "change", (event) => {
      updateCardContentFontSize("fullscreenFront", event.currentTarget?.value);
    });
    bindEvent(document.getElementById("card-content-fullscreen-back-font-size"), "change", (event) => {
      updateCardContentFontSize("fullscreenBack", event.currentTarget?.value);
    });
    bindEvent(document.getElementById("card-content-front-font-size"), "blur", () => {
      syncCardContentPreferencesUi();
    });
    bindEvent(document.getElementById("card-content-back-font-size"), "blur", () => {
      syncCardContentPreferencesUi();
    });
    bindEvent(document.getElementById("card-content-fullscreen-front-font-size"), "blur", () => {
      syncCardContentPreferencesUi();
    });
    bindEvent(document.getElementById("card-content-fullscreen-back-font-size"), "blur", () => {
      syncCardContentPreferencesUi();
    });
    bindEvent(document.getElementById("card-content-reset-btn"), "click", () => {
      resetCardContentPreferences();
    });
    syncCardContentPreferencesUi();
    syncReviewScheduleVisibilityUi();
    bindEvent(document.getElementById("topic-select"), "change", () => filterByTopic());
    bindEvent(document.getElementById("show-set-manager-btn"), "click", () => showSetManager());
    bindEvent(document.getElementById("shuffle-btn"), "click", () => shuffleCards());
    bindEvent(document.getElementById("open-export-btn"), "click", () => openExportModal());
    bindEvent(document.getElementById("flashcard"), "click", (event) => {
      if (event.target.closest("a, button")) return;
      flipCard();
    });
    bindEvent(document.getElementById("fullscreen-toggle-btn"), "click", (event) => {
      event.stopPropagation();
      toggleFullscreen();
    });
    bindEvent(document.getElementById("export-format"), "change", () => toggleExportWarning());
    bindEvent(document.getElementById("export-submit-btn"), "click", () => void executeExport());
    bindAll("[data-export-close]", "click", () => closeExportModal());
    bindAll("[data-filter-value]", "click", (event) => {
      setFilter(event.currentTarget?.dataset.filterValue || "all");
    });
    bindAll("[data-nav-direction='previous']", "click", () => previousCard());
    bindAll("[data-nav-direction='next']", "click", () => nextCard());
  });

  import("../features/study/assessment.js").then(({ assessCard, resetProgress }) => {
    bindEvent(document.getElementById("reset-progress-btn"), "click", () => resetProgress());
    bindAll("[data-assessment-value]", "click", (event) => {
      assessCard(event.currentTarget?.dataset.assessmentValue);
    });
  });

  bindEvent(document.getElementById("drive-close-btn"), "click", closeDriveModal);
  bindEvent(document.getElementById("undo-toast-btn"), "click", async () => {
    const { undoLastRemoval } = await import("../features/set-manager/undo-toast.js");
    undoLastRemoval();
  });

  const loadEditorSaveModule = () => import("../features/editor/editor-save.js");
  const loadStudyModule = () => import("../features/study/study.js");
  const loadAssessmentModule = () => import("../features/study/assessment.js");

  // Global keyboard handler
  document.addEventListener("keydown", (event) => {
    const tagName = event.target?.tagName;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && editorState.isOpen) {
      event.preventDefault();
      void loadEditorSaveModule().then(({ saveEditorDrafts }) => saveEditorDrafts());
      return;
    }
    if (tagName === "INPUT" || tagName === "SELECT" || tagName === "TEXTAREA") return;

    const appIsVisible = document.getElementById("app-container").style.display !== "none";

    if ((event.key === "f" || event.key === "F") && appIsVisible) {
      event.preventDefault();
      void loadStudyModule().then(({ toggleFullscreen }) => toggleFullscreen());
      return;
    }
    if ((event.key === "s" || event.key === "S") && appIsVisible) {
      event.preventDefault();
      void loadStudyModule().then(({ flipCard }) => flipCard());
      return;
    }
    if (event.key === "Escape" && isFullscreen) {
      event.preventDefault();
      void loadStudyModule().then(({ toggleFullscreen }) => toggleFullscreen());
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      void loadStudyModule().then(({ previousCard }) => previousCard());
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      void loadStudyModule().then(({ nextCard }) => nextCard());
    } else if (event.key === " ") {
      event.preventDefault();
      void loadStudyModule().then(({ flipCard }) => flipCard());
    } else if (event.key === "1" && isFlipped) {
      event.preventDefault();
      void loadAssessmentModule().then(({ assessCard }) => assessCard("know"));
    } else if (event.key === "2" && isFlipped) {
      event.preventDefault();
      void loadAssessmentModule().then(({ assessCard }) => assessCard("review"));
    } else if (event.key === "3" && isFlipped) {
      event.preventDefault();
      void loadAssessmentModule().then(({ assessCard }) => assessCard("dunno"));
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

export async function bootstrap() {
  // Initialize storage and platform adapter
  const appStorage = AppStorage;
  setStorage(appStorage);
  const adapter = createPlatformAdapter(appStorage);
  setPlatformAdapter(adapter);

  renderBuildMeta();
  ThemeManager.renderThemeOptions(THEME_CONTROL_IDS);
  ThemeManager.initThemeFromStorage({
    storageKey: THEME_KEY,
    storageApi: appStorage,
    controlIds: THEME_CONTROL_IDS,
  });
  syncThemeControlsUI();
  syncRememberMeUi();
  bindStaticEvents();
  updateManagerUserChip();
  adapter.subscribeAuthState((user, event) => {
    void handleAuthStateChange(user, event);
  });
  initGoogleDrive();
}
