(function attachAppStorage(globalScope) {
  "use strict";

  if (globalScope.AppStorage) {
    return;
  }

  const storage = globalScope.localStorage;

  function getItem(key) {
    return storage.getItem(key);
  }

  function setItem(key, value) {
    storage.setItem(key, value);
  }

  function removeItem(key) {
    storage.removeItem(key);
  }

  function getJSON(key, fallbackValue = null) {
    const raw = getItem(key);
    if (raw === null) {
      return fallbackValue;
    }
    return JSON.parse(raw);
  }

  function setJSON(key, value) {
    setItem(key, JSON.stringify(value));
  }

  globalScope.AppStorage = Object.freeze({
    getItem,
    setItem,
    removeItem,
    getJSON,
    setJSON,
  });
})(window);
