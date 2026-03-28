const THEME_METADATA = Object.freeze({
  light: Object.freeze({
    label: "Aydınlık",
    sortGroup: 0,
    sortLabel: "Aydinlik",
  }),
  midnight: Object.freeze({
    label: "Karanlık",
    sortGroup: 1,
    sortLabel: "Karanlik",
  }),
  dark: Object.freeze({
    label: "Mavi",
    sortGroup: 2,
    sortLabel: "Mavi",
  }),
  ember: Object.freeze({
    label: "Amber",
    sortGroup: 2,
    sortLabel: "Amber",
  }),
});

export const AVAILABLE_THEMES = Object.freeze(Object.keys(THEME_METADATA));

function compareThemes(leftThemeName, rightThemeName) {
  const leftTheme = THEME_METADATA[leftThemeName] || {};
  const rightTheme = THEME_METADATA[rightThemeName] || {};
  const leftGroup = Number.isInteger(leftTheme.sortGroup) ? leftTheme.sortGroup : 2;
  const rightGroup = Number.isInteger(rightTheme.sortGroup) ? rightTheme.sortGroup : 2;
  if (leftGroup !== rightGroup) return leftGroup - rightGroup;

  const leftLabel = leftTheme.sortLabel || leftTheme.label || leftThemeName;
  const rightLabel = rightTheme.sortLabel || rightTheme.label || rightThemeName;
  return String(leftLabel).localeCompare(String(rightLabel), "tr", { sensitivity: "base" });
}

const ORDERED_THEMES = Object.freeze([...AVAILABLE_THEMES].sort(compareThemes));

function normalizeTheme(themeName) {
  return AVAILABLE_THEMES.includes(themeName) ? themeName : "light";
}

function listControlIds(options = {}) {
  const ids = Array.isArray(options.controlIds) ? options.controlIds : [];
  return ids.filter(Boolean);
}

export function getThemeLabel(themeName) {
  return THEME_METADATA[themeName]?.label || String(themeName || "light").toUpperCase();
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
    const storageApi = options.storageApi;
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
  const storageApi = options.storageApi;
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

export default ThemeManager;
