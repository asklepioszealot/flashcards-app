// src/shared/utils.js
// Pure helper functions with no side effects, no DOM access, no mutable state.

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
    updatedAt: snapshot?.updatedAt
      ? String(snapshot.updatedAt)
      : fallback.updatedAt
        ? String(fallback.updatedAt)
        : "",
  };
}
