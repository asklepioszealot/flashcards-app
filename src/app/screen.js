// src/app/screen.js
// Screen navigation helper — extracted to prevent circular imports between
// auth, set-manager, and study modules that all need showScreen.

import { setCurrentScreen } from "./state.js";

export function showScreen(name) {
  setCurrentScreen(name);
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
