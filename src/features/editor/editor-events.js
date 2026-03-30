// src/features/editor/editor-events.js
// Editor field state binding: selection memory, height tracking, split drag, raw editor.

import {
  editorState,
  editorSplitDragState,
  setEditorSplitDragState,
  platformAdapter,
} from "../../app/state.js";
import {
  MIN_EDITOR_SPLIT_RATIO,
  MAX_EDITOR_SPLIT_RATIO,
  EDITOR_SPLIT_KEYBOARD_STEP,
  MIN_EDITOR_RAW_HEIGHT,
  FLASHCARD_MEDIA_ACCEPT,
} from "../../shared/constants.js";
import { escapeAttributeSelectorValue } from "../../shared/utils.js";
import {
  getCurrentEditorDraft,
  ensureEditorDraftUiState,
  getEditorFieldMinimumHeight,
  normalizeEditorSplitRatio,
  ensureEditorRawState,
} from "./editor-state.js";
import { renderAnswerMarkdown } from "../../core/set-codec.js";
import {
  buildMediaMarkdownSnippet,
  prepareMediaUpload,
  resolveMediaUploadErrorMessage,
} from "./editor-media.js";
import { applyMarkdownSnippet, initEditorEventsRef, insertTextAtSelection } from "./editor-toolbar.js";

// Register ourselves as the editor-events reference for toolbar
initEditorEventsRef({
  restoreEditorFieldSelection: (ta) => restoreEditorFieldSelection(ta),
  rememberEditorFieldSelection: (ta) => rememberEditorFieldSelection(ta),
});

const sessionTopicRenamePromptDismissedSetIds = new Set();

function markEditorDraftDirty(draft) {
  if (!draft?.setId) return;
  import("./editor-state.js").then(({ markDraftDirty }) => markDraftDirty(draft.setId, true));
}

function renderEditorDraftTabs() {
  import("./editor-render.js").then(({ renderEditorTabs }) => renderEditorTabs());
}

function resolveEditorSubjectCard(draft, input) {
  const cardId = input?.getAttribute("data-editor-subject-input");
  if (!cardId || !Array.isArray(draft?.cards)) return null;
  return draft.cards.find((item) => item.id === cardId) || null;
}

function syncEditorSubjectValue(draft, input) {
  const card = resolveEditorSubjectCard(draft, input);
  if (!card) return null;
  card.subject = input.value;
  markEditorDraftDirty(draft);
  renderEditorDraftTabs();
  return card;
}

function handleEditorSubjectRenameCommit(draft, input) {
  const card = resolveEditorSubjectCard(draft, input);
  if (!card) return;

  const previousSubject = input.dataset.previousSubject ?? card.subject;
  const nextSubject = input.value;
  card.subject = nextSubject;
  input.dataset.previousSubject = nextSubject;

  if (previousSubject === nextSubject) return;

  const matchingCards = draft.cards.filter((candidate) => candidate.id !== card.id && candidate.subject === previousSubject);
  if (!matchingCards.length || sessionTopicRenamePromptDismissedSetIds.has(draft.setId)) {
    return;
  }

  const shouldRenameMatchingTopics = confirm("Ayni konu adina sahip diger kartlar da guncellensin mi?");
  if (shouldRenameMatchingTopics) {
    matchingCards.forEach((candidate) => {
      candidate.subject = nextSubject;
    });
    return;
  }

  sessionTopicRenamePromptDismissedSetIds.add(draft.setId);
}

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
  const escapedCardId = escapeAttributeSelectorValue(focusedField.cardId);
  const targetField = document.querySelector(`[data-editor-field="${focusedField.field}"][data-card-id="${escapedCardId}"]`);
  if (targetField && options.restoreSelection) restoreEditorFieldSelection(targetField);
  return targetField;
}

export function resolveEditorToolbarTarget(cardId) {
  const escapedCardId = escapeAttributeSelectorValue(cardId);
  const focusedField = getFocusedEditorFieldElement({ restoreSelection: true });
  if (focusedField && focusedField.getAttribute("data-card-id") === cardId) {
    return focusedField;
  }

  return document.querySelector(`[data-editor-field="question"][data-card-id="${escapedCardId}"]`)
    || document.querySelector(`[data-editor-field="answer"][data-card-id="${escapedCardId}"]`);
}

function closeAttachmentMenus() {
}

function syncAttachmentButtonState(shell) {
  if (!shell) return;
  const toggleButton = shell.querySelector("[data-editor-attachment-toggle]");
  const fileInput = shell.querySelector("[data-editor-attachment-input]");
  const isLoading = shell.classList.contains("is-loading");

  if (toggleButton) {
    toggleButton.disabled = isLoading;
    toggleButton.classList.toggle("is-loading", isLoading);
  }

  if (fileInput) {
    fileInput.disabled = isLoading;
  }
}

function setAttachmentLoading(cardId, isLoading) {
  const escapedCardId = escapeAttributeSelectorValue(cardId);
  const shell = document.querySelector(`[data-editor-attachment-shell="${escapedCardId}"]`);
  if (!shell) return;
  shell.classList.toggle("is-loading", isLoading);
  shell.setAttribute("aria-busy", isLoading ? "true" : "false");
  syncAttachmentButtonState(shell);
}

function openAttachmentFilePicker(button) {
  const cardId = button?.getAttribute("data-card-id");
  if (!cardId) return;
  const escapedCardId = escapeAttributeSelectorValue(cardId);
  const input = document.querySelector(`[data-editor-attachment-input="${escapedCardId}"]`);
  if (!input) return;

  input.dataset.attachmentKind = "";
  input.accept = FLASHCARD_MEDIA_ACCEPT;
  closeAttachmentMenus();
  input.click();
}

async function handleAttachmentFileSelection(input) {
  const cardId = input?.getAttribute("data-card-id");
  if (!cardId) return;

  const selectedFile = input.files?.[0];
  const intendedKind = input.dataset.attachmentKind || null;
  input.value = "";
  input.dataset.attachmentKind = "";
  input.accept = FLASHCARD_MEDIA_ACCEPT;

  if (!selectedFile) {
    closeAttachmentMenus();
    return;
  }

  const textarea = resolveEditorToolbarTarget(cardId);
  if (!textarea) return;

  setFocusedEditorField(textarea);
  closeAttachmentMenus();
  setAttachmentLoading(cardId, true);
  const { showEditorStatus } = await import("../auth/auth.js");
  showEditorStatus("Medya yukleniyor...");

  try {
    if (!platformAdapter?.supportsMediaUpload || typeof platformAdapter.uploadMediaAttachment !== "function") {
      const unsupportedError = new Error("Medya yuklemek icin Supabase Storage yapilandirmasi gerekli.");
      unsupportedError.code = "MEDIA_UPLOAD_NOT_SUPPORTED";
      throw unsupportedError;
    }

    const preparedUpload = await prepareMediaUpload(selectedFile, { intendedKind });
    const uploadResult = await platformAdapter.uploadMediaAttachment(preparedUpload.file, preparedUpload);
    if (!uploadResult?.publicUrl) {
      throw new Error("Yuklenen medya icin public URL alinamadi.");
    }

    const markdownSnippet = buildMediaMarkdownSnippet(preparedUpload.kind, uploadResult.publicUrl);
    insertTextAtSelection(
      textarea,
      markdownSnippet,
      {
        selectionEnd: markdownSnippet.length,
        selectionStart: markdownSnippet.length,
      },
    );

    showEditorStatus(preparedUpload.kind === "image" ? "Gorsel eklendi." : "Ses eklendi.", "success");
  } catch (error) {
    console.error(error);
    showEditorStatus(resolveMediaUploadErrorMessage(error), "error");
  } finally {
    setAttachmentLoading(cardId, false);
  }
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
  const escapedCardId = escapeAttributeSelectorValue(cardId);
  const splitElement = document.querySelector(`[data-editor-split="${escapedCardId}"]`);
  if (!splitElement) return;
  splitElement.style.setProperty("--editor-answer-fr", `${splitRatio}fr`);
  splitElement.style.setProperty("--editor-preview-fr", `${100 - splitRatio}fr`);
  const handle = splitElement.querySelector(`[data-editor-split-handle="${escapedCardId}"]`);
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
  const escapedCardId = escapeAttributeSelectorValue(cardId);
  const splitElement = document.querySelector(`[data-editor-split="${escapedCardId}"]`);
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
    scrollTop: rawInput.scrollTop || 0,
    selectionStart: typeof rawInput.selectionStart === "number" ? rawInput.selectionStart : null,
    selectionEnd: typeof rawInput.selectionEnd === "number" ? rawInput.selectionEnd : null,
    shouldRestoreFocus: document.activeElement === rawInput,
  });
  syncRawEditorGutter(rawInput);
}

export function syncRawEditorHeight(rawInput = document.getElementById("editor-raw-input")) {
  if (!rawInput) return;
  rawInput.style.height = "auto";
  rawInput.style.height = `${Math.max(rawInput.scrollHeight || 0, MIN_EDITOR_RAW_HEIGHT)}px`;
}

function buildRawEditorLineNumbers(value) {
  return Array.from(
    { length: Math.max(String(value ?? "").split("\n").length, 1) },
    (_, index) => String(index + 1),
  ).join("\n");
}

export function syncRawEditorGutter(rawInput = document.getElementById("editor-raw-input")) {
  const gutter = document.getElementById("editor-raw-gutter");
  const gutterLines = document.getElementById("editor-raw-gutter-lines");
  if (!rawInput || !gutter || !gutterLines) return;
  const lineNumbers = buildRawEditorLineNumbers(rawInput.value);
  const scrollTop = rawInput.scrollTop || 0;
  if (gutterLines.textContent !== lineNumbers) {
    gutterLines.textContent = lineNumbers;
  }
  gutter.dataset.scrollSync = String(Math.round(scrollTop));
  gutterLines.style.transform = `translateY(-${scrollTop}px)`;
}

export function restoreRawEditorState(draft) {
  const rawInput = document.getElementById("editor-raw-input");
  if (!draft || !rawInput) return;
  const rawEditorState = ensureEditorRawState(draft.rawEditorState);
  draft.rawEditorState = rawEditorState;
  syncRawEditorHeight(rawInput);
  rawInput.scrollTop = rawEditorState.scrollTop || 0;
  syncRawEditorGutter(rawInput);
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
    const escapedCardId = escapeAttributeSelectorValue(card.id);
    const questionPreview = document.querySelector(`[data-editor-list-question="${escapedCardId}"]`);
    if (questionPreview) questionPreview.textContent = card.question.trim() || "Yeni kart";
  } else {
    card.explanationMarkdown = textarea.value;
    const escapedCardId = escapeAttributeSelectorValue(card.id);
    const preview = document.querySelector(`[data-editor-preview="${escapedCardId}"]`);
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
      const cardId = checkbox.getAttribute("data-editor-delete-select");
      const shouldSelect = event.currentTarget?.checked === true;
      import("./editor-state.js").then(({ toggleEditorDeleteCardSelection }) => {
        toggleEditorDeleteCardSelection(draft, cardId, shouldSelect);
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
    input.dataset.previousSubject = input.value;
    input.addEventListener("focus", () => {
      const card = resolveEditorSubjectCard(draft, input);
      input.dataset.previousSubject = card?.subject ?? input.value;
    });
    input.addEventListener("input", () => {
      syncEditorSubjectValue(draft, input);
    });
    input.addEventListener("change", () => {
      handleEditorSubjectRenameCommit(draft, input);
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
      if (
        (action === "attachment-image" || action === "attachment-audio")
        && platformAdapter?.supportsMediaUpload
      ) {
        return;
      }
      const cardId = button.getAttribute("data-card-id");
      const textarea = resolveEditorToolbarTarget(cardId);
      if (textarea) {
        setFocusedEditorField(textarea);
        applyMarkdownSnippet(textarea, action);
        closeAttachmentMenus();
      }
    });
  });
  document.querySelectorAll("[data-editor-attachment-input]").forEach((input) => {
    input.addEventListener("change", () => {
      void handleAttachmentFileSelection(input);
    });
  });
  document.querySelectorAll("[data-editor-attachment-toggle]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const textarea = resolveEditorToolbarTarget(button.getAttribute("data-card-id"));
      if (textarea) {
        setFocusedEditorField(textarea);
      }
      openAttachmentFilePicker(button);
    });
  });
  document.querySelectorAll("[data-editor-card-nav]").forEach((button) => {
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
    });
    button.addEventListener("click", () => {
      const direction = button.getAttribute("data-editor-card-nav");
      if (direction !== "previous" && direction !== "next") return;
      persistFocusedEditorFieldState(draft);
      const delta = direction === "next" ? 1 : -1;
      import("./editor-state.js").then(({ setEditorActiveCardIndex }) => {
        setEditorActiveCardIndex(draft, draft.activeCardIndex + delta);
        import("./editor-render.js").then(({ renderEditor }) => renderEditor());
      });
    });
  });
  const rawInput = document.getElementById("editor-raw-input");
  if (rawInput) {
    const syncRawInputState = () => {
      syncRawEditorHeight(rawInput);
      saveRawEditorState(draft, rawInput);
    };
    syncRawInputState();
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
