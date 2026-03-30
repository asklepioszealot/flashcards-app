// src/features/study/study.js
// Study session management: card display, filtering, navigation, fullscreen, etc.

import {
  allFlashcards, setAllFlashcards,
  filteredFlashcards, setFilteredFlashcards,
  cardOrder, setCardOrder,
  currentCardIndex, setCurrentCardIndex,
  isFlipped, setIsFlipped,
  isFullscreen, setIsFullscreen,
  selectedSets,
  loadedSets,
  reviewSchedule,
  activeFilter, setActiveFilter,
  autoAdvanceEnabled, setAutoAdvanceEnabled,
  cardContentPreferences, setCardContentPreferences,
  editorState,
} from "../../app/state.js";
import { MIN_CARD_CONTENT_FONT_SIZE, MAX_CARD_CONTENT_FONT_SIZE } from "../../shared/constants.js";
import {
  buildCardKey,
  getCardKey,
  getAssessmentLevel,
  getReviewScheduleEntry,
  updateAssessmentButtons,
  showAssessmentPanel,
  updateScoreDisplay,
  setAssessmentAdvanceCallback,
} from "./assessment.js";
import { renderAnswerMarkdown } from "../../core/set-codec.js";
import { sanitizeMarkdownHtml } from "../../core/security.js";
import { showScreen } from "../../app/screen.js";
import { saveStudyState, getPersistedStudyStateSnapshot } from "../study-state/study-state.js";
import { escapeMarkup, normalizeCardContentPreferences } from "../../shared/utils.js";
import { formatRelativeReviewLabel, getReviewUrgency, summarizeReviewSchedule } from "./scheduler.js";
import { renderIcon, setButtonIcon } from "../../ui/icons.js";

// Register nextCard as the advance callback to break the circular import
// (assessment.js needs nextCard but cannot import from study.js)
setAssessmentAdvanceCallback(() => nextCard());

const CARD_CONTENT_SETTINGS_PANEL_ID = "card-content-settings-panel";
const CARD_CONTENT_SETTINGS_TOGGLE_ID = "card-content-settings-toggle-btn";
const CARD_CONTENT_FRONT_INPUT_ID = "card-content-front-font-size";
const CARD_CONTENT_BACK_INPUT_ID = "card-content-back-font-size";

function getCardContentSettingsElements() {
  return {
    panel: document.getElementById(CARD_CONTENT_SETTINGS_PANEL_ID),
    toggleButton: document.getElementById(CARD_CONTENT_SETTINGS_TOGGLE_ID),
    frontInput: document.getElementById(CARD_CONTENT_FRONT_INPUT_ID),
    backInput: document.getElementById(CARD_CONTENT_BACK_INPUT_ID),
  };
}

function syncCardContentSettingsToggleUi(toggleButton, visible) {
  if (!toggleButton) return;
  toggleButton.setAttribute("aria-expanded", visible ? "true" : "false");
  toggleButton.setAttribute("aria-label", visible ? "Kart font ayarlarını kapat" : "Kart font ayarlarını aç");
  toggleButton.classList.toggle("is-active", visible);
  toggleButton.title = visible ? "Kart font ayarlarını kapat" : "Kart font ayarlarını aç";
}

export function syncAutoAdvanceToggleUI() {
  const toggle = document.getElementById("auto-advance-toggle-manager");
  const status = document.getElementById("auto-advance-status");
  if (toggle) toggle.checked = autoAdvanceEnabled;
  if (status) {
    status.innerHTML = `${renderIcon(autoAdvanceEnabled ? "check-circle" : "x-circle")}<span>OTOMATİK İLERLE</span>`;
    status.setAttribute("aria-label", autoAdvanceEnabled ? "Otomatik ilerle açık" : "Otomatik ilerle kapalı");
    status.dataset.state = autoAdvanceEnabled ? "enabled" : "disabled";
  }
}

export function applyCardContentPreferencesUi() {
  document.documentElement.style.setProperty("--card-content-font-front", `${cardContentPreferences.frontFontSize}px`);
  document.documentElement.style.setProperty("--card-content-font-back", `${cardContentPreferences.backFontSize}px`);
}

export function syncCardContentPreferencesUi() {
  const { frontInput, backInput } = getCardContentSettingsElements();
  if (frontInput) frontInput.value = String(cardContentPreferences.frontFontSize);
  if (backInput) backInput.value = String(cardContentPreferences.backFontSize);
  if (frontInput) {
    frontInput.min = String(MIN_CARD_CONTENT_FONT_SIZE);
    frontInput.max = String(MAX_CARD_CONTENT_FONT_SIZE);
  }
  if (backInput) {
    backInput.min = String(MIN_CARD_CONTENT_FONT_SIZE);
    backInput.max = String(MAX_CARD_CONTENT_FONT_SIZE);
  }
  applyCardContentPreferencesUi();
}

export function setCardContentSettingsVisibility(isVisible) {
  const { panel, toggleButton } = getCardContentSettingsElements();
  if (panel) panel.hidden = !isVisible;
  syncCardContentSettingsToggleUi(toggleButton, isVisible);
  if (isVisible) syncCardContentPreferencesUi();
}

export function toggleCardContentSettingsPanel() {
  const { panel } = getCardContentSettingsElements();
  setCardContentSettingsVisibility(panel?.hidden !== false);
}

export function closeCardContentSettingsPanel() {
  setCardContentSettingsVisibility(false);
}

export function updateCardContentFontSize(fieldName, rawValue, options = {}) {
  const key = fieldName === "back" ? "backFontSize" : "frontFontSize";
  const shouldResync = options.resync !== false;
  const parsedValue = Number.parseInt(String(rawValue ?? "").trim(), 10);
  if (!Number.isFinite(parsedValue)) {
    if (shouldResync) syncCardContentPreferencesUi();
    return cardContentPreferences;
  }

  const nextPreferences = normalizeCardContentPreferences({
    ...cardContentPreferences,
    [key]: parsedValue,
  });
  setCardContentPreferences(nextPreferences);
  if (shouldResync) syncCardContentPreferencesUi();
  else applyCardContentPreferencesUi();
  if (options.persist !== false) saveStudyState();
  return nextPreferences;
}

function getStudyCardKeys() {
  return allFlashcards
    .map((card) => getCardKey(card))
    .filter((cardKey) => typeof cardKey === "string" && cardKey.trim());
}

export function syncReviewScheduleUi() {
  const summaryElement = document.getElementById("review-due-summary");
  const currentCardElement = document.getElementById("review-current-card");
  const summary = summarizeReviewSchedule(getStudyCardKeys(), reviewSchedule);

  if (summaryElement) {
    summaryElement.textContent = `Tekrar Planı: ${summary.dueCount} bugün · ${summary.upcomingCount} yakında · ${summary.newCount} yeni`;
    summaryElement.dataset.state = summary.dueCount > 0
      ? "due"
      : summary.upcomingCount > 0
        ? "upcoming"
        : summary.newCount > 0
          ? "new"
          : "scheduled";
  }

  if (!currentCardElement) return;
  if (!filteredFlashcards.length) {
    currentCardElement.textContent = "Bu kart: planlı tekrar yok";
    currentCardElement.dataset.state = "empty";
    return;
  }

  const currentCard = filteredFlashcards[cardOrder[currentCardIndex]];
  const entry = getReviewScheduleEntry(currentCard);
  currentCardElement.textContent = `Bu kart: ${formatRelativeReviewLabel(entry)}`;
  currentCardElement.dataset.state = getReviewUrgency(entry);
}

export function displayCard() {
  if (!filteredFlashcards.length) return;
  const card = filteredFlashcards[cardOrder[currentCardIndex]];
  document.getElementById("question-text").innerHTML = renderAnswerMarkdown(card.q);
  document.getElementById("answer-text").innerHTML = sanitizeMarkdownHtml(card.a || "");
  document.getElementById("card-counter").textContent = `${currentCardIndex + 1} / ${filteredFlashcards.length}`;
  document.getElementById("fullscreen-card-counter").textContent = `${currentCardIndex + 1} / ${filteredFlashcards.length}`;
  document.getElementById("subject-display-front").textContent = card.subject;
  document.getElementById("prev-btn").disabled = currentCardIndex === 0;
  document.getElementById("next-btn").disabled = currentCardIndex === filteredFlashcards.length - 1;
  if (isFlipped) {
    document.getElementById("flashcard").classList.remove("flipped");
    setIsFlipped(false);
  }
  showAssessmentPanel(false);
  updateAssessmentButtons(getAssessmentLevel(card) || null);
  syncReviewScheduleUi();
  saveStudyState();
}

export const previousCard = () => {
  if (currentCardIndex > 0) {
    setCurrentCardIndex(currentCardIndex - 1);
    displayCard();
  }
};

export const nextCard = () => {
  if (currentCardIndex < filteredFlashcards.length - 1) {
    setCurrentCardIndex(currentCardIndex + 1);
    displayCard();
  }
};

export function populateTopicFilter() {
  const select = document.getElementById("topic-select");
  if (!select) return;
  const subjects = [...new Set(allFlashcards.map((card) => card.subject))].sort((leftValue, rightValue) => leftValue.localeCompare(rightValue, "tr"));
  select.innerHTML = '<option value="hepsi">Tüm Başlıklar</option>';
  subjects.forEach((subject) => {
    const option = document.createElement("option");
    option.value = subject;
    option.textContent = subject;
    select.appendChild(option);
  });
}

export function applyAssessmentFilter(options = {}) {
  const preferredCardKey = typeof options.preferredCardKey === "string" ? options.preferredCardKey : null;
  const fallbackIndex = Number.isInteger(options.fallbackIndex) ? options.fallbackIndex : null;
  document.querySelectorAll(".filter-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.filterValue === activeFilter);
  });
  const selectedTopic = document.getElementById("topic-select").value;
  const baseCards = selectedTopic === "hepsi" ? [...allFlashcards] : allFlashcards.filter((card) => card.subject === selectedTopic);
  let newFiltered;
  if (activeFilter === "know") newFiltered = baseCards.filter((card) => getAssessmentLevel(card) === "know");
  else if (activeFilter === "review") newFiltered = baseCards.filter((card) => getAssessmentLevel(card) === "review");
  else if (activeFilter === "dunno") newFiltered = baseCards.filter((card) => getAssessmentLevel(card) === "dunno");
  else if (activeFilter === "unanswered") newFiltered = baseCards.filter((card) => !getAssessmentLevel(card));
  else newFiltered = baseCards;
  setFilteredFlashcards(newFiltered);
  setCardOrder([...Array(filteredFlashcards.length).keys()]);
  let targetIndex = 0;
  if (filteredFlashcards.length > 0) {
    let resolvedIndex = -1;
    if (preferredCardKey) resolvedIndex = filteredFlashcards.findIndex((card) => getCardKey(card) === preferredCardKey);
    if (resolvedIndex < 0 && Number.isInteger(fallbackIndex) && fallbackIndex >= 0 && fallbackIndex < filteredFlashcards.length) resolvedIndex = fallbackIndex;
    targetIndex = resolvedIndex >= 0 ? resolvedIndex : 0;
  }
  setCurrentCardIndex(targetIndex);
  document.getElementById("jump-input").setAttribute("max", String(filteredFlashcards.length));
  if (filteredFlashcards.length > 0) displayCard();
  else {
    document.getElementById("question-text").textContent = "Bu kategoride kart yok.";
    document.getElementById("answer-text").innerHTML = "";
    document.getElementById("card-counter").textContent = "0 / 0";
    document.getElementById("fullscreen-card-counter").textContent = "0 / 0";
    document.getElementById("subject-display-front").textContent = "";
    showAssessmentPanel(false);
    syncReviewScheduleUi();
  }
  updateScoreDisplay();
}

export function setFilter(filter) {
  const currentCard = filteredFlashcards.length > 0 ? filteredFlashcards[cardOrder[currentCardIndex]] : null;
  setActiveFilter(filter);
  applyAssessmentFilter({
    preferredCardKey: currentCard ? getCardKey(currentCard) : null,
    fallbackIndex: currentCardIndex,
  });
  saveStudyState();
}

export function filterByTopic(resetFilter = true, options = {}) {
  if (resetFilter) setActiveFilter("all");
  applyAssessmentFilter(options);
}

export function startStudy() {
  if (!selectedSets.size) return;
  const newAllFlashcards = [];
  selectedSets.forEach((setId) => {
    const setRecord = loadedSets[setId];
    if (!Array.isArray(setRecord?.cards)) return;
    setRecord.cards.forEach((card, index) => {
      newAllFlashcards.push({ ...card, __setId: setId, __setIndex: index, __cardKey: buildCardKey(setId, card, index) });
    });
  });
  setAllFlashcards(newAllFlashcards);
  setFilteredFlashcards([...allFlashcards]);
  setCardOrder([...Array(filteredFlashcards.length).keys()]);
  setCurrentCardIndex(0);
  populateTopicFilter();

  const snapshot = getPersistedStudyStateSnapshot();
  const session = snapshot?.session && typeof snapshot.session === "object" ? snapshot.session : null;
  if (session?.topic && document.getElementById("topic-select")) {
    document.getElementById("topic-select").value = session.topic;
  }
  setActiveFilter(session?.activeFilter || "all");
  showScreen("study");
  filterByTopic(false, {
    preferredCardKey: typeof session?.currentCardKey === "string" ? session.currentCardKey : null,
    fallbackIndex: Number.isInteger(session?.currentCardIndex) ? session.currentCardIndex : null,
  });
}

export function flipCard() {
  document.getElementById("flashcard").classList.toggle("flipped");
  setIsFlipped(!isFlipped);
  showAssessmentPanel(isFlipped);
}

export function jumpToCard() {
  const input = document.getElementById("jump-input");
  const cardNumber = Number.parseInt(input.value, 10);
  if (cardNumber >= 1 && cardNumber <= filteredFlashcards.length) {
    setCurrentCardIndex(cardNumber - 1);
    displayCard();
    input.value = "";
    return;
  }
  alert(`Lütfen 1 ile ${filteredFlashcards.length} arasında bir sayı gir.`);
}

export function shuffleCards() {
  if (!filteredFlashcards.length) return;
  const newCardOrder = [...cardOrder];
  for (let index = newCardOrder.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [newCardOrder[index], newCardOrder[swapIndex]] = [newCardOrder[swapIndex], newCardOrder[index]];
  }
  setCardOrder(newCardOrder);
  setCurrentCardIndex(0);
  displayCard();
}

export function printCards() {
  const statusLabels = { know: "Tamam", review: "Tekrar", dunno: "Bilmiyorum" };
  const cardsMarkup = allFlashcards.map((card, index) => {
    const status = getAssessmentLevel(card);
    const badge = status
      ? `<span style="display:inline-flex; align-items:center; padding:4px 10px; border-radius:999px; background:#e2f7ef; color:#116149; font-size:12px; font-weight:700;">${escapeMarkup(statusLabels[status])}</span>`
      : "";
    return `<div style="page-break-inside:avoid; border:1px solid #ddd; border-radius:10px; padding:20px 24px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; color:#2f7a56; font-size:14px;">Kart ${index + 1} — ${escapeMarkup(card.subject)}</span>${badge}
      </div>
      <div style="font-size:15px; font-weight:600; margin-bottom:12px; color:#21302a;">${renderAnswerMarkdown(card.q)}</div>
      <div style="font-size:14px; line-height:1.7; color:#333; border-top:1px solid #eee; padding-top:12px;">${sanitizeMarkdownHtml(card.a || "")}</div>
    </div>`;
  }).join("");
  let know = 0;
  let review = 0;
  let dunno = 0;
  allFlashcards.forEach((card) => {
    const status = getAssessmentLevel(card);
    if (status === "know") know += 1;
    else if (status === "review") review += 1;
    else if (status === "dunno") dunno += 1;
  });
  const total = allFlashcards.length;
  const assessed = know + review + dunno;
  const percentage = total ? Math.round((assessed / total) * 100) : 0;
  const popup = window.open("", "_blank");
  popup.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Flashcards — Yazdır</title><style>body{font-family:'Noto Sans','Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:30px 20px;color:#21302a}h1{font-family:'Figtree','Segoe UI',sans-serif;font-size:22px;margin-bottom:4px}.summary{font-size:14px;color:#5f6d66;margin-bottom:20px;padding-bottom:15px;border-bottom:2px solid #2f7a56}@media print{body{padding:10px}}</style></head><body><h1>Flashcards</h1><div class="summary">Toplam: ${total} kart | Tamam: ${know} | Tekrar: ${review} | Bilmiyorum: ${dunno} | İlerleme: %${percentage}</div>${cardsMarkup}</body></html>`);
  popup.document.close();
  popup.onload = () => popup.print();
}

export function toggleFullscreen() {
  setIsFullscreen(!isFullscreen);
  const container = document.querySelector(".card-container");
  if (!container) return;
  const fullscreenToggleButton = document.getElementById("fullscreen-toggle-btn");
  if (isFullscreen) {
    container.classList.add("fullscreen-active");
    document.body.style.overflow = "hidden";
    if (fullscreenToggleButton) {
      setButtonIcon(fullscreenToggleButton, "minimize", {
        label: "Tam ekrandan çık",
        title: "Tam ekrandan çık (ESC / F)",
      });
    }
  } else {
    container.classList.remove("fullscreen-active");
    document.body.style.overflow = "auto";
    if (fullscreenToggleButton) {
      setButtonIcon(fullscreenToggleButton, "maximize", {
        label: "Tam ekranı aç",
        title: "Tam ekran (F)",
      });
    }
  }
  fullscreenToggleButton?.blur();
}

export function setAutoAdvance(isEnabled) {
  setAutoAdvanceEnabled(Boolean(isEnabled));
  syncAutoAdvanceToggleUI();
  saveStudyState();
}

export function showSetManager() {
  import("../editor/editor-state.js").then(({ confirmLeaveEditor, closeEditor }) => {
    if (editorState.isOpen && !confirmLeaveEditor()) return;
    closeEditor(true);
    if (isFullscreen) toggleFullscreen();
    import("../set-manager/set-manager.js").then(({ renderSetList }) => {
      renderSetList();
      showScreen("manager");
    });
  });
}

// ---- Export Modal Functions ----

export function openExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'block';
  toggleExportWarning();
}

export function closeExportModal() {
  const modal = document.getElementById('export-modal');
  if (modal) modal.style.display = 'none';
}

export function toggleExportWarning() {
  const format = document.getElementById('export-format')?.value;
  const warning = document.getElementById('export-warning');
  if (warning) {
    warning.style.display = format === 'apkg' ? 'block' : 'none';
  }
}

export async function executeExport() {
  const scope = document.getElementById('export-scope')?.value || 'all';
  const format = document.getElementById('export-format')?.value || 'print';
  const errorEl = document.getElementById('export-error');
  const btn = document.getElementById('export-submit-btn');
  
  if (errorEl) errorEl.style.display = 'none';
  
  let cardsToExport = [];
  if (scope === 'filtered') {
    cardsToExport = filteredFlashcards;
  } else {
    cardsToExport = allFlashcards;
  }
  
  if (!cardsToExport || cardsToExport.length === 0) {
    if (errorEl) {
      errorEl.textContent = 'Dışa aktarılacak kart bulunamadı.';
      errorEl.style.display = 'block';
    }
    return;
  }

  try {
    if (btn) btn.disabled = true;

    if (format === 'print') {
      printCards();
      closeExportModal();
    } else if (format === 'apkg' || format === 'csv' || format === 'markdown' || format === 'html') {
      const btnOriginalText = btn.textContent;
      btn.textContent = "Hazırlanıyor...";
      try {
        const { generateApkg, generateCsv, generateMarkdown, generateHtml, downloadBlob } = await import('./study-export.js');
        let blob;
        let ext = format;
        if (format === 'apkg') blob = await generateApkg(cardsToExport);
        else if (format === 'csv') blob = generateCsv(cardsToExport);
        else if (format === 'markdown') { blob = generateMarkdown(cardsToExport); ext = 'md'; }
        else if (format === 'html') blob = generateHtml(cardsToExport);
        
        const filename = `flashcards_export_${new Date().toISOString().split('T')[0]}.${ext}`;
        downloadBlob(blob, filename);
        closeExportModal();
      } finally {
        btn.textContent = btnOriginalText;
      }
    } else {
      if (errorEl) {
        errorEl.textContent = 'Bu format şu an aktif değil, sonraki aşamada eklenecektir.';
        errorEl.style.display = 'block';
      }
    }
  } catch (err) {
    console.error("Export error:", err);
    if (errorEl) {
      errorEl.textContent = err.message || 'Dışa aktarma sırasında bir hata oluştu.';
      errorEl.style.display = 'block';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}
