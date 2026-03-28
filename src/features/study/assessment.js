// src/features/study/assessment.js
// Card assessment logic: keys, levels, UI updates, progress reset, cleanup.

import {
  assessments, setAssessments,
  allFlashcards,
  filteredFlashcards,
  cardOrder,
  currentCardIndex,
  autoAdvanceEnabled,
  activeFilter, setActiveFilter,
} from "../../app/state.js";

// ── advance callback (set by study.js to avoid circular import) ──
let _nextCardFn = null;
export function setAssessmentAdvanceCallback(fn) { _nextCardFn = fn; }

export function buildCardKey(setId, card, index) {
  const normalizedSetId = String(setId ?? "unknown");
  const cardIdValue = card?.id != null ? String(card.id).trim() : "";
  return cardIdValue ? `set:${normalizedSetId}::id:${cardIdValue}` : `set:${normalizedSetId}::idx:${index}`;
}

export function legacyCardId(cardOrQuestion) {
  const question = typeof cardOrQuestion === "string" ? cardOrQuestion : typeof cardOrQuestion?.q === "string" ? cardOrQuestion.q : "";
  let hash = 0;
  for (let index = 0; index < question.length; index += 1) {
    hash = ((hash << 5) - hash + question.charCodeAt(index)) | 0;
  }
  return `c${Math.abs(hash)}`;
}

export function getCardKey(card, fallbackSetId, fallbackIndex) {
  if (card?.__cardKey) return card.__cardKey;
  if (typeof fallbackSetId === "string" && Number.isInteger(fallbackIndex)) {
    return buildCardKey(fallbackSetId, card, fallbackIndex);
  }
  if (typeof card?.__setId === "string" && Number.isInteger(card?.__setIndex)) {
    return buildCardKey(card.__setId, card, card.__setIndex);
  }
  return null;
}

export function getAssessmentLevel(card, fallbackSetId, fallbackIndex) {
  const cardKey = getCardKey(card, fallbackSetId, fallbackIndex);
  if (cardKey && assessments[cardKey]) return assessments[cardKey];
  return assessments[legacyCardId(card)] || null;
}

export function updateAssessmentButtons(level) {
  document.querySelectorAll(".assess-btn").forEach((button) => button.classList.remove("selected"));
  if (!level) return;
  document.querySelectorAll(`.assess-btn.${level}`).forEach((button) => button.classList.add("selected"));
}

export function showAssessmentPanel(isVisible) {
  const panel = document.getElementById("assessment-panel");
  const fullscreenPanel = document.querySelector(".fullscreen-assessment-panel");
  if (isVisible) {
    panel?.classList.add("visible");
    if (fullscreenPanel) fullscreenPanel.style.display = "flex";
  } else {
    panel?.classList.remove("visible");
    if (fullscreenPanel) fullscreenPanel.style.display = "none";
  }
}

export function updateScoreDisplay() {
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
  document.getElementById("score-know").textContent = know;
  document.getElementById("score-review").textContent = review;
  document.getElementById("score-dunno").textContent = dunno;
  document.getElementById("score-percent").textContent = `${assessed}/${total} (%${percentage})`;
  document.getElementById("progress-fill-know").style.width = `${total ? (know / total) * 100 : 0}%`;
  document.getElementById("progress-fill-review").style.width = `${total ? (review / total) * 100 : 0}%`;
  document.getElementById("progress-fill-dunno").style.width = `${total ? (dunno / total) * 100 : 0}%`;
}

export function assessCard(level) {
  if (!filteredFlashcards.length) return;
  const card = filteredFlashcards[cardOrder[currentCardIndex]];
  const cardKey = getCardKey(card);
  const currentLevel = getAssessmentLevel(card);
  if (cardKey && currentLevel === level) {
    delete assessments[cardKey];
    delete assessments[legacyCardId(card)];
    updateAssessmentButtons(null);
    updateScoreDisplay();
    // saveStudyState called via dynamic import to avoid circular
    import("../study-state/study-state.js").then(({ saveStudyState }) => saveStudyState());
    return;
  }
  if (cardKey) assessments[cardKey] = level;
  updateAssessmentButtons(level);
  updateScoreDisplay();
  import("../study-state/study-state.js").then(({ saveStudyState }) => saveStudyState());
  if (autoAdvanceEnabled) {
    setTimeout(() => {
      if (currentCardIndex < filteredFlashcards.length - 1 && typeof _nextCardFn === "function") {
        _nextCardFn();
      }
    }, 400);
  }
}

export function resetProgress() {
  if (!confirm("Seçili set(ler)deki tüm ilerlemen sıfırlanacak. Emin misin?")) return;
  allFlashcards.forEach((card) => {
    const cardKey = getCardKey(card);
    if (cardKey) delete assessments[cardKey];
    delete assessments[legacyCardId(card)];
  });
  setAssessments(assessments);
  setActiveFilter("all");
  import("../study/study.js").then(({ applyAssessmentFilter }) => {
    applyAssessmentFilter();
    import("../study-state/study-state.js").then(({ saveStudyState }) => saveStudyState());
  });
}

export function cleanupAssessmentsForSet(nextRecord, previousRecord) {
  const allowedKeys = new Set(nextRecord.cards.map((card, index) => buildCardKey(nextRecord.id, card, index)));
  Object.keys(assessments).forEach((key) => {
    if (key.startsWith(`set:${nextRecord.id}::`) && !allowedKeys.has(key)) delete assessments[key];
  });
  previousRecord?.cards?.forEach((card) => delete assessments[legacyCardId(card)]);
}
