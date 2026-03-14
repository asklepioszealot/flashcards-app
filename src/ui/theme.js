(function attachThemeManager(globalScope) {
  "use strict";

  if (globalScope.ThemeManager) {
    return;
  }

  function setToggleState(toggleId, isDark) {
    const toggle = document.getElementById(toggleId);
    if (toggle) {
      toggle.checked = isDark;
    }
  }

  function syncThemeToggles(primaryToggleId, managerToggleId, isDark) {
    setToggleState(primaryToggleId, isDark);
    setToggleState(managerToggleId, isDark);
  }

  function applyThemeAttribute(isDark) {
    if (isDark) {
      document.documentElement.setAttribute("data-theme", "dark");
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  }

  function setThemeState(isDark, options = {}) {
    const primaryToggleId = options.primaryToggleId || "theme-toggle";
    const managerToggleId = options.managerToggleId || "theme-toggle-manager";
    syncThemeToggles(primaryToggleId, managerToggleId, isDark);
    applyThemeAttribute(isDark);
    return isDark;
  }

  function toggleTheme(options = {}) {
    const primaryToggleId = options.primaryToggleId || "theme-toggle";
    const managerToggleId = options.managerToggleId || "theme-toggle-manager";

    let isDark;
    if (typeof options.isChecked === "boolean") {
      isDark = options.isChecked;
      syncThemeToggles(primaryToggleId, managerToggleId, isDark);
    } else {
      const primaryToggle = document.getElementById(primaryToggleId);
      isDark = Boolean(primaryToggle && primaryToggle.checked);
      setToggleState(managerToggleId, isDark);
    }

    applyThemeAttribute(isDark);

    if (options.storageKey) {
      const storageApi = options.storageApi || globalScope.AppStorage;
      if (storageApi && typeof storageApi.setItem === "function") {
        storageApi.setItem(options.storageKey, isDark ? "dark" : "light");
      }
    }

    if (typeof options.onAfterToggle === "function") {
      options.onAfterToggle(isDark);
    }

    return isDark;
  }

  function initThemeFromStorage(options = {}) {
    const storageApi = options.storageApi || globalScope.AppStorage;
    let isDark = false;

    if (options.storageKey && storageApi && typeof storageApi.getItem === "function") {
      isDark = storageApi.getItem(options.storageKey) === "dark";
    }

    return setThemeState(isDark, options);
  }

  globalScope.ThemeManager = Object.freeze({
    toggleTheme,
    initThemeFromStorage,
    setThemeState,
  });
})(window);
