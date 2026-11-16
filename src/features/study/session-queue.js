// Serializable study flow. No DOM, storage or application globals.
import { normalizeReviewScheduleEntry } from "../../shared/utils.js";
import { scheduleNextReview } from "./scheduler.js";

const levels = new Set(["know", "review", "dunno"]);
const keys = (value) => [...new Set(Array.isArray(value) ? value.filter((key) => typeof key === "string" && key.trim()) : [])];
const integer = (value, fallback = 0) => Number.isSafeInteger(value) && value >= 0 ? value : fallback;
const copy = (value) => value == null ? null : JSON.parse(JSON.stringify(value));
const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const gap = (level, preferences) => Math.min(50, Math.max(1, Math.trunc(Number(preferences?.[level === "dunno" ? "dunnoGapCards" : "reviewGapCards"]) || (level === "dunno" ? 3 : 5))));
function normalizePending(value) {
  if (!value || typeof value.key !== "string" || !value.key.trim()) return null;
  return { key: value.key, remaining: Math.min(50, integer(value.remaining)), serial: integer(value.serial) };
}

export function createStudySession(saved = null) {
  const state = {
    version: 1, scopeKeys: [], order: [], normalNext: 0, pending: [],
    history: [], cursor: -1, daily: {}, serial: 0, nextId: 1,
  };
  if (saved?.version !== 1) return state;
  state.scopeKeys = keys(saved.scopeKeys);
  state.order = keys(saved.order);
  state.normalNext = Math.min(integer(saved.normalNext), state.order.length);
  const pending = Array.isArray(saved.pending) ? saved.pending.map(normalizePending).filter(Boolean) : [];
  state.pending = [...new Map(pending.map((entry) => [entry.key, entry])).values()];
  const ids = new Set();
  state.history = (Array.isArray(saved.history) ? saved.history : []).filter((entry) => {
    if (!entry || typeof entry.key !== "string" || !entry.key.trim() || !integer(entry.id) || ids.has(entry.id)) return false;
    ids.add(entry.id);
    return true;
  }).map((entry) => ({
    id: entry.id, key: entry.key,
    answer: levels.has(entry.answer) ? entry.answer : null,
    answerDay: typeof entry.answerDay === "string" ? entry.answerDay : "",
    beforePending: normalizePending(entry.beforePending),
  }));
  state.cursor = state.history.length ? Math.min(integer(saved.cursor), state.history.length - 1) : -1;
  state.daily = Object.fromEntries(Object.entries(saved.daily && typeof saved.daily === "object" ? saved.daily : {}).filter(([, entry]) => (
    entry && /^\d{4}-\d{2}-\d{2}$/.test(entry.day)
  )).map(([key, entry]) => [key, {
    day: entry.day,
    baseline: normalizeReviewScheduleEntry(entry.baseline),
    baselineAssessment: levels.has(entry.baselineAssessment) ? entry.baselineAssessment : null,
    attempts: (Array.isArray(entry.attempts) ? entry.attempts : []).filter((attempt) => (
      attempt && integer(attempt.id) && levels.has(attempt.level) && validTime(attempt.at)
    )).map((attempt) => ({ id: attempt.id, level: attempt.level, at: attempt.at, serial: integer(attempt.serial) })),
  }]));
  state.serial = Math.max(integer(saved.serial), ...state.pending.map((entry) => entry.serial), ...Object.values(state.daily).flatMap((entry) => entry.attempts.map((attempt) => attempt.serial)));
  state.nextId = Math.max(integer(saved.nextId, 1), ...state.history.map((entry) => entry.id + 1), ...Object.values(state.daily).flatMap((entry) => entry.attempts.map((attempt) => attempt.id + 1)));
  return state;
}

export const getSessionPresentation = (state) => state?.history[state.cursor] || null;
function present(state, key) {
  state.history = state.history.slice(0, state.cursor + 1);
  state.history.push({ id: state.nextId++, key, answer: null, answerDay: "", beforePending: null });
  state.cursor = state.history.length - 1;
  return getSessionPresentation(state);
}

export function configureSession(state, cardKeys, options = {}) {
  const nextKeys = keys(cardKeys);
  const sameScope = nextKeys.length === state.scopeKeys.length && nextKeys.every((key) => state.scopeKeys.includes(key));
  if (sameScope && !options.restart && getSessionPresentation(state) && nextKeys.includes(getSessionPresentation(state).key)) return state;
  state.scopeKeys = nextKeys;
  state.order = [...nextKeys];
  state.history = [];
  state.cursor = -1;
  const preferredIndex = Math.max(0, nextKeys.indexOf(options.preferredKey));
  state.normalNext = nextKeys.length ? preferredIndex + 1 : 0;
  if (nextKeys.length) present(state, nextKeys[preferredIndex]);
  return state;
}

export function reconcileSession(state, availableKeys) {
  const available = new Set(keys(availableKeys));
  state.normalNext = state.order.slice(0, state.normalNext).filter((key) => available.has(key)).length;
  state.order = state.order.filter((key) => available.has(key));
  state.scopeKeys = state.scopeKeys.filter((key) => available.has(key));
  state.pending = state.pending.filter((entry) => available.has(entry.key));
  const currentId = getSessionPresentation(state)?.id;
  state.history = state.history.filter((entry) => available.has(entry.key));
  const currentIndex = state.history.findIndex((entry) => entry.id === currentId);
  state.cursor = currentIndex >= 0 ? currentIndex : Math.min(state.cursor, state.history.length - 1);
  state.daily = Object.fromEntries(Object.entries(state.daily).filter(([key]) => available.has(key)));
  return state;
}

function eligiblePending(state) {
  const scope = new Set(state.order);
  return state.pending.filter((entry) => scope.has(entry.key)).sort((a, b) => a.serial - b.serial);
}
export function canAdvanceSession(state) {
  return Boolean(state && (state.cursor < state.history.length - 1 || state.normalNext < state.order.length || eligiblePending(state).length));
}

export function advanceSession(state) {
  if (state.cursor < state.history.length - 1) {
    state.cursor += 1;
    return getSessionPresentation(state);
  }
  const currentKey = getSessionPresentation(state)?.key;
  const pending = eligiblePending(state);
  const normal = state.order[state.normalNext];
  // Normal cards keep their gaps. Once exhausted, rotate all remaining repeats.
  const candidate = normal
    ? pending.filter((entry) => entry.remaining === 0 && entry.key !== currentKey)[0]
    : pending.find((entry) => entry.key !== currentKey) || pending[0];
  const nextKey = candidate?.key || normal;
  if (!nextKey) return null;
  if (!candidate) state.normalNext += 1;
  else candidate.serial = ++state.serial;
  const scope = new Set(state.order);
  state.pending.forEach((entry) => {
    if (scope.has(entry.key) && entry.key !== nextKey) entry.remaining = Math.max(0, entry.remaining - 1);
  });
  return present(state, nextKey);
}

export function rewindSession(state) {
  if (state.cursor > 0) state.cursor -= 1;
  return getSessionPresentation(state);
}

export function jumpSession(state, key) {
  const index = state.order.indexOf(key);
  if (index < 0) return null;
  state.normalNext = index + 1;
  return present(state, key);
}

export function assessSession(state, level, assessment, schedule, preferences, now = new Date()) {
  const view = getSessionPresentation(state);
  if (!view || !levels.has(level)) return null;
  const date = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(date.getTime())) return null;
  const day = localDay(date);
  let daily = Object.hasOwn(state.daily, view.key) ? state.daily[view.key] : null;
  if (!daily || daily.day !== day) {
    daily = { day, baseline: copy(schedule), baselineAssessment: assessment, attempts: [] };
    Object.defineProperty(state.daily, view.key, { value: daily, writable: true, enumerable: true, configurable: true });
  }
  const cleared = view.answerDay === day && view.answer === level;
  if (view.answerDay !== day || !view.answer) {
    view.beforePending = copy(state.pending.find((entry) => entry.key === view.key));
  }
  daily.attempts = daily.attempts.filter((entry) => entry.id !== view.id);
  if (!cleared) daily.attempts.push({ id: view.id, level, at: date.toISOString(), serial: ++state.serial });
  view.answer = cleared ? null : level;
  view.answerDay = day;
  const attempts = [...daily.attempts].sort((a, b) => a.serial - b.serial);
  const latest = attempts.at(-1);
  const nextAssessment = latest?.level || daily.baselineAssessment || null;
  let nextSchedule = copy(daily.baseline);
  if (latest) {
    const hardest = attempts.some((entry) => entry.level === "dunno") ? "dunno"
      : attempts.some((entry) => entry.level === "review") ? "review" : "know";
    nextSchedule = { ...scheduleNextReview(hardest, daily.baseline, latest.at, preferences), lastAssessment: latest.level };
  }
  state.pending = state.pending.filter((entry) => entry.key !== view.key);
  if (nextAssessment && nextAssessment !== "know") {
    if (cleared && view.beforePending) state.pending.push(copy(view.beforePending));
    else if (!cleared || latest) state.pending.push({ key: view.key, remaining: gap(nextAssessment, preferences), serial: ++state.serial });
  }
  return { assessment: nextAssessment, schedule: nextSchedule, cleared };
}

export function clearSessionCards(state, cardKeys) {
  const removed = new Set(cardKeys);
  state.pending = state.pending.filter((entry) => !removed.has(entry.key));
  state.daily = Object.fromEntries(Object.entries(state.daily).filter(([key]) => !removed.has(key)));
  state.history.forEach((entry) => {
    if (removed.has(entry.key)) { entry.answer = null; entry.answerDay = ""; entry.beforePending = null; }
  });
}
