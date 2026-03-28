// src/features/set-manager/undo-toast.js
// Undo toast notification and last-removal restoration.

import {
  lastRemovedSets, setLastRemovedSets,
  undoTimeoutId, setUndoTimeoutId,
  loadedSets,
  selectedSets,
  platformAdapter,
  browserFileHandles,
} from "../../app/state.js";

export function showUndoToast(message) {
  const toast = document.getElementById("undo-toast");
  const messageElement = document.getElementById("undo-message");
  if (!toast || !messageElement) return;
  messageElement.textContent = message;
  toast.style.display = "flex";
  if (undoTimeoutId) clearTimeout(undoTimeoutId);
  setUndoTimeoutId(setTimeout(() => {
    toast.style.display = "none";
    setLastRemovedSets([]);
  }, 7000));
}

export async function undoLastRemoval() {
  if (!lastRemovedSets.length) return;
  try {
    for (const entry of lastRemovedSets) {
      const savedRecord = await platformAdapter.saveSet(entry.setData);
      loadedSets[savedRecord.id] = savedRecord;
      if (entry.wasSelected) selectedSets.add(savedRecord.id);
    }
    const { saveSelectedSets, syncPersistedSetSourcePaths } = await import("../study-state/study-state.js");
    syncPersistedSetSourcePaths();
    await saveSelectedSets();
    const { renderSetList } = await import("./set-manager.js");
    renderSetList();
    document.getElementById("undo-toast").style.display = "none";
    setLastRemovedSets([]);
  } catch (error) {
    console.error(error);
    showUndoToast("Geri alma tamamlanamadı.");
  }
}
