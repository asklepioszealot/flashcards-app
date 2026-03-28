// src/features/editor/editor-events.js
// Editor field state binding: selection memory, height tracking, split drag, raw editor.

import {
  editorState, editorSplitDragState, setEditorSplitDragState,
} from "../../app/state.js";
import {
  MIN_EDITOR_SPLIT_RATIO, MAX_EDITOR_SPLIT_RATIO, MIN_EDITOR_RAW_HEIGHT, EDITOR_SPLIT_KEYBOARD_STEP,
} from "../../shared/constants.js";
import {
  getCurrentEditorDraft,
  ensureEditorDraftUiState,
  getEditorFieldMinimumHeight,
  normalizeEditorSplitRatio,
  ensureEditorRawState,
} from "./editor-state.js";
import { renderAnswerMarkdown } from "../../core/set-codec.js";
import { applyMarkdownSnippet, initEditorEventsRef } from "./editor-toolbar.js";

// Register ourselves as the editor-events reference for toolbar
initEditorEventsRef({
  restoreEditorFieldSelection: (ta) => restoreEditorFieldSelection(ta),
  rememberEditorFieldSelection: (ta) => rememberEditorFieldSelection(ta),
});

export function rememberEditorFieldSelection(textarea) {
  const activeDraft = getCurrentEditorDraft();
  if (!textarea || !activeDraft) return;

  editorState.focusedField = {
    setId: activeDraft.setId,
    cardId: textarea.getAttribute("data-card-id"),
    field: getEditorFieldNameFromElement(textarea),
    selectionStart: typeof textarea.selectionStart === "number" ? textarea.selectionStart : textarea.value.length,
    selectionEnd: typeof textarea.selectionEnd === "number" ? textarea.selectionEnd : textarea.value.length,
    scrollTop: textarea.scrollTop || 0,
  };
}

export function restoreEditorFieldSelection(textarea) {
  const focusedField = editorState.focusedField;
  if (!textarea || !focusedField) return;
  if (
    textarea.getAttribute("data-card-id") !== focusedField.cardId
    || getEditorFieldNameFromElement(textarea) !== focusedField.field
  ) {
    return;
  }

  textarea.focus();
  const valueLength = textarea.value.length;
  const selectionStart = Math.min(focusedField.selectionStart ?? valueLength, valueLength);
  const selectionEnd = Math.min(focusedField.selectionEnd ?? selectionStart, valueLength);
  textarea.setSelectionRange(selectionStart, selectionEnd);
  textarea.scrollTop = focusedField.scrollTop || 0;
}

export function setFocusedEditorField(textarea) {
  rememberEditorFieldSelection(textarea);
}

export function getFocusedEditorFieldElement(options = {}) {
  const focusedField = editorState.focusedField;
  if (!focusedField || focusedField.setId !== getCurrentEditorDraft()?.setId) return null;
  const targetField = document.querySelector(`[data-editor-field="${focusedField.field}"][data-card-id="${focusedField.cardId}"]`);
  if (targetField && options.restoreSelection) restoreEditorFieldSelection(targetField);
  return targetField;
}

export function resolveEditorToolbarTarget(cardId) {
  const focusedField = getFocusedEditorFieldElement({ restoreSelection: true });
  if (focusedField && focusedField.getAttribute("data-card-id") === cardId) {
    return focusedField;
  }

  return document.querySelector(`[data-editor-field="question"][data-card-id="${cardId}"]`)
    || document.querySelector(`[data-editor-field="answer"][data-card-id="${cardId}"]`);
}

export function getEditorFieldNameFromElement(textarea) {
  return textarea.getAttribute("data-editor-field") === "question" ? "question" : "answer";
}

export function getEditorHeightFieldName(element) {
  const explicitField = element?.getAttribute("data-editor-height-field");
  if (explicitField === "question" || explicitField === "answer" || explicitField === "preview") return explicitField;
  return element ? getEditorFieldNameFromElement(element) : null;
}

export function saveEditorFieldHeight(draft, element) {
  if (!draft || !element) return;
  ensureEditorDraftUiState(draft);
  const field = getEditorHeightFieldName(element);
  if (!field) return;
  draft.fieldHeights[field] = Math.max(Math.round(element.offsetHeight), getEditorFieldMinimumHeight(field));
}

export function getEditorFieldHeight(draft, field) {
  ensureEditorDraftUiState(draft);
  const { getDefaultEditorFieldHeight } = require_editor_state_extras();
  return draft.fieldHeights?.[field] || getDefaultEditorFieldHeight(field);
}

export function getEditorSplitRatio(draft) {
  ensureEditorDraftUiState(draft);
  return normalizeEditorSplitRatio(draft.splitRatio);
}

export function setEditorSplitRatio(draft, cardId, value) {
  const splitRatio = normalizeEditorSplitRatio(value);
  draft.splitRatio = splitRatio;
  updateEditorSplitElement(cardId, splitRatio);
  return splitRatio;
}

export function updateEditorSplitElement(cardId, splitRatio) {
  const splitElement = document.querySelector(`[data-editor-split="${cardId}"]`);
  if (!splitElement) return;
  splitElement.style.setProperty("--editor-answer-fr", `${splitRatio}fr`);
  splitElement.style.setProperty("--editor-preview-fr", `${100 - splitRatio}fr`);
  const handle = splitElement.querySelector(`[data-editor-split-handle="${cardId}"]`);
  if (handle) {
    handle.setAttribute("aria-valuenow", String(splitRatio));
    handle.setAttribute("aria-valuetext", `Açıklama %${splitRatio}, önizleme %${100 - splitRatio}`);
  }
}

export function getEditorSplitRatioFromPointer(splitElement, clientX) {
  if (!splitElement || !Number.isFinite(clientX)) return null;
  const rect = splitElement.getBoundingClientRect();
  if (!rect.width) return null;
  return normalizeEditorSplitRatio(((clientX - rect.left) / rect.width) * 100);
}

export function stopEditorSplitDrag() {
  if (!editorSplitDragState) return;
  document.removeEventListener("pointermove", editorSplitDragState.handlePointerMove);
  document.removeEventListener("pointerup", editorSplitDragState.handlePointerUp);
  document.removeEventListener("pointercancel", editorSplitDragState.handlePointerUp);
  editorSplitDragState.handle.classList.remove("is-active");
  document.body.classList.remove("is-editor-split-dragging");
  setEditorSplitDragState(null);
}

export function startEditorSplitDrag(draft, cardId, handle, event) {
  if (!handle || !draft) return;
  if (event.button !== undefined && event.button !== 0) return;
  stopEditorSplitDrag();
  persistFocusedEditorFieldState(draft);
  const splitElement = document.querySelector(`[data-editor-split="${cardId}"]`);
  if (!splitElement) return;

  const handlePointerMove = (moveEvent) => {
    const nextRatio = getEditorSplitRatioFromPointer(splitElement, moveEvent.clientX);
    if (nextRatio === null) return;
    setEditorSplitRatio(draft, cardId, nextRatio);
  };

  const handlePointerUp = () => {
    stopEditorSplitDrag();
  };

  setEditorSplitDragState({
    handle,
    handlePointerMove,
    handlePointerUp,
  });

  handle.classList.add("is-active");
  document.body.classList.add("is-editor-split-dragging");
  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", handlePointerUp);
  document.addEventListener("pointercancel", handlePointerUp);

  if (typeof handle.setPointerCapture === "function" && Number.isInteger(event.pointerId)) {
    handle.setPointerCapture(event.pointerId);
  }

  handlePointerMove(event);
}

export function handleEditorSplitHandleKeydown(draft, cardId, event) {
  let nextRatio = null;
  const currentRatio = getEditorSplitRatio(draft);
  if (event.key === "ArrowLeft") {
    nextRatio = currentRatio - EDITOR_SPLIT_KEYBOARD_STEP;
  } else if (event.key === "ArrowRight") {
    nextRatio = currentRatio + EDITOR_SPLIT_KEYBOARD_STEP;
  } else if (event.key === "Home") {
    nextRatio = MIN_EDITOR_SPLIT_RATIO;
  } else if (event.key === "End") {
    nextRatio = MAX_EDITOR_SPLIT_RATIO;
  }

  if (nextRatio === null) return;
  event.preventDefault();
  setEditorSplitRatio(draft, cardId, nextRatio);
}

export function saveRawEditorState(draft, rawInput = document.getElementById("editor-raw-input")) {
  if (!draft || !rawInput) return;
  draft.rawEditorState = ensureEditorRawState({
    ...draft.rawEditorState,
    height: rawInput.offsetHeight || rawInput.getBoundingClientRect().height || draft.rawEditorState?.height,
    scrollTop: rawInput.scrollTop || 0,
    selectionStart: typeof rawInput.selectionStart === "number" ? rawInput.selectionStart : null,
    selectionEnd: typeof rawInput.selectionEnd === "number" ? rawInput.selectionEnd : null,
    shouldRestoreFocus: document.activeElement === rawInput,
  });
}

export function restoreRawEditorState(draft) {
  const rawInput = document.getElementById("editor-raw-input");
  if (!draft || !rawInput) return;
  const rawEditorState = ensureEditorRawState(draft.rawEditorState);
  draft.rawEditorState = rawEditorState;
  if (Number.isFinite(rawEditorState.height)) {
    rawInput.style.height = `${rawEditorState.height}px`;
  }
  rawInput.scrollTop = rawEditorState.scrollTop || 0;
  if (!rawEditorState.shouldRestoreFocus) return;

  rawInput.focus();
  const valueLength = rawInput.value.length;
  const selectionStart = Math.min(rawEditorState.selectionStart ?? valueLength, valueLength);
  const selectionEnd = Math.min(rawEditorState.selectionEnd ?? selectionStart, valueLength);
  rawInput.setSelectionRange(selectionStart, selectionEnd);
}

export function persistFocusedEditorFieldState(draft) {
  const focusedField = getFocusedEditorFieldElement();
  if (!focusedField) return;
  rememberEditorFieldSelection(focusedField);
  saveEditorFieldHeight(draft, focusedField);
}

export function persistCurrentEditorUiState(draft) {
  if (!draft) return;
  persistFocusedEditorFieldState(draft);
  saveRawEditorState(draft);
}

export function syncEditorFieldFromTextarea(draft, textarea, options = {}) {
  const cardId = textarea.getAttribute("data-card-id");
  const field = getEditorFieldNameFromElement(textarea);
  const card = draft.cards.find((item) => item.id === cardId);
  if (!card) return;

  if (field === "question") {
    card.question = textarea.value;
    const questionPreview = document.querySelector(`[data-editor-list-question="${card.id}"]`);
    if (questionPreview) questionPreview.textContent = card.question.trim() || "Yeni kart";
  } else {
    card.explanationMarkdown = textarea.value;
    const preview = document.querySelector(`[data-editor-preview="${card.id}"]`);
    if (preview) preview.innerHTML = renderAnswerMarkdown(card.explanationMarkdown);
  }

  if (options.recordHistory !== false) {
    const { recordEditorFieldHistory } = require_editor_history();
    recordEditorFieldHistory(draft, cardId, field, textarea.value);
  }
  rememberEditorFieldSelection(textarea);
  saveEditorFieldHeight(draft, textarea);
  import("./editor-state.js").then(({ markDraftDirty }) => markDraftDirty(draft.setId, true));
  import("./editor-render.js").then(({ renderEditorTabs }) => renderEditorTabs());
}

export function bindEditorTextareaState(draft, textarea) {
  const syncSelection = () => rememberEditorFieldSelection(textarea);

  textarea.addEventListener("focus", () => setFocusedEditorField(textarea));
  textarea.addEventListener("click", syncSelection);
  textarea.addEventListener("input", () => syncEditorFieldFromTextarea(draft, textarea));
  textarea.addEventListener("keyup", syncSelection);
  textarea.addEventListener("mouseup", () => {
    syncSelection();
    saveEditorFieldHeight(draft, textarea);
  });
  textarea.addEventListener("select", syncSelection);
  textarea.addEventListener("scroll", syncSelection);
  textarea.addEventListener("blur", syncSelection);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(() => saveEditorFieldHeight(draft, textarea));
    resizeObserver.observe(textarea);
  }
}

export function bindEditorPreviewState(draft, preview) {
  const syncPreviewHeight = () => saveEditorFieldHeight(draft, preview);
  preview.addEventListener("mouseup", syncPreviewHeight);
  preview.addEventListener("pointerup", syncPreviewHeight);

  if (typeof ResizeObserver === "function") {
    const resizeObserver = new ResizeObserver(syncPreviewHeight);
    resizeObserver.observe(preview);
  }
}

export function bindEditorEvents(draft) {
  document.querySelectorAll("[data-editor-toggle-list]").forEach((button) => {
    button.addEventListener("click", () => {
      persistFocusedEditorFieldState(draft);
      draft.listPanelOpen = !draft.listPanelOpen;
      import("./editor-render.js").then(({ renderEditor }) => renderEditor());
    });
  });
  document.getElementById("editor-add-card-btn")?.addEventListener("click", () => {
    persistFocusedEditorFieldState(draft);
    import("./editor-state.js").then(({ addEditorCard }) => {
      addEditorCard(draft);
      import("./editor-render.js").then(({ renderEditor }) => renderEditor());
    });
  });
  document.querySelectorAll("[data-editor-toggle-delete-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      import("./editor-state.js").then(({ toggleEditorDeleteSelectionMode }) => {
        toggleEditorDeleteSelectionMode(draft);
        import("./editor-render.js").then(({ renderEditor }) => renderEditor());
      });
    });
  });
  document.querySelectorAll("[data-editor-delete-select]").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      import("./editor-state.js").then(({ toggleEditorDeleteCardSelection }) => {
        toggleEditorDeleteCardSelection(draft, checkbox.getAttribute("data-editor-delete-select"), event.currentTarget?.checked === true);
        import("./editor-render.js").then(({ renderEditor }) => renderEditor());
      });
    });
  });
  document.querySelectorAll("[data-editor-delete-selected]").forEach((button) => {
    button.addEventListener("click", () => {
      import("./editor-state.js").then(({ deleteSelectedEditorCards }) => {
        const deletedCount = deleteSelectedEditorCards(draft);
        if (!deletedCount) return;
        import("./editor-render.js").then(({ renderEditor }) => {
          renderEditor();
          import("../auth/auth.js").then(({ showEditorStatus }) => {
            showEditorStatus(
              deletedCount === 1 ? "Seçili kart silindi." : `${deletedCount} kart silindi.`,
              "success",
            );
          });
        });
      });
    });
  });
  document.querySelectorAll("[data-editor-select-card]").forEach((button) => {
    button.addEventListener("click", () => {
      persistFocusedEditorFieldState(draft);
      const cardId = button.getAttribute("data-editor-select-card");
      import("./editor-state.js").then(({ setEditorActiveCardById }) => {
        setEditorActiveCardById(draft, cardId);
        import("./editor-render.js").then(({ renderEditor }) => renderEditor());
      });
    });
  });
  document.querySelectorAll("[data-preview-toggle]").forEach((button) => {
    button.addEventListener("click", () => {
      const cardId = button.getAttribute("data-preview-toggle");
      draft.expandedPreviewCardId = draft.expandedPreviewCardId === cardId ? null : cardId;
      import("./editor-render.js").then(({ renderEditor }) => renderEditor());
    });
  });
  document.querySelectorAll("[data-editor-split-handle]").forEach((handle) => {
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const cardId = handle.getAttribute("data-editor-split-handle");
      startEditorSplitDrag(draft, cardId, handle, event);
    });
    handle.addEventListener("keydown", (event) => {
      const cardId = handle.getAttribute("data-editor-split-handle");
      handleEditorSplitHandleKeydown(draft, cardId, event);
    });
  });
  document.querySelectorAll('[data-editor-field="question"], [data-editor-field="answer"]').forEach((textarea) => {
    bindEditorTextareaState(draft, textarea);
  });
  document.querySelectorAll("[data-editor-height-field='preview']").forEach((preview) => {
    bindEditorPreviewState(draft, preview);
  });
  document.querySelectorAll("[data-editor-subject-input]").forEach((input) => {
    input.addEventListener("input", () => {
      const card = draft.cards.find((item) => item.id === input.getAttribute("data-editor-subject-input"));
      if (!card) return;
      card.subject = input.value;
      import("./editor-state.js").then(({ markDraftDirty }) => markDraftDirty(draft.setId, true));
      import("./editor-render.js").then(({ renderEditorTabs }) => renderEditorTabs());
    });
  });
  document.querySelectorAll("[data-md-action]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const action = button.getAttribute("data-md-action");
      if (action === "undo" || action === "redo") {
        import("./editor-history.js").then(({ applyEditorHistoryAction }) => applyEditorHistoryAction(draft, action));
        return;
      }
      const cardId = button.getAttribute("data-card-id");
      const textarea = resolveEditorToolbarTarget(cardId);
      if (textarea) {
        setFocusedEditorField(textarea);
        applyMarkdownSnippet(textarea, action);
      }
    });
  });
  const rawInput = document.getElementById("editor-raw-input");
  if (rawInput) {
    const syncRawInputState = () => saveRawEditorState(draft, rawInput);
    rawInput.addEventListener("input", () => {
      draft.rawSource = rawInput.value;
      import("./editor-state.js").then(({ markDraftDirty }) => markDraftDirty(draft.setId, true));
      import("./editor-render.js").then(({ renderEditorTabs }) => renderEditorTabs());
      syncRawInputState();
    });
    rawInput.addEventListener("click", syncRawInputState);
    rawInput.addEventListener("focus", syncRawInputState);
    rawInput.addEventListener("keyup", syncRawInputState);
    rawInput.addEventListener("mouseup", syncRawInputState);
    rawInput.addEventListener("select", syncRawInputState);
    rawInput.addEventListener("scroll", syncRawInputState);
    rawInput.addEventListener("blur", syncRawInputState);
    if (typeof ResizeObserver === "function") {
      const resizeObserver = new ResizeObserver(syncRawInputState);
      resizeObserver.observe(rawInput);
    }
  }
}

// Lazy reference for editor-history (avoids circular import)
let _editorHistoryModule = null;
function require_editor_history() {
  if (_editorHistoryModule) return _editorHistoryModule;
  throw new Error("editor-history module not yet initialized");
}
export function initEditorHistoryRef(mod) { _editorHistoryModule = mod; }

// Lazy reference for getDefaultEditorFieldHeight from editor-state
let _editorStateExtras = null;
function require_editor_state_extras() {
  if (_editorStateExtras) return _editorStateExtras;
  // Synchronous fallback
  return { getDefaultEditorFieldHeight: (f) => ({ question: 170, answer: 220, preview: 240 })[f] || 180 };
}
export function initEditorStateExtrasRef(mod) { _editorStateExtras = mod; }
