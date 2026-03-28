import {
  loadedSets,
  selectedSets,
  assessments,
  reviewSchedule,
  isAnalyticsVisible,
  setIsAnalyticsVisible,
} from "../../app/state.js";
import { buildCardKey, getCardKey, legacyCardId } from "../study/assessment.js";
import { getReviewUrgency } from "../study/scheduler.js";

const RETENTION_TARGET = 85;
const MANAGER_DASHBOARD_ID = "analytics-dashboard-manager";
const MANAGER_GRID_ID = "analytics-grid-manager";
const MANAGER_SUMMARY_ID = "analytics-summary-manager";
const MANAGER_TOGGLE_ID = "analytics-toggle-btn";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatDayLabel(date) {
  return date.toLocaleDateString("tr-TR", { weekday: "short" });
}

function resolveAssessmentLevel(card, cardKey, assessmentsMap) {
  if (cardKey && assessmentsMap[cardKey]) return assessmentsMap[cardKey];
  return assessmentsMap[legacyCardId(card)] || null;
}

function buildLoadedSetCards() {
  const preferredSetIds = [...selectedSets].filter((setId) => loadedSets[setId]);
  const sourceSetIds = preferredSetIds.length ? preferredSetIds : Object.keys(loadedSets);
  const flattenedCards = [];

  sourceSetIds.forEach((setId) => {
    const setRecord = loadedSets[setId];
    if (!Array.isArray(setRecord?.cards)) return;

    setRecord.cards.forEach((card, index) => {
      flattenedCards.push({
        ...card,
        __setId: setId,
        __setIndex: index,
        __cardKey: buildCardKey(setId, card, index),
      });
    });
  });

  return flattenedCards;
}

function resolveAnalyticsCards() {
  return buildLoadedSetCards();
}

function getAnalyticsElements() {
  return {
    dashboard:
      document.getElementById(MANAGER_DASHBOARD_ID)
      || document.getElementById("analytics-dashboard"),
    summary:
      document.getElementById(MANAGER_SUMMARY_ID)
      || document.getElementById("analytics-summary"),
    grid:
      document.getElementById(MANAGER_GRID_ID)
      || document.getElementById("analytics-grid"),
    toggleButton: document.getElementById(MANAGER_TOGGLE_ID),
  };
}

function syncAnalyticsToggleUi(toggleButton, visible) {
  if (!toggleButton) return;
  toggleButton.setAttribute("aria-expanded", visible ? "true" : "false");
  toggleButton.setAttribute("title", visible ? "Analytics panelini gizle" : "Analytics panelini göster");
  toggleButton.classList.toggle("is-active", visible);
}

function buildDailyBuckets(nowDate) {
  const buckets = [];
  const today = new Date(nowDate);
  today.setHours(0, 0, 0, 0);

  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    buckets.push({
      key: date.toISOString().slice(0, 10),
      label: formatDayLabel(date),
      count: 0,
    });
  }

  return buckets;
}

export function buildAnalyticsSnapshot(cards = [], assessmentsMap = {}, reviewScheduleMap = {}, now = new Date()) {
  const safeNow = now instanceof Date ? now : new Date(now);
  const cardEntries = cards
    .map((card) => ({ card, cardKey: getCardKey(card) }))
    .filter((entry) => entry.card);

  const successCounts = { know: 0, review: 0, dunno: 0 };
  cardEntries.forEach(({ card, cardKey }) => {
    const level = resolveAssessmentLevel(card, cardKey, assessmentsMap);
    if (level && successCounts[level] !== undefined) {
      successCounts[level] += 1;
    }
  });

  const assessedCount = successCounts.know + successCounts.review + successCounts.dunno;
  const successRate = assessedCount ? Math.round((successCounts.know / assessedCount) * 100) : 0;

  const dailyBuckets = buildDailyBuckets(safeNow);
  const bucketByKey = Object.fromEntries(dailyBuckets.map((bucket) => [bucket.key, bucket]));
  cardEntries.forEach(({ cardKey }) => {
    if (!cardKey) return;
    const entry = reviewScheduleMap[cardKey];
    const reviewedAt = String(entry?.lastReviewedAt || "").slice(0, 10);
    if (bucketByKey[reviewedAt]) {
      bucketByKey[reviewedAt].count += 1;
    }
  });

  const trackedEntries = cardEntries
    .map(({ cardKey }) => (cardKey ? reviewScheduleMap[cardKey] || null : null))
    .filter(Boolean);
  const dueCount = trackedEntries.filter((entry) => getReviewUrgency(entry, safeNow) === "due").length;
  const stableCount = trackedEntries.length - dueCount;
  const retentionRate = trackedEntries.length ? Math.round((stableCount / trackedEntries.length) * 100) : 0;

  return {
    totalCards: cardEntries.length,
    assessedCount,
    successCounts,
    successRate,
    dailyActivity: dailyBuckets,
    retention: {
      rate: retentionRate,
      target: RETENTION_TARGET,
      trackedCount: trackedEntries.length,
      dueCount,
      stableCount,
    },
  };
}

function renderDailyActivityChart(points) {
  const width = 280;
  const height = 120;
  const padding = 18;
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  const stepX = points.length > 1 ? (width - padding * 2) / (points.length - 1) : 0;

  const coordinates = points.map((point, index) => {
    const x = padding + stepX * index;
    const y = height - padding - ((point.count / maxValue) * (height - padding * 2));
    return { ...point, x, y };
  });

  const linePoints = coordinates.map((point) => `${point.x},${point.y}`).join(" ");
  const areaPoints = [`${padding},${height - padding}`, ...coordinates.map((point) => `${point.x},${point.y}`), `${width - padding},${height - padding}`].join(" ");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="analytics-chart analytics-chart-line" role="img" aria-label="Son 7 gün aktivite trendi">
      <polygon points="${areaPoints}" class="analytics-line-fill"></polygon>
      <polyline points="${linePoints}" class="analytics-line-stroke"></polyline>
      ${coordinates
        .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="3.5" class="analytics-line-point"></circle>`)
        .join("")}
      ${coordinates
        .map((point) => `<text x="${point.x}" y="${height - 4}" text-anchor="middle" class="analytics-axis-label">${point.label}</text>`)
        .join("")}
    </svg>
  `;
}

function renderSuccessBreakdown(snapshot) {
  const segments = [
    { key: "know", label: "Tamam", value: snapshot.successCounts.know, className: "is-know" },
    { key: "review", label: "Tekrar", value: snapshot.successCounts.review, className: "is-review" },
    { key: "dunno", label: "Bilmiyorum", value: snapshot.successCounts.dunno, className: "is-dunno" },
  ];
  const total = Math.max(1, snapshot.assessedCount);

  return `
    <div class="analytics-stacked-bar" role="img" aria-label="Başarı dağılımı">
      ${segments
        .map((segment) => `<span class="analytics-stacked-segment ${segment.className}" style="width:${(segment.value / total) * 100}%"></span>`)
        .join("")}
    </div>
    <div class="analytics-legend">
      ${segments
        .map((segment) => `<div class="analytics-legend-item"><span class="analytics-legend-dot ${segment.className}"></span><span>${segment.label}</span><strong>${segment.value}</strong></div>`)
        .join("")}
    </div>
  `;
}

function renderRetentionChart(retention) {
  const rate = clamp(retention.rate, 0, 100);
  const target = clamp(retention.target, 0, 100);

  return `
    <div class="analytics-bullet" role="img" aria-label="Retention hedef karşılaştırması">
      <div class="analytics-bullet-track">
        <span class="analytics-bullet-range is-low"></span>
        <span class="analytics-bullet-range is-mid"></span>
        <span class="analytics-bullet-range is-high"></span>
        <span class="analytics-bullet-value" style="width:${rate}%"></span>
        <span class="analytics-bullet-target" style="left:${target}%"></span>
      </div>
      <div class="analytics-retention-copy">
        <span>${retention.stableCount} kart plan içinde</span>
        <span>${retention.dueCount} kart gecikmiş</span>
      </div>
    </div>
  `;
}

function renderAnalyticsCard(title, meta, bodyMarkup) {
  return `
    <article class="analytics-card">
      <div class="analytics-card-head">
        <div>
          <div class="analytics-card-title">${title}</div>
          <div class="analytics-card-meta">${meta}</div>
        </div>
      </div>
      <div class="analytics-card-body">${bodyMarkup}</div>
    </article>
  `;
}

export function syncAnalyticsVisibility() {
  const { dashboard, toggleButton } = getAnalyticsElements();
  if (dashboard) dashboard.hidden = !isAnalyticsVisible;
  syncAnalyticsToggleUi(toggleButton, isAnalyticsVisible);
}

export function syncAnalyticsDashboard() {
  const { grid, summary } = getAnalyticsElements();
  if (!grid) return;

  const snapshot = buildAnalyticsSnapshot(resolveAnalyticsCards(), assessments, reviewSchedule, new Date());
  if (!snapshot.totalCards) {
    grid.innerHTML = `<div class="analytics-empty-state">Analitikler, seçili setlerde ilerleme oluştukça burada görünecek.</div>`;
    if (summary) summary.textContent = "Henüz seçili set verisi yok.";
    return;
  }

  if (summary) {
    summary.textContent = `${snapshot.totalCards} kart · ${snapshot.assessedCount} değerlendirilmiş · başarı %${snapshot.successRate}`;
  }

  grid.innerHTML = [
    renderAnalyticsCard(
      "Günlük Aktivite",
      `Son 7 gün · ${snapshot.dailyActivity.reduce((total, day) => total + day.count, 0)} tekrar`,
      renderDailyActivityChart(snapshot.dailyActivity),
    ),
    renderAnalyticsCard(
      "Başarı Dağılımı",
      `Doğru cevap oranı %${snapshot.successRate}`,
      renderSuccessBreakdown(snapshot),
    ),
    renderAnalyticsCard(
      "Retention",
      `${snapshot.retention.trackedCount} takip edilen kart · hedef %${snapshot.retention.target}`,
      renderRetentionChart(snapshot.retention),
    ),
  ].join("");
}

export function setAnalyticsVisibility(isVisible, options = {}) {
  const nextVisible = Boolean(isVisible);
  const shouldPersist = options.persist !== false;

  setIsAnalyticsVisible(nextVisible);
  syncAnalyticsVisibility();
  if (nextVisible) syncAnalyticsDashboard();

  if (!shouldPersist) return;
  import("../study-state/study-state.js").then(({ saveStudyState }) => saveStudyState());
}

export function toggleAnalyticsVisibility() {
  setAnalyticsVisibility(!isAnalyticsVisible);
}

export function closeAnalyticsDashboard() {
  setAnalyticsVisibility(false);
}
