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
  activeFilter, setActiveFilter,
  autoAdvanceEnabled, setAutoAdvanceEnabled,
  editorState,
} from "../../app/state.js";
import {
  buildCardKey,
  getCardKey,
  getAssessmentLevel,
  updateAssessmentButtons,
  showAssessmentPanel,
  updateScoreDisplay,
  setAssessmentAdvanceCallback,
} from "./assessment.js";
import { renderAnswerMarkdown } from "../../core/set-codec.js";
import { showScreen } from "../../app/screen.js";
import { saveStudyState, getPersistedStudyStateSnapshot } from "../study-state/study-state.js";

// Register nextCard as the advance callback to break the circular import
// (assessment.js needs nextCard but cannot import from study.js)
setAssessmentAdvanceCallback(() => nextCard());

export function syncAutoAdvanceToggleUI() {
  const toggle = document.getElementById("auto-advance-toggle-manager");
  const status = document.getElementById("auto-advance-status");
  if (toggle) toggle.checked = autoAdvanceEnabled;
  if (status) status.textContent = autoAdvanceEnabled ? "OTOMATİK İLERLE ✓" : "OTOMATİK İLERLE ✕";
}

export function displayCard() {
  if (!filteredFlashcards.length) return;
  const card = filteredFlashcards[cardOrder[currentCardIndex]];
  document.getElementById("question-text").innerHTML = renderAnswerMarkdown(card.q);
  document.getElementById("answer-text").innerHTML = card.a;
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
  document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));
  const labels = { all: "📋 Tümü", know: "✅ Biliyorum", review: "🔄 Tekrar Göz At", dunno: "❌ Bilmiyorum", unanswered: "⬜ Değerlendirilmemiş" };
  document.querySelectorAll(".filter-btn").forEach((button) => {
    if (button.textContent.trim() === labels[activeFilter]) button.classList.add("active");
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
  const statusIcons = { know: "✅", review: "🔄", dunno: "❌" };
  const cardsMarkup = allFlashcards.map((card, index) => {
    const status = getAssessmentLevel(card);
    const badge = status ? `<span style="float:right;font-size:18px">${statusIcons[status]}</span>` : "";
    return `<div style="page-break-inside:avoid; border:1px solid #ddd; border-radius:10px; padding:20px 24px; margin-bottom:16px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-weight:700; color:#2f7a56; font-size:14px;">Kart ${index + 1} — ${card.subject}</span>${badge}
      </div>
      <div style="font-size:15px; font-weight:600; margin-bottom:12px; color:#21302a;">${renderAnswerMarkdown(card.q)}</div>
      <div style="font-size:14px; line-height:1.7; color:#333; border-top:1px solid #eee; padding-top:12px;">${card.a}</div>
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
  popup.document.write(`<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8"><title>Flashcards — Yazdır</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:30px 20px;color:#21302a}h1{font-size:22px;margin-bottom:4px}.summary{font-size:14px;color:#5f6d66;margin-bottom:20px;padding-bottom:15px;border-bottom:2px solid #2f7a56}@media print{body{padding:10px}}</style></head><body><h1>Flashcards</h1><div class="summary">Toplam: ${total} kart | ✅ ${know} | 🔄 ${review} | ❌ ${dunno} | İlerleme: %${percentage}</div>${cardsMarkup}</body></html>`);
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
      fullscreenToggleButton.textContent = "✕";
      fullscreenToggleButton.title = "Tam ekrandan çık (ESC / F)";
    }
  } else {
    container.classList.remove("fullscreen-active");
    document.body.style.overflow = "auto";
    if (fullscreenToggleButton) {
      fullscreenToggleButton.textContent = "⛶";
      fullscreenToggleButton.title = "Tam ekran (F)";
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
