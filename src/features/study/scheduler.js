import { DEFAULT_REVIEW_PREFERENCES } from "../../shared/constants.js";
import {
  normalizeReviewPreferences,
  normalizeReviewScheduleEntry,
  normalizeReviewScheduleMap,
} from "../../shared/utils.js";

export { normalizeReviewScheduleEntry, normalizeReviewScheduleMap };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const REVIEW_RATINGS = {
  know: 5,
  review: 3,
  dunno: 1,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundNumber(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function resolveTimestamp(input) {
  const timestamp = input instanceof Date ? input.getTime() : Date.parse(input || "");
  return Number.isFinite(timestamp) ? timestamp : Date.now();
}

function resolveRating(level) {
  return REVIEW_RATINGS[level] || REVIEW_RATINGS.review;
}

// SM-2 tabanini, okunabilir difficulty/stability alanlariyla hafifletiyoruz.
export function scheduleNextReview(
  level,
  previousEntry = null,
  reviewedAt = new Date(),
  reviewPreferences = DEFAULT_REVIEW_PREFERENCES,
) {
  const rating = resolveRating(level);
  const previous = normalizeReviewScheduleEntry(previousEntry);
  const reviewedAtMs = resolveTimestamp(reviewedAt);
  const reviewedAtIso = new Date(reviewedAtMs).toISOString();
  const normalizedPreferences = normalizeReviewPreferences(reviewPreferences);

  let easeFactor = previous?.easeFactor ?? 2.5;
  let repetition = previous?.repetition ?? 0;
  let lapses = previous?.lapses ?? 0;
  let baseIntervalDays = previous?.intervalDays ?? 0;

  if (rating < 3) {
    repetition = 0;
    lapses += 1;
    easeFactor = clamp(easeFactor - 0.2, 1.3, 3.5);
    const fallbackInterval = previous?.intervalDays ?? 0.5;
    baseIntervalDays = Math.max(4 / 24, Math.min(1, fallbackInterval * 0.35));
  } else {
    repetition += 1;
    easeFactor = clamp(
      easeFactor + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02)),
      1.3,
      3.5,
    );

    if (repetition === 1) {
      baseIntervalDays = rating >= 5 ? 1 : 0.5;
    } else if (repetition === 2) {
      baseIntervalDays = rating >= 5 ? 3 : 2;
    } else {
      const baseInterval = previous?.intervalDays || (rating >= 5 ? 3 : 2);
      const ratingMultiplier = rating >= 5 ? 1.15 : 0.9;
      baseIntervalDays = Math.max(0.5, baseInterval * easeFactor * ratingMultiplier);
    }
  }

  const memoryBias = clamp(1 - ((normalizedPreferences.memoryTargetPercent - 85) * 0.02), 0.8, 1.2);
  let intervalDays = baseIntervalDays * normalizedPreferences.intervalMultiplier * memoryBias;
  intervalDays = rating < 3
    ? Math.max(4 / 24, Math.min(1, intervalDays))
    : Math.max(0.5, intervalDays);

  const difficultyDelta = level === "dunno" ? 0.7 : level === "review" ? 0.15 : -0.35;
  const difficulty = roundNumber(clamp((previous?.difficulty ?? 5) + difficultyDelta, 1, 10), 2);
  const stability = roundNumber(Math.max(intervalDays, 0), 2);
  const normalizedIntervalDays = roundNumber(intervalDays, 2);
  const dueAt = new Date(reviewedAtMs + normalizedIntervalDays * DAY_MS).toISOString();

  return normalizeReviewScheduleEntry({
    dueAt,
    lastReviewedAt: reviewedAtIso,
    intervalDays: normalizedIntervalDays,
    easeFactor,
    repetition,
    lapses,
    difficulty,
    stability,
    lastAssessment: level,
  });
}

export function getReviewUrgency(entry, now = new Date()) {
  const normalizedEntry = normalizeReviewScheduleEntry(entry);
  if (!normalizedEntry?.dueAt) return "new";
  const dueAtMs = resolveTimestamp(normalizedEntry.dueAt);
  const nowMs = resolveTimestamp(now);

  if (dueAtMs <= nowMs) return "due";
  if (dueAtMs - nowMs <= DAY_MS) return "upcoming";
  return "scheduled";
}

export function summarizeReviewSchedule(cardKeys = [], scheduleMap = {}, now = new Date()) {
  const normalizedMap = normalizeReviewScheduleMap(scheduleMap);
  return cardKeys.reduce(
    (summary, cardKey) => {
      const entry = normalizedMap[cardKey];
      if (!entry) {
        summary.newCount += 1;
        return summary;
      }

      const urgency = getReviewUrgency(entry, now);
      if (urgency === "due") summary.dueCount += 1;
      else if (urgency === "upcoming") summary.upcomingCount += 1;
      else summary.scheduledCount += 1;
      return summary;
    },
    { dueCount: 0, upcomingCount: 0, scheduledCount: 0, newCount: 0 },
  );
}

export function formatRelativeReviewLabel(entry, now = new Date()) {
  const normalizedEntry = normalizeReviewScheduleEntry(entry);
  if (!normalizedEntry?.dueAt) return "ilk değerlendirme bekleniyor";

  const dueAtMs = resolveTimestamp(normalizedEntry.dueAt);
  const nowMs = resolveTimestamp(now);
  const diffMs = dueAtMs - nowMs;

  if (diffMs <= 0) return "tekrar zamanı geldi";
  if (diffMs < DAY_MS) {
    const hours = Math.max(1, Math.round(diffMs / HOUR_MS));
    return `${hours} saat sonra`;
  }
  if (diffMs < DAY_MS * 7) {
    const days = Math.max(1, Math.round(diffMs / DAY_MS));
    return `${days} gün sonra`;
  }

  return new Date(dueAtMs).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "short",
  });
}
