import {
  AVAILABLE_THEMES,
  ORDERED_THEMES,
  getThemePreset,
} from "./theme-presets.js";

const globalScope = typeof window !== "undefined" ? window : globalThis;

function normalizeTheme(themeName) {
  return AVAILABLE_THEMES.includes(themeName) ? themeName : "light";
}

function listControlIds(options = {}) {
  const ids = Array.isArray(options.controlIds) ? options.controlIds : [];
  return ids.filter(Boolean);
}

export function getThemeLabel(themeName) {
  return getThemePreset(themeName).label || String(themeName || "light");
}

export function renderThemeOptions(controlIds) {
  controlIds.forEach((controlId) => {
    const select = document.getElementById(controlId);
    if (!select) return;

    const selectedTheme = normalizeTheme(select.value || select.dataset.themeValue || "light");
    select.replaceChildren();

    ORDERED_THEMES.forEach((themeName) => {
      const option = document.createElement("option");
      option.value = themeName;
      option.textContent = getThemeLabel(themeName);
      select.appendChild(option);
    });

    select.value = selectedTheme;
  });
}

function setSelectState(controlId, themeName) {
  const select = document.getElementById(controlId);
  if (select && select.value !== themeName) {
    select.value = themeName;
  }
}

function syncThemeControls(controlIds, themeName) {
  controlIds.forEach((controlId) => setSelectState(controlId, themeName));
}

function applyThemeCssVariables(themeName) {
  const preset = getThemePreset(themeName);
  const root = document.documentElement;

  Object.entries(preset.variables).forEach(([variableName, variableValue]) => {
    root.style.setProperty(variableName, variableValue);
  });

  root.style.colorScheme = preset.colorScheme;
  root.setAttribute("data-color-scheme", preset.colorScheme);
}

function applyThemeAttribute(themeName) {
  if (themeName === "light") {
    document.documentElement.removeAttribute("data-theme");
    return;
  }

  document.documentElement.setAttribute("data-theme", themeName);
}

export function setThemeState(themeName, options = {}) {
  const normalizedTheme = normalizeTheme(themeName);
  syncThemeControls(listControlIds(options), normalizedTheme);
  applyThemeCssVariables(normalizedTheme);
  applyThemeAttribute(normalizedTheme);
  return normalizedTheme;
}

export function setTheme(options = {}) {
  const controlIds = listControlIds(options);
  const nextTheme = typeof options.themeName === "string"
    ? options.themeName
    : document.getElementById(controlIds[0])?.value;
  const normalizedTheme = setThemeState(nextTheme, options);

  if (options.storageKey) {
    const storageApi = options.storageApi || globalScope.AppStorage;
    if (storageApi && typeof storageApi.setItem === "function") {
      storageApi.setItem(options.storageKey, normalizedTheme);
    }
  }

  if (typeof options.onAfterToggle === "function") {
    options.onAfterToggle(normalizedTheme);
  }

  return normalizedTheme;
}

export function initThemeFromStorage(options = {}) {
  const storageApi = options.storageApi || globalScope.AppStorage;
  let themeName = "light";

  if (options.storageKey && storageApi && typeof storageApi.getItem === "function") {
    themeName = normalizeTheme(storageApi.getItem(options.storageKey));
  }

  return setThemeState(themeName, options);
}

export function getCurrentTheme() {
  return normalizeTheme(document.documentElement.getAttribute("data-theme") || "light");
}

export const ThemeManager = Object.freeze({
  AVAILABLE_THEMES,
  getCurrentTheme,
  getThemeLabel,
  initThemeFromStorage,
  renderThemeOptions,
  setTheme,
  setThemeState,
});

globalScope.ThemeManager = ThemeManager;

export { AVAILABLE_THEMES };
export default ThemeManager;
