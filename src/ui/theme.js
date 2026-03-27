(function attachThemeManager(globalScope) {
  "use strict";

  if (globalScope.ThemeManager) {
    return;
  }

  const AVAILABLE_THEMES = Object.freeze(["light", "dark", "ember", "midnight"]);

  function normalizeTheme(themeName) {
    return AVAILABLE_THEMES.includes(themeName) ? themeName : "light";
  }

  function listControlIds(options = {}) {
    const ids = Array.isArray(options.controlIds) ? options.controlIds : [];
    return ids.filter(Boolean);
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

  function setThemeState(themeName, options = {}) {
    const normalizedTheme = normalizeTheme(themeName);
    syncThemeControls(listControlIds(options), normalizedTheme);
    applyThemeAttribute(normalizedTheme);
    return normalizedTheme;
  }

  function setTheme(options = {}) {
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

  function initThemeFromStorage(options = {}) {
    const storageApi = options.storageApi || globalScope.AppStorage;
    let themeName = "light";

    if (options.storageKey && storageApi && typeof storageApi.getItem === "function") {
      themeName = normalizeTheme(storageApi.getItem(options.storageKey));
    }

    return setThemeState(themeName, options);
  }

  function getCurrentTheme() {
    return normalizeTheme(document.documentElement.getAttribute("data-theme") || "light");
  }

  globalScope.ThemeManager = Object.freeze({
    AVAILABLE_THEMES,
    getCurrentTheme,
    initThemeFromStorage,
    setTheme,
    setThemeState,
  });
})(window);
