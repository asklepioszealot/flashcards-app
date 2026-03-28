// src/features/editor/editor-state.js
// Editor draft creation, card management, view modes, open/close logic.

import {
  editorState, setEditorState, resetEditorState,
  loadedSets, setLoadedSets,
  selectedSets,
} from "../../app/state.js";
import {
  DEFAULT_EDITOR_FIELD_HEIGHTS, MIN_EDITOR_FIELD_HEIGHTS,
  DEFAULT_EDITOR_SPLIT_RATIO, MIN_EDITOR_SPLIT_RATIO, MAX_EDITOR_SPLIT_RATIO,
  MIN_EDITOR_RAW_HEIGHT, MAX_EDITOR_HISTORY_LENGTH,
} from "../../shared/constants.js";
import { nowIso } from "../../shared/utils.js";
import {
  buildEditorDraft, buildSetFromEditorDraft, parseSetText, backfillRawSource, normalizeSetRecord,
} from "../../core/set-codec.js";
import { generateId } from "../../core/set-codec.js";
import { showEditorStatus } from "../auth/auth.js";

// ── Field height helpers ──
export function getDefaultEditorFieldHeight(field) {
  return DEFAULT_EDITOR_FIELD_HEIGHTS[field] || 180;
}

export function getEditorFieldMinimumHeight(field) {
  return MIN_EDITOR_FIELD_HEIGHTS[field] || 120;
}

export function ensureEditorFieldHeightsState(fieldHeights = {}) {
  const questionHeight = Number.parseFloat(fieldHeights?.question);
  const answerHeight = Number.parseFloat(fieldHeights?.answer);
  const previewHeight = Number.parseFloat(fieldHeights?.preview);

  return {
    question: Number.isFinite(questionHeight) ? Math.max(Math.round(questionHeight), getEditorFieldMinimumHeight("question")) : getDefaultEditorFieldHeight("question"),
    answer: Number.isFinite(answerHeight) ? Math.max(Math.round(answerHeight), getEditorFieldMinimumHeight("answer")) : getDefaultEditorFieldHeight("answer"),
    preview: Number.isFinite(previewHeight) ? Math.max(Math.round(previewHeight), getEditorFieldMinimumHeight("preview")) : getDefaultEditorFieldHeight("preview"),
  };
}

export function normalizeEditorSplitRatio(value) {
  const parsedValue = Number.parseInt(value, 10);
  if (!Number.isFinite(parsedValue)) return DEFAULT_EDITOR_SPLIT_RATIO;
  return Math.min(Math.max(parsedValue, MIN_EDITOR_SPLIT_RATIO), MAX_EDITOR_SPLIT_RATIO);
}

export function ensureEditorRawState(rawState = {}) {
  const height = Number.parseFloat(rawState?.height);
  const scrollTop = Number.parseFloat(rawState?.scrollTop);
  const selectionStart = Number.isInteger(rawState?.selectionStart) ? rawState.selectionStart : null;
  const selectionEnd = Number.isInteger(rawState?.selectionEnd) ? rawState.selectionEnd : selectionStart;

  return {
    height: Number.isFinite(height) ? Math.max(Math.round(height), MIN_EDITOR_RAW_HEIGHT) : MIN_EDITOR_RAW_HEIGHT,
    scrollTop: Number.isFinite(scrollTop) ? Math.max(scrollTop, 0) : 0,
    selectionStart,
    selectionEnd,
    shouldRestoreFocus: rawState?.shouldRestoreFocus === true,
  };
}

export function ensureEditorDraftUiState(draft) {
  const cards = Array.isArray(draft?.cards) ? draft.cards : [];
  const availableCardIds = new Set(cards.map((card) => card.id));
  if (draft.formLayoutMode !== "single") {
    draft.formLayoutMode = "list";
  }
  if (typeof draft.listPanelOpen !== "boolean") {
    draft.listPanelOpen = true;
  }
  if (typeof draft.deleteSelectionMode !== "boolean") {
    draft.deleteSelectionMode = false;
  }
  draft.deleteSelectionCardIds = Array.isArray(draft.deleteSelectionCardIds)
    ? draft.deleteSelectionCardIds.filter((cardId) => availableCardIds.has(cardId))
    : [];
  draft.fieldHeights = ensureEditorFieldHeightsState(draft.fieldHeights);
  draft.splitRatio = normalizeEditorSplitRatio(draft.splitRatio);
  draft.rawEditorState = ensureEditorRawState(draft.rawEditorState);
  draft.fieldHistory = Object.fromEntries(
    cards.map((card) => [
      card.id,
      {
        question: ensureEditorFieldHistoryState(draft.fieldHistory?.[card.id]?.question, card.question),
        answer: ensureEditorFieldHistoryState(draft.fieldHistory?.[card.id]?.answer, card.explanationMarkdown),
      },
    ]),
  );
  if (!availableCardIds.size) {
    draft.activeCardIndex = 0;
    draft.expandedCardId = null;
    draft.toolbarExpandedCardId = null;
    draft.expandedPreviewCardId = null;
    draft.deleteSelectionMode = false;
    draft.deleteSelectionCardIds = [];
    return draft;
  }
  if (!Number.isInteger(draft.activeCardIndex)) {
    draft.activeCardIndex = 0;
  }
  draft.activeCardIndex = Math.min(Math.max(draft.activeCardIndex, 0), cards.length - 1);
  if (draft.expandedCardId === undefined) {
    draft.expandedCardId = null;
  } else if (draft.expandedCardId !== null && !availableCardIds.has(draft.expandedCardId)) {
    draft.expandedCardId = null;
  }
  if (draft.expandedCardId !== null) {
    const expandedCardIndex = cards.findIndex((card) => card.id === draft.expandedCardId);
    if (expandedCardIndex >= 0) {
      draft.activeCardIndex = expandedCardIndex;
    }
  }
  if (draft.toolbarExpandedCardId && !availableCardIds.has(draft.toolbarExpandedCardId)) {
    draft.toolbarExpandedCardId = null;
  }
  if (draft.expandedPreviewCardId && !availableCardIds.has(draft.expandedPreviewCardId)) {
    draft.expandedPreviewCardId = null;
  }
  if (editorState.focusedField?.setId === draft.setId && !availableCardIds.has(editorState.focusedField.cardId)) {
    editorState.focusedField = null;
  }
  return draft;
}

export function createEditorFieldHistoryState(value = "") {
  return {
    entries: [String(value ?? "")],
    index: 0,
  };
}

export function ensureEditorFieldHistoryState(historyState, value = "") {
  const normalizedValue = String(value ?? "");
  let entries = Array.isArray(historyState?.entries) && historyState.entries.length
    ? historyState.entries.map((entry) => String(entry ?? ""))
    : [normalizedValue];
  let index = Number.isInteger(historyState?.index) ? historyState.index : entries.length - 1;
  index = Math.min(Math.max(index, 0), entries.length - 1);

  if (entries[index] !== normalizedValue) {
    entries = [...entries.slice(0, index + 1), normalizedValue].slice(-MAX_EDITOR_HISTORY_LENGTH);
    index = entries.length - 1;
  }

  return { entries, index };
}

export const getCurrentEditorDraft = () => editorState.activeSetId ? editorState.drafts[editorState.activeSetId] : null;

export function createEditorDraft(setRecord, previousDraft = null) {
  const baseDraft = buildEditorDraft(setRecord);
  return ensureEditorDraftUiState({
    ...baseDraft,
    dirty: false,
    formLayoutMode: previousDraft?.formLayoutMode ?? baseDraft.formLayoutMode ?? "list",
    listPanelOpen: previousDraft?.listPanelOpen ?? true,
    activeCardIndex: Number.isInteger(previousDraft?.activeCardIndex) ? previousDraft.activeCardIndex : 0,
    expandedCardId: previousDraft ? previousDraft.expandedCardId : baseDraft.expandedCardId ?? null,
    toolbarExpandedCardId: previousDraft?.toolbarExpandedCardId ?? baseDraft.toolbarExpandedCardId ?? null,
    expandedPreviewCardId: previousDraft?.expandedPreviewCardId ?? baseDraft.expandedPreviewCardId ?? null,
    fieldHeights: previousDraft?.fieldHeights || {},
    splitRatio: previousDraft?.splitRatio,
    fieldHistory: previousDraft?.fieldHistory || {},
    rawEditorState: previousDraft?.rawEditorState,
    deleteSelectionMode: previousDraft?.deleteSelectionMode ?? false,
    deleteSelectionCardIds: Array.isArray(previousDraft?.deleteSelectionCardIds) ? [...previousDraft.deleteSelectionCardIds] : [],
    baseUpdatedAt: setRecord?.updatedAt || nowIso(),
  });
}

export function getEditorActiveCard(draft) {
  ensureEditorDraftUiState(draft);
  return draft.cards[draft.activeCardIndex] || null;
}

export function setEditorActiveCardIndex(draft, index) {
  ensureEditorDraftUiState(draft);
  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    return;
  }
  draft.activeCardIndex = Math.min(Math.max(index, 0), draft.cards.length - 1);
  draft.expandedCardId = null;
  draft.toolbarExpandedCardId = null;
}

export function setEditorActiveCardById(draft, cardId) {
  const targetIndex = draft.cards.findIndex((card) => card.id === cardId);
  if (targetIndex < 0) return;
  setEditorActiveCardIndex(draft, targetIndex);
}

export function queueEditorCardScroll(cardId) {
  editorState.pendingScrollCardId = cardId || null;
}

export function markDraftDirty(setId, dirty = true) {
  const draft = editorState.drafts[setId];
  if (!draft) return;
  draft.dirty = dirty;
  import("./editor-render.js").then(({ refreshEditorPills }) => refreshEditorPills());
}

export function addEditorCard(draft) {
  const activeCard = getEditorActiveCard(draft);
  const newCard = {
    id: generateId("card"),
    subject: activeCard?.subject || draft.setName || "Genel",
    question: "",
    explanationMarkdown: "",
  };
  draft.cards.push(newCard);
  setEditorActiveCardIndex(draft, draft.cards.length - 1);
  editorState.focusedField = {
    setId: draft.setId,
    cardId: newCard.id,
    field: "question",
  };
  markDraftDirty(draft.setId, true);
}

export function deleteEditorCard(draft, cardId) {
  const targetIndex = draft.cards.findIndex((card) => card.id === cardId);
  if (targetIndex < 0) return;

  draft.cards.splice(targetIndex, 1);
  draft.deleteSelectionCardIds = draft.deleteSelectionCardIds.filter((selectedCardId) => selectedCardId !== cardId);
  if (editorState.focusedField?.cardId === cardId) {
    editorState.focusedField = null;
  }
  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    draft.toolbarExpandedCardId = null;
    draft.expandedCardId = null;
    markDraftDirty(draft.setId, true);
    return;
  }

  const nextIndex = targetIndex >= draft.cards.length ? draft.cards.length - 1 : targetIndex;
  setEditorActiveCardIndex(draft, nextIndex);
  markDraftDirty(draft.setId, true);
}

export function toggleEditorDeleteSelectionMode(draft) {
  draft.deleteSelectionMode = !draft.deleteSelectionMode;
  if (!draft.deleteSelectionMode) {
    draft.deleteSelectionCardIds = [];
  }
}

export function toggleEditorDeleteCardSelection(draft, cardId, shouldSelect) {
  const selectedIds = new Set(draft.deleteSelectionCardIds);
  if (shouldSelect) selectedIds.add(cardId);
  else selectedIds.delete(cardId);
  draft.deleteSelectionCardIds = draft.cards
    .map((card) => card.id)
    .filter((candidateId) => selectedIds.has(candidateId));
}

export function deleteSelectedEditorCards(draft) {
  ensureEditorDraftUiState(draft);
  const selectedIds = draft.deleteSelectionCardIds.filter((cardId) => draft.cards.some((card) => card.id === cardId));
  if (!selectedIds.length) {
    showEditorStatus("Silmek için önce en az bir kart seç.", "error");
    return 0;
  }

  const confirmationMessage = selectedIds.length === 1
    ? "Seçili kartı silmek istediğine emin misin?"
    : `Seçili ${selectedIds.length} kartı silmek istediğine emin misin?`;

  if (!confirm(confirmationMessage)) return 0;

  const selectedIdSet = new Set(selectedIds);
  const currentActiveCardId = getEditorActiveCard(draft)?.id || null;
  draft.cards = draft.cards.filter((card) => !selectedIdSet.has(card.id));
  draft.deleteSelectionCardIds = [];
  draft.deleteSelectionMode = false;

  if (editorState.focusedField?.setId === draft.setId && selectedIdSet.has(editorState.focusedField.cardId)) {
    editorState.focusedField = null;
  }

  if (!draft.cards.length) {
    draft.activeCardIndex = 0;
    draft.toolbarExpandedCardId = null;
    draft.expandedCardId = null;
    draft.expandedPreviewCardId = null;
  } else if (currentActiveCardId && draft.cards.some((card) => card.id === currentActiveCardId)) {
    setEditorActiveCardById(draft, currentActiveCardId);
  } else {
    setEditorActiveCardIndex(draft, Math.min(draft.activeCardIndex, draft.cards.length - 1));
  }

  markDraftDirty(draft.setId, true);
  return selectedIds.length;
}

export function buildRawSourceFromDraft(draft) {
  const nextRecord = buildSetFromEditorDraft(draft, loadedSets[draft.setId]);
  draft.rawSource = nextRecord.rawSource;
  draft.setName = nextRecord.setName;
}

export function syncDraftFromRaw(draft) {
  const existingRecord = loadedSets[draft.setId];
  const nextRecord = parseSetText(
    draft.rawSource,
    existingRecord?.fileName || `${draft.setId}.${draft.sourceFormat === "markdown" ? "md" : "json"}`,
    existingRecord,
    draft.sourceFormat,
  );
  const nextDraft = buildEditorDraft(nextRecord);
  draft.cards = nextDraft.cards;
  draft.rawSource = nextDraft.rawSource;
  draft.setName = nextDraft.setName;
  ensureEditorDraftUiState(draft);
}

export function resolveEditorDraftRecord(draft) {
  const previousRecord = loadedSets[draft.setId];
  const nextRecord = draft.viewMode === "raw"
    ? parseSetText(
        draft.rawSource,
        previousRecord?.fileName || `${draft.setId}.${draft.sourceFormat === "markdown" ? "md" : "json"}`,
        previousRecord,
        draft.sourceFormat,
      )
    : buildSetFromEditorDraft(draft, previousRecord);

  nextRecord.rawSource = backfillRawSource(nextRecord);
  return nextRecord;
}

export function resolveEditorConflictDraft(draft, remoteRecord) {
  loadedSets[remoteRecord.id] = remoteRecord;
  import("../set-manager/set-manager.js").then(({ syncPersistedSetSourcePaths }) => syncPersistedSetSourcePaths());
  const refreshedDraft = createEditorDraft(remoteRecord, draft);
  refreshedDraft.viewMode = draft.viewMode;
  if (refreshedDraft.viewMode === "raw") refreshedDraft.rawSource = remoteRecord.rawSource;
  editorState.drafts[remoteRecord.id] = refreshedDraft;
}

export function openEditorForSelectedSets() {
  const targetSetIds = [...selectedSets].filter((setId) => loadedSets[setId]);
  if (!targetSetIds.length) return;
  setEditorState({
    isOpen: true,
    activeSetId: targetSetIds[0],
    draftOrder: targetSetIds,
    drafts: Object.fromEntries(targetSetIds.map((setId) => [setId, createEditorDraft(loadedSets[setId])])),
    focusedField: null,
    pendingScrollCardId: null,
  });
  import("../../app/screen.js").then(({ showScreen }) => {
    showScreen("editor");
    import("./editor-render.js").then(({ renderEditor }) => renderEditor());
  });
}

export function confirmLeaveEditor() {
  return !Object.values(editorState.drafts).some((draft) => draft.dirty) || confirm("Kaydedilmemiş değişiklikler var. Editörden çıkmak istediğine emin misin?");
}

export function closeEditor(force = false) {
  if (!force && !confirmLeaveEditor()) return;
  resetEditorState();
  import("../set-manager/set-manager.js").then(({ renderSetList }) => {
    renderSetList();
    import("../../app/screen.js").then(({ showScreen }) => showScreen("manager"));
  });
}

export async function toggleEditorViewMode() {
  const draft = getCurrentEditorDraft();
  if (!draft) return;
  try {
    const { persistCurrentEditorUiState } = await import("./editor-events.js");
    persistCurrentEditorUiState(draft);
    if (draft.viewMode === "form") {
      buildRawSourceFromDraft(draft);
      draft.viewMode = "raw";
    } else {
      syncDraftFromRaw(draft);
      draft.viewMode = "form";
    }
    const { renderEditor } = await import("./editor-render.js");
    renderEditor();
  } catch (error) {
    console.error(error);
    showEditorStatus(error.message || "Raw içerik çözümlenemedi.", "error");
  }
}
