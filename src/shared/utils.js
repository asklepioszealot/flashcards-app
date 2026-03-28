// src/shared/utils.js
// Pure helper functions with no side effects, no DOM access, no mutable state.

import { DEFAULT_REVIEW_PREFERENCES } from "./constants.js";

export const safeJsonParse = (rawValue, fallbackValue) => {
  if (!rawValue) return fallbackValue;
  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
};

export const nowIso = () => new Date().toISOString();

export const cloneData = (value) => JSON.parse(JSON.stringify(value));

export const escapeMarkup = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export const escapeAttributeSelectorValue = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\D ")
    .replace(/\n/g, "\\A ");

export function summarizeMarkdownText(value, maxLength = 160) {
  const normalized = String(value ?? "")
    .replace(/[`*_~>#|[\]()-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "Açıklama eklenmedi.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength).trim()}...` : normalized;
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeReviewScheduleEntry(entry) {
  if (!isPlainObject(entry)) return null;

  return {
    dueAt: typeof entry.dueAt === "string" ? entry.dueAt : "",
    lastReviewedAt: typeof entry.lastReviewedAt === "string" ? entry.lastReviewedAt : "",
    intervalDays: Number.isFinite(Number(entry.intervalDays)) ? Math.max(Number(entry.intervalDays), 0) : 0,
    easeFactor: Number.isFinite(Number(entry.easeFactor)) ? Number(entry.easeFactor) : 2.5,
    repetition: Number.isInteger(entry.repetition) ? Math.max(entry.repetition, 0) : 0,
    lapses: Number.isInteger(entry.lapses) ? Math.max(entry.lapses, 0) : 0,
    difficulty: Number.isFinite(Number(entry.difficulty)) ? Number(entry.difficulty) : 5,
    stability: Number.isFinite(Number(entry.stability)) ? Math.max(Number(entry.stability), 0) : 0,
    lastAssessment:
      entry.lastAssessment === "know" || entry.lastAssessment === "review" || entry.lastAssessment === "dunno"
        ? entry.lastAssessment
        : null,
  };
}

export function normalizeReviewScheduleMap(value, fallback = {}) {
  const source = isPlainObject(value) ? value : isPlainObject(fallback) ? fallback : {};
  return Object.fromEntries(
    Object.entries(source)
      .map(([cardKey, entry]) => [cardKey, normalizeReviewScheduleEntry(entry)])
      .filter(([cardKey, entry]) => typeof cardKey === "string" && cardKey.trim() && entry),
  );
}

export function normalizeReviewPreferences(value, fallback = DEFAULT_REVIEW_PREFERENCES) {
  const base = isPlainObject(fallback) ? fallback : DEFAULT_REVIEW_PREFERENCES;
  const source = isPlainObject(value) ? value : base;
  const memoryTargetPercent = Number.parseInt(source?.memoryTargetPercent, 10);
  const intervalMultiplier = Number.parseFloat(source?.intervalMultiplier);

  return {
    memoryTargetPercent: Number.isFinite(memoryTargetPercent)
      ? Math.min(Math.max(memoryTargetPercent, 75), 95)
      : base.memoryTargetPercent,
    intervalMultiplier: Number.isFinite(intervalMultiplier)
      ? Math.min(Math.max(Math.round(intervalMultiplier * 100) / 100, 0.8), 1.3)
      : base.intervalMultiplier,
  };
}

export function normalizeStudyStateSnapshot(snapshot, fallback = {}) {
  return {
    selectedSetIds: Array.isArray(snapshot?.selectedSetIds)
      ? snapshot.selectedSetIds.filter((setId) => typeof setId === "string" && setId.trim())
      : Array.isArray(fallback.selectedSetIds)
        ? fallback.selectedSetIds
        : [],
    assessments: isPlainObject(snapshot?.assessments)
      ? cloneData(snapshot.assessments)
      : isPlainObject(fallback.assessments)
        ? cloneData(fallback.assessments)
        : {},
    reviewSchedule: isPlainObject(snapshot?.reviewSchedule)
      ? normalizeReviewScheduleMap(snapshot.reviewSchedule)
      : isPlainObject(fallback.reviewSchedule)
        ? normalizeReviewScheduleMap(fallback.reviewSchedule)
        : {},
    session: isPlainObject(snapshot?.session)
      ? cloneData(snapshot.session)
      : isPlainObject(fallback.session)
        ? cloneData(fallback.session)
        : null,
    autoAdvanceEnabled: snapshot?.autoAdvanceEnabled !== undefined
      ? snapshot.autoAdvanceEnabled !== false
      : fallback.autoAdvanceEnabled !== undefined
        ? fallback.autoAdvanceEnabled !== false
        : true,
    isAnalyticsVisible: snapshot?.isAnalyticsVisible !== undefined
      ? snapshot.isAnalyticsVisible === true
      : fallback.isAnalyticsVisible !== undefined
        ? fallback.isAnalyticsVisible === true
        : false,
    reviewPreferences: normalizeReviewPreferences(snapshot?.reviewPreferences, fallback.reviewPreferences),
    updatedAt: snapshot?.updatedAt
      ? String(snapshot.updatedAt)
      : fallback.updatedAt
        ? String(fallback.updatedAt)
        : "",
  };
}
