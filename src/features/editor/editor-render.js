// src/features/editor/editor-render.js
// Editor UI rendering: tabs, card list, card detail, form/raw views, pills, scroll flush.

import { editorState } from "../../app/state.js";
import { MIN_EDITOR_SPLIT_RATIO, MAX_EDITOR_SPLIT_RATIO } from "../../shared/constants.js";
import { escapeMarkup } from "../../shared/utils.js";
import { renderAnswerMarkdown } from "../../core/set-codec.js";
import {
  getCurrentEditorDraft,
  ensureEditorDraftUiState,
  getEditorActiveCard,
  ensureEditorRawState,
} from "./editor-state.js";
import {
  bindEditorEvents,
  stopEditorSplitDrag,
  persistCurrentEditorUiState,
  restoreRawEditorState,
  getEditorFieldHeight,
  getEditorSplitRatio,
} from "./editor-events.js";
import { renderEditorFormattingToolbar } from "./editor-toolbar.js";
import { showEditorStatus } from "../auth/auth.js";

export function formatEditorConflictTimestamp(isoValue) {
  if (!isoValue) return "bilinmeyen bir zamanda";
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) return isoValue;
  return parsedDate.toLocaleString("tr-TR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function refreshEditorPills() {
  const draft = getCurrentEditorDraft();
  const activeSetPill = document.getElementById("editor-active-set-pill");
  const dirtyPill = document.getElementById("editor-dirty-pill");
  const formatPill = document.getElementById("editor-format-pill");
  const toggleButton = document.getElementById("editor-view-toggle-btn");
  if (!draft) {
    if (activeSetPill) activeSetPill.textContent = "Set: -";
    if (dirtyPill) dirtyPill.textContent = "Durum: Kaydedildi";
    if (formatPill) formatPill.textContent = "Format: -";
    return;
  }
  if (activeSetPill) activeSetPill.textContent = `Set: ${draft.setName}`;
  if (dirtyPill) dirtyPill.textContent = `Durum: ${draft.dirty ? "Kaydedilmedi" : "Kaydedildi"}`;
  if (formatPill) formatPill.textContent = `Format: ${draft.sourceFormat === "markdown" ? "Markdown" : "JSON"}`;
  if (toggleButton) toggleButton.textContent = draft.viewMode === "form" ? "Raw Code" : "Form Görünümü";
}

export function renderEditorTabs() {
  const select = document.getElementById("editor-set-select");
  if (!select) return;
  select.innerHTML = editorState.draftOrder
    .map((setId) => {
      const draft = editorState.drafts[setId];
      return `<option value="${setId}">${escapeMarkup(draft.setName)}${draft.dirty ? " *" : ""}</option>`;
    })
    .join("");
  const fallbackSetId = editorState.draftOrder[0] || "";
  if (!editorState.activeSetId || !editorState.drafts[editorState.activeSetId]) {
    editorState.activeSetId = fallbackSetId || null;
  }
  select.value = editorState.activeSetId || fallbackSetId;
  select.disabled = editorState.draftOrder.length <= 1;
  select.onchange = () => {
    if (!select.value || select.value === editorState.activeSetId) return;
    const currentDraft = getCurrentEditorDraft();
    if (currentDraft) persistCurrentEditorUiState(currentDraft);
    editorState.activeSetId = select.value;
    editorState.focusedField = null;
    renderEditor();
  };
}

function renderEditorToolbarButtons(actions, cardId) {
  return actions
    .map(
      (action) =>
        `<button type="button" class="btn btn-small btn-secondary editor-tool-btn" data-md-action="${action.id}" data-card-id="${cardId}" title="${action.title}" aria-label="${action.title}">${action.label}</button>`,
    )
    .join("");
}

export function renderEditorCardList(draft) {
  const isDeleteSelectionMode = draft.deleteSelectionMode === true;
  const selectedDeleteIds = new Set(draft.deleteSelectionCardIds);
  const selectedCount = draft.deleteSelectionCardIds.length;
  const itemsMarkup = draft.cards.length
    ? draft.cards
        .map((card, index) => {
          const questionPreview = card.question.trim() || "Yeni kart";
          const isActiveCard = draft.activeCardIndex === index;
          const isSelectedForDelete = selectedDeleteIds.has(card.id);
          return `
            <div class="editor-list-row ${isDeleteSelectionMode ? "is-selection-enabled" : ""}">
              ${
                isDeleteSelectionMode
                  ? `<div class="editor-list-check-wrap">
                      <input
                        type="checkbox"
                        class="editor-list-check"
                        data-editor-delete-select="${card.id}"
                        aria-label="Kart ${index + 1} silmek için seç"
                        ${isSelectedForDelete ? "checked" : ""}
                      />
                    </div>`
                  : ""
              }
              <button
                type="button"
                class="editor-list-select ${isActiveCard ? "active" : ""}"
                data-editor-select-card="${card.id}"
                aria-pressed="${isActiveCard}"
              >
                <span class="editor-list-index">Kart ${index + 1}</span>
                <span class="editor-list-question" data-editor-list-question="${card.id}">${escapeMarkup(questionPreview)}</span>
              </button>
            </div>`;
        })
        .join("")
    : `<div class="editor-list-empty">Bu sette henüz kart yok.</div>`;

  return `
    <aside class="editor-list-panel">
      <div class="editor-list-header">
        <div class="editor-list-title">KARTLAR</div>
        <div class="editor-list-actions">
          <button type="button" class="btn btn-small" id="editor-add-card-btn">Kart Ekle</button>
          <button
            type="button"
            class="btn btn-small btn-secondary editor-list-action-toggle ${isDeleteSelectionMode ? "active" : ""}"
            data-editor-toggle-delete-mode
          >
            ${isDeleteSelectionMode ? "Seçimi Kapat" : "Kart Sil"}
          </button>
          ${
            isDeleteSelectionMode
              ? `<button
                  type="button"
                  class="btn btn-small btn-danger"
                  data-editor-delete-selected
                  ${selectedCount ? "" : "disabled"}
                >Seçilileri Sil${selectedCount ? ` (${selectedCount})` : ""}</button>`
              : ""
          }
        </div>
      </div>
      <div class="editor-list-items">
        ${itemsMarkup}
      </div>
    </aside>`;
}

export function renderEditorCardDetail(draft, card, index) {
  const subjectFieldId = `editor-subject-${card.id}`;
  const questionFieldId = `editor-question-${card.id}`;
  const answerFieldId = `editor-answer-${card.id}`;
  const questionHeight = getEditorFieldHeight(draft, "question");
  const answerHeight = getEditorFieldHeight(draft, "answer");
  const previewHeight = getEditorFieldHeight(draft, "preview");
  const splitRatio = getEditorSplitRatio(draft);
  return `
    <section class="editor-card editor-card--detail is-open is-active" data-editor-card-root="${card.id}">
      <div class="editor-card-head">
        <div class="editor-card-head-main">
          <div class="editor-card-title">Kart No ${index + 1}</div>
        </div>
        <div class="editor-card-head-side">
          <label class="status-pill editor-subject-shell" for="${subjectFieldId}">
            <span class="editor-subject-prefix">Konu</span>
            <input
              type="text"
              id="${subjectFieldId}"
              class="editor-subject-input"
              data-editor-subject-input="${card.id}"
              name="editor-subject-${card.id}"
              value="${escapeMarkup(card.subject)}"
              placeholder="Genel"
              spellcheck="false"
              aria-label="Kart konusu"
            />
          </label>
        </div>
      </div>
      <div class="editor-card-body" data-editor-card-body="${card.id}">
        ${renderEditorFormattingToolbar(card.id)}
        <div class="field-group">
          <label for="${questionFieldId}">Soru</label>
          <textarea
            id="${questionFieldId}"
            class="editor-input-question"
            data-editor-field="question"
            data-card-id="${card.id}"
            name="editor-question-${card.id}"
            placeholder="Soruyu yaz..."
            style="height:${questionHeight}px;"
          >${escapeMarkup(card.question)}</textarea>
        </div>
        <div
          class="editor-split"
          data-editor-split="${card.id}"
          style="--editor-answer-fr:${splitRatio}fr; --editor-preview-fr:${100 - splitRatio}fr;"
        >
          <div class="editor-split-pane">
            <div class="field-group">
              <div class="editor-markdown-head">
                <label for="${answerFieldId}">Açıklama (Markdown)</label>
              </div>
              <textarea
                id="${answerFieldId}"
                class="editor-input-answer"
                data-editor-field="answer"
                data-card-id="${card.id}"
                name="editor-answer-${card.id}"
                placeholder="Markdown açıklamasını yaz..."
                style="height:${answerHeight}px;"
              >${escapeMarkup(card.explanationMarkdown)}</textarea>
            </div>
          </div>
          <button
            type="button"
            class="editor-split-handle"
            data-editor-split-handle="${card.id}"
            role="slider"
            aria-label="Açıklama ve önizleme genişliğini ayarla"
            aria-valuemin="${MIN_EDITOR_SPLIT_RATIO}"
            aria-valuemax="${MAX_EDITOR_SPLIT_RATIO}"
            aria-valuenow="${splitRatio}"
            aria-valuetext="Açıklama %${splitRatio}, önizleme %${100 - splitRatio}"
          ></button>
          <div class="editor-split-pane">
            <div class="field-group">
              <div class="editor-preview-head">
                <label>Canlı Önizleme</label>
              </div>
              <div
                class="editor-preview editor-preview-answer"
                data-editor-preview="${card.id}"
                data-editor-height-field="preview"
                style="height:${previewHeight}px;"
              >${renderAnswerMarkdown(card.explanationMarkdown)}</div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
}

export function renderEditorForm(draft) {
  ensureEditorDraftUiState(draft);
  const activeCard = getEditorActiveCard(draft);
  const isListOpen = draft.listPanelOpen !== false;

  return `
    <div class="editor-workspace ${isListOpen ? "is-list-open" : "is-list-closed"}">
      <div class="editor-list-sidebar">
        <button
          type="button"
          class="editor-list-handle"
          data-editor-toggle-list
          aria-expanded="${isListOpen}"
          aria-label="${isListOpen ? "Kart listesini kapat" : "Kart listesini aç"}"
          title="${isListOpen ? "Kart listesini kapat" : "Kart listesini aç"}"
        >
          <span class="editor-list-handle-icon">${isListOpen ? "←" : "→"}</span>
          <span class="editor-list-handle-text">${isListOpen ? "Listeyi Daralt" : "Kartlar"}</span>
        </button>
        <div class="editor-list-drawer">
          ${renderEditorCardList(draft)}
        </div>
      </div>
      <div class="editor-detail-panel">
        ${
          activeCard
            ? renderEditorCardDetail(draft, activeCard, draft.activeCardIndex)
            : `<div class="editor-empty-state">Kart ekleyerek düzenlemeye başlayabilirsin.</div>`
        }
      </div>
    </div>`;
}

const renderEditorRaw = (draft) => {
  const rawEditorState = ensureEditorRawState(draft.rawEditorState);
  const rawHeightStyle = Number.isFinite(rawEditorState.height) ? ` style="height:${rawEditorState.height}px;"` : "";
  return `<div class="field-group"><label for="editor-raw-input">Raw Code</label><textarea id="editor-raw-input" name="editor-raw-input" class="editor-raw" spellcheck="false"${rawHeightStyle}>${draft.rawSource}</textarea></div>`;
};

export function flushEditorPendingScroll() {
  if (!editorState.pendingScrollCardId) return;
  const targetCard = document.querySelector(`[data-editor-card-root="${editorState.pendingScrollCardId}"]`);
  editorState.pendingScrollCardId = null;
  if (!targetCard) return;
  targetCard.scrollIntoView({ block: "nearest", behavior: "auto" });
}

export function flushEditorFocusedField() {
  const { getFocusedEditorFieldElement, saveEditorFieldHeight } = require_editor_events_sync();
  const targetField = getFocusedEditorFieldElement({ restoreSelection: true });
  if (!targetField) return;
  saveEditorFieldHeight(getCurrentEditorDraft(), targetField);
}

export function renderEditor() {
  stopEditorSplitDrag();
  const previousDraft = getCurrentEditorDraft();
  if (previousDraft) {
    persistCurrentEditorUiState(previousDraft);
  }
  renderEditorTabs();
  refreshEditorPills();
  showEditorStatus("", "");
  const panel = document.getElementById("editor-panel");
  const draft = getCurrentEditorDraft();
  if (!panel || !draft) {
    if (panel) panel.innerHTML = "";
    return;
  }
  ensureEditorDraftUiState(draft);
  panel.className = `editor-panel ${draft.viewMode === "form" ? "editor-panel--form" : "editor-panel--raw"}`;
  panel.innerHTML = draft.viewMode === "form" ? renderEditorForm(draft) : renderEditorRaw(draft);
  bindEditorEvents(draft);
  flushEditorPendingScroll();
  flushEditorFocusedField();
  restoreRawEditorState(draft);
}

// Synchronous accessor for editor-events functions (already imported above)
function require_editor_events_sync() {
  return {
    getFocusedEditorFieldElement,
    saveEditorFieldHeight,
  };
}

// Re-export needed from editor-events that are used in this file
import { getFocusedEditorFieldElement, saveEditorFieldHeight } from "./editor-events.js";
