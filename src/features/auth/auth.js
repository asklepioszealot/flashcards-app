// src/features/auth/auth.js
// Authentication: remember-me, sign in/up/out, auth state changes.

import {
  platformAdapter,
  currentUser, setCurrentUser,
  authStateToken, incrementAuthStateToken,
  editorState, resetEditorState,
  loadedSets, setLoadedSets,
  selectedSets, setSelectedSets,
  assessments, setAssessments,
  setIsAnalyticsVisible,
  pendingRemoteStudyStateSnapshot, setPendingRemoteStudyStateSnapshot,
  remoteStudyStateSyncTimer, setRemoteStudyStateSyncTimer,
  storage,
  currentScreen,
} from "../../app/state.js";
import { AUTH_REMEMBER_ME_KEY } from "../../shared/constants.js";
import { showScreen } from "../../app/screen.js";

// ── Status helpers ──
function setStatus(elementId, message, tone = "") {
  const element = document.getElementById(elementId);
  if (!element) return;
  const baseClass = elementId.startsWith("auth") ? "auth-status" : "editor-status";
  element.className = tone ? `${baseClass} ${tone}` : baseClass;
  element.textContent = message || "";
}

export const showAuthStatus = (message, tone = "") => setStatus("auth-status", message, tone);
export const showEditorStatus = (message, tone = "") => setStatus("editor-status", message, tone);

// ── Remember-me ──
export function getRememberMePreference() {
  const storedValue = getLocalStorageText(AUTH_REMEMBER_ME_KEY);
  if (storedValue === "0") return false;
  if (storedValue === "1") return true;
  return true;
}

function getLocalStorageText(key) {
  return typeof storage.getLocalItem === "function" ? storage.getLocalItem(key) : storage.getItem(key);
}

function setLocalStorageText(key, value) {
  if (typeof storage.setLocalItem === "function") storage.setLocalItem(key, value);
  else storage.setItem(key, value);
}

export function setRememberMePreference(rememberMe) {
  setLocalStorageText(AUTH_REMEMBER_ME_KEY, rememberMe ? "1" : "0");
}

export function readRememberMeFromForm() {
  return document.getElementById("auth-remember-me")?.checked !== false;
}

export function syncRememberMeUi() {
  const checkbox = document.getElementById("auth-remember-me");
  if (checkbox) checkbox.checked = getRememberMePreference();
}

// ── Auth actions ──
export async function attemptAuth(action) {
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

export async function handleDemoAuth() {
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

export async function signOut() {
  try {
    await platformAdapter.signOut();
  } catch (error) {
    console.error(error);
    const { showUndoToast } = await import("../set-manager/undo-toast.js");
    showUndoToast("Çıkış yapılamadı.");
  }
}

// ── Auth state change handler ──
export async function handleAuthStateChange(user, event = "unknown") {
  const token = incrementAuthStateToken();
  const previousUserId = currentUser?.id || null;
  const previousScreen = currentScreen;
  setCurrentUser(user || null);
  showAuthStatus("", "");
  showEditorStatus("", "");

  const { updateManagerUserChip, renderSetList } = await import("../set-manager/set-manager.js");
  updateManagerUserChip();

  if (!currentUser) {
    if (remoteStudyStateSyncTimer) clearTimeout(remoteStudyStateSyncTimer);
    setRemoteStudyStateSyncTimer(null);
    setPendingRemoteStudyStateSnapshot(null);
    setLoadedSets({});
    setSelectedSets(new Set());
    setAssessments({});
    setIsAnalyticsVisible(false);
    resetEditorState();
    renderSetList();
    syncRememberMeUi();
    showScreen("auth");
    const { markAppReady } = await import("../../app/bootstrap.js");
    markAppReady();
    return;
  }

  const isSameUser = Boolean(previousUserId && previousUserId === currentUser.id);
  const shouldPreserveActiveScreen = isSameUser && previousScreen !== "auth" && event !== "initial" && event !== "INITIAL_SESSION";
  if (shouldPreserveActiveScreen) {
    if (previousScreen === "editor" && editorState.isOpen) {
      const { refreshEditorPills } = await import("../editor/editor-render.js");
      refreshEditorPills();
    }
    const { markAppReady } = await import("../../app/bootstrap.js");
    markAppReady();
    return;
  }

  try {
    const { loadUserWorkspace } = await import("../study-state/study-state.js");
    await loadUserWorkspace();
    if (token !== authStateToken) return;
    const { markAppReady } = await import("../../app/bootstrap.js");
    if (isSameUser && previousScreen === "editor" && editorState.isOpen) {
      showScreen("editor");
      const { renderEditor } = await import("../editor/editor-render.js");
      renderEditor();
      markAppReady();
      return;
    }
    if (isSameUser && previousScreen === "study") {
      showScreen("study");
      const { displayCard } = await import("../study/study.js");
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
      const { markAppReady } = await import("../../app/bootstrap.js");
      markAppReady();
    }
  }
}
