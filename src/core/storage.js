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

  globalScope.AppStorage = Object.freeze({
    getItem,
    setItem,
    removeItem,
  });
})(window);
