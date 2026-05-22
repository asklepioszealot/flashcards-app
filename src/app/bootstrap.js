// src/app/bootstrap.js
// Application bootstrap: theme init, static event binding, window API exposure.

import { storage, setStorage, setPlatformAdapter, editorState, isFlipped, isFullscreen } from "./state.js";
import { AppStorage } from "../core/storage.js";
import { BUILD_INFO } from "../generated/build-info.js";
import { THEME_KEY, THEME_CONTROL_IDS } from "../shared/constants.js";
import { createPlatformAdapter } from "../core/platform-adapter.js";
import { hasDriveConfig, hasSupabaseConfig, isAndroidRuntime, isTauriRuntime } from "../core/runtime-config.js";
import {
  attemptAuth,
  handleAuthStateChange,
  handleDemoAuth,
  handleGoogleAuth,
  setRememberMePreference,
  showAuthStatus,
  signOut,
  syncRememberMeUi,
} from "../features/auth/auth.js";
import { ThemeManager } from "../ui/theme.js";
import { showScreen } from "./screen.js";
import { scheduleStartupDesktopUpdateCheck, syncDesktopUpdateButton } from "../features/desktop-update/desktop-update.js";
import { initGoogleDrive } from "../features/google-drive/google-drive.js";
import { updateManagerUserChip } from "../features/set-manager/set-manager.js";
import { initDesktopIntegrations } from "../ui/desktop.js";

export function markAppReady() {
  document.body.classList.remove("app-booting");
  dismissAppSplash();
  scheduleStartupDesktopUpdateCheck();
}

function dismissAppSplash() {
  const splash = document.getElementById("app-splash");
  if (!splash) return;
  const finalize = () => splash.classList.add("is-removed");
  splash.addEventListener("transitionend", finalize, { once: true });
  setTimeout(finalize, 800);
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

function renderAppVersionChip() {
  const version = BUILD_INFO?.version;
  const label = version && version !== "unknown" ? `v${version}` : "dev";
  const chips = [
    document.getElementById("app-version-chip"),
    document.getElementById("statusbar-version-chip"),
  ];
  chips.forEach((chip) => {
    if (chip) chip.textContent = label;
  });
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

function syncDriveImportButton() {
  const driveImportButton = document.getElementById("drive-import-btn");
  if (!driveImportButton) return;
  const driveIsConfigured = hasDriveConfig();
  driveImportButton.disabled = !driveIsConfigured;
  if (driveIsConfigured) {
    driveImportButton.removeAttribute("aria-disabled");
    driveImportButton.removeAttribute("title");
    return;
  }
  driveImportButton.setAttribute("aria-disabled", "true");
  driveImportButton.setAttribute("title", "Google Drive icin local runtime-config veya DRIVE_* environment ayarlari gerekiyor.");
}

export function bindStaticEvents() {
  THEME_CONTROL_IDS.forEach((controlId) => {
    bindEvent(document.getElementById(controlId), "change", (event) => {
      toggleTheme(event.currentTarget?.value);
    });
  });

  bindEvent(document.getElementById("auth-form"), "submit", (event) => {
    event.preventDefault();
    void attemptAuth("signin");
  });
  bindEvent(document.getElementById("auth-signup-btn"), "click", () => void attemptAuth("signup"));
  bindEvent(document.getElementById("auth-demo-btn"), "click", () => void handleDemoAuth());
  bindEvent(document.getElementById("auth-google-btn"), "click", () => void handleGoogleAuth());
  bindEvent(document.getElementById("auth-remember-me"), "change", (event) => {
    setRememberMePreference(event.currentTarget?.checked !== false);
  });
  bindEvent(document.getElementById("sign-out-btn"), "click", () => void signOut());

  const handleUpdateCheck = () => {
    if (isAndroidRuntime()) {
      void import("../features/android-update/android-update.js")
        .then(({ checkAndroidForUpdates }) => checkAndroidForUpdates("manual"));
      return;
    }
    void import("../features/desktop-update/desktop-update.js")
      .then(({ checkDesktopForUpdates }) => checkDesktopForUpdates("manual"));
  };
  bindEvent(document.getElementById("check-updates-btn"), "click", handleUpdateCheck);
  bindEvent(document.getElementById("auth-check-updates-btn"), "click", handleUpdateCheck);

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
    import("../features/study/card-swipe.js").then(({ bindCardSwipe }) => {
      bindCardSwipe(document.getElementById("flashcard"), {
        onSwipeLeft: () => nextCard(),
        onSwipeRight: () => previousCard(),
      });
    });
    bindEvent(document.getElementById("fullscreen-toggle-btn"), "click", (event) => {
      event.stopPropagation();
      toggleFullscreen();
    });
    bindEvent(document.getElementById("export-format"), "change", () => toggleExportWarning());
    bindEvent(document.getElementById("export-submit-btn"), "click", () => void executeExport());
    bindAll("[data-export-close]", "click", () => closeExportModal());
    bindEvent(document.getElementById("export-modal"), "click", (event) => {
      if (event.target === event.currentTarget) closeExportModal();
    });
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
  bindEvent(document.getElementById("drive-modal"), "click", (event) => {
    if (event.target === event.currentTarget) closeDriveModal();
  });
  bindEvent(document.getElementById("undo-toast-btn"), "click", async () => {
    const { undoLastRemoval } = await import("../features/set-manager/undo-toast.js");
    undoLastRemoval();
  });

  const loadEditorSaveModule = () => import("../features/editor/editor-save.js");
  const loadStudyModule = () => import("../features/study/study.js");
  const loadAssessmentModule = () => import("../features/study/assessment.js");

  // Flush any pending Supabase study-state snapshot when the page is being
  // hidden (Android: app sent to background, tab switch, OS task killer).
  // Without this, the 600ms debounce in scheduleRemoteStudyStateSync can lose
  // the last few seconds of work if the OS suspends the process.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    import("../features/study-state/study-state.js")
      .then(({ flushRemoteStudyStateSync }) => flushRemoteStudyStateSync())
      .catch((error) => console.error("[visibilitychange] flush failed:", error));
  });

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
  if (!isAndroidRuntime() && !isTauriRuntime()) document.getElementById("auth-google-btn")?.setAttribute("hidden", "hidden");
  syncDriveImportButton();
  if (isAndroidRuntime()) {
    const buttons = ["check-updates-btn", "auth-check-updates-btn"].map(id => document.getElementById(id));
    buttons.forEach((btn) => {
      if (btn) {
        btn.hidden = false;
        btn.disabled = false;
        btn.textContent = "Güncellemeleri Kontrol Et";
      }
    });
  } else {
    syncDesktopUpdateButton();
  }
}

export async function bootstrap() {
  // Check if we are running in web browser and have an OAuth callback (hash for implicit, query for PKCE)
  if (typeof window !== "undefined" && !window.__TAURI__) {
    const hash = window.location.hash || "";
    const search = window.location.search || "";
    const hasImplicitTokens = hash.includes("access_token=") || hash.includes("refresh_token=");
    const hasPkceCode = /[?&]code=/.test(search);
    if (hasImplicitTokens || hasPkceCode) {
      const deepLinkSuffix = hasImplicitTokens ? hash : search;
      console.log("OAuth callback detected in browser, redirecting to desktop app...", { hasImplicitTokens, hasPkceCode });
      
      // Render a premium redirection feedback UI!
      document.body.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          background: #0f172a;
          color: #f8fafc;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
          margin: 0;
          padding: 20px;
          text-align: center;
        ">
          <div style="
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 24px;
            padding: 40px;
            max-width: 450px;
            width: 100%;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          ">
            <!-- Glassy glowing gradient ball behind logo -->
            <div style="
              width: 72px;
              height: 72px;
              border-radius: 50%;
              background: linear-gradient(135deg, #3b82f6, #8b5cf6);
              display: flex;
              align-items: center;
              justify-content: center;
              margin: 0 auto 24px auto;
              box-shadow: 0 0 30px rgba(139, 92, 246, 0.4);
            ">
              <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: white;">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
            </div>
            
            <h2 style="font-size: 24px; font-weight: 700; margin: 0 0 12px 0; background: linear-gradient(to right, #3b82f6, #a855f7); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">
              Giriş Başarılı!
            </h2>
            <p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0 0 28px 0;">
              Oturumunuz başarıyla doğrulandı. Masaüstü uygulamanıza güvenli bir şekilde yönlendiriliyorsunuz...
            </p>
            
            <button id="open-app-btn" style="
              width: 100%;
              padding: 14px 24px;
              border-radius: 12px;
              border: none;
              background: linear-gradient(135deg, #3b82f6, #2563eb);
              color: white;
              font-weight: 600;
              font-size: 15px;
              cursor: pointer;
              box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
              transition: all 0.2s ease;
            " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(37, 99, 235, 0.4)';" 
               onmouseout="this.style.transform='none'; this.style.boxShadow='0 4px 12px rgba(37, 99, 235, 0.3)';">
              Uygulamayı Aç
            </button>
            
            <div style="
              margin-top: 24px;
              padding-top: 20px;
              border-top: 1px solid rgba(255, 255, 255, 0.06);
              font-size: 12px;
              color: #64748b;
              text-align: left;
              line-height: 1.6;
            ">
              <span style="font-weight: 600; color: #94a3b8; display: block; margin-bottom: 6px;">Uygulama otomatik açılmadı mı?</span>
              1. Tarayıcınızın üst kısmında çıkabilecek <strong>"Flashcards App uygulamasını aç"</strong> iznine veya açılır pencere (popup) uyarısına izin verdiğinizden emin olun.<br>
              2. Eğer uygulamanın <strong>Taşınabilir (Portable)</strong> sürümünü kullanıyorsanız, taşınabilir sürümler Windows'a kendilerini kaydedemediklerinden otomatik yönlendirmeyi alamazlar. Otomatik giriş ve tam entegrasyon için lütfen <strong>Kurulum (Setup)</strong> paketi ile uygulamayı yükleyin.
            </div>
          </div>
        </div>
      `;
      
      const redirect = () => {
        window.location.href = "flashcards-app://oauth-callback" + deepLinkSuffix;
      };
      
      document.getElementById("open-app-btn").addEventListener("click", redirect);
      
      // Auto-trigger redirect
      redirect();
      return;
    }
  }

  // Initialize storage and platform adapter
  const appStorage = AppStorage;
  setStorage(appStorage);
  const adapter = createPlatformAdapter(appStorage);
  setPlatformAdapter(adapter);

  // Initialize desktop integrations (Titlebar, Statusbar, drag-and-drop, arguments handler)
  initDesktopIntegrations();

  renderBuildMeta();
  renderAppVersionChip();
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
