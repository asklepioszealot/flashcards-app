// src/features/editor/editor-history.js
// Editor undo/redo history per field per card.

import { MAX_EDITOR_HISTORY_LENGTH } from "../../shared/constants.js";
import { editorState } from "../../app/state.js";
import {
  getCurrentEditorDraft,
  createEditorFieldHistoryState,
  ensureEditorFieldHistoryState,
} from "./editor-state.js";
import { showEditorStatus } from "../auth/auth.js";

export function getEditorFieldHistory(draft, cardId, field, currentValue = "") {
  if (!draft.fieldHistory[cardId]) draft.fieldHistory[cardId] = {};
  if (!draft.fieldHistory[cardId][field]) {
    draft.fieldHistory[cardId][field] = createEditorFieldHistoryState(currentValue);
  }
  return draft.fieldHistory[cardId][field];
}

export function recordEditorFieldHistory(draft, cardId, field, value) {
  const normalizedValue = String(value ?? "");
  const history = getEditorFieldHistory(draft, cardId, field, normalizedValue);
  if (history.entries[history.index] === normalizedValue) return;
  history.entries = [...history.entries.slice(0, history.index + 1), normalizedValue].slice(-MAX_EDITOR_HISTORY_LENGTH);
  history.index = history.entries.length - 1;
}

export function applyEditorHistoryAction(draft, action) {
  const { getFocusedEditorFieldElement, getEditorFieldNameFromElement, syncEditorFieldFromTextarea } = require_editor_events();
  const textarea = getFocusedEditorFieldElement({ restoreSelection: true });
  if (!textarea) {
    showEditorStatus("Geri al / ileri al için önce bir metin alanına tıkla.", "error");
    return;
  }

  const cardId = textarea.getAttribute("data-card-id");
  const field = getEditorFieldNameFromElement(textarea);
  const history = getEditorFieldHistory(draft, cardId, field, textarea.value);
  const nextIndex = action === "undo" ? history.index - 1 : history.index + 1;
  if (nextIndex < 0 || nextIndex >= history.entries.length) return;

  history.index = nextIndex;
  textarea.value = history.entries[nextIndex];
  syncEditorFieldFromTextarea(draft, textarea, { recordHistory: false });
  textarea.focus();
  const valueLength = textarea.value.length;
  textarea.setSelectionRange(valueLength, valueLength);
  const { rememberEditorFieldSelection } = require_editor_events();
  rememberEditorFieldSelection(textarea);
}

// Register history module in editor-events
import("./editor-events.js").then(({ initEditorHistoryRef }) => {
  initEditorHistoryRef({
    recordEditorFieldHistory,
  });
});

// Lazy reference to editor-events to break circular
let _editorEventsModule = null;
function require_editor_events() {
  if (_editorEventsModule) return _editorEventsModule;
  throw new Error("editor-events module not initialized");
}
export function initEditorEventsRef(mod) { _editorEventsModule = mod; }

// Auto-initialize when both modules are loaded
import("./editor-events.js").then((mod) => {
  initEditorEventsRef(mod);
});
