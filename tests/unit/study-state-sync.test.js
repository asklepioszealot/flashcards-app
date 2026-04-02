import { describe, expect, it } from "vitest";
import { normalizeSyncedUserState } from "../../src/core/platform-adapter.js";
import { normalizeStudyStateSnapshot } from "../../src/shared/utils.js";

describe("Study state review preferences", () => {
  it("should default review preferences when older snapshots do not have them", () => {
    const snapshot = normalizeStudyStateSnapshot({
      selectedSetIds: ["demo"],
      autoAdvanceEnabled: true,
      isAnalyticsVisible: false,
    });

    expect(snapshot.reviewPreferences).toEqual({
      memoryTargetPercent: 85,
      intervalMultiplier: 1,
    });
    expect(snapshot.cardContentPreferences).toEqual({
      frontFontSize: 24,
      backFontSize: 18,
      fullscreenFrontFontSize: 28,
      fullscreenBackFontSize: 20,
    });
    expect(snapshot.showReviewScheduleInfo).toBe(false);
  });

  it("should clamp review preferences for synced payloads", () => {
    const snapshot = normalizeSyncedUserState({
      selectedSetIds: ["demo"],
      reviewPreferences: {
        memoryTargetPercent: 100,
        intervalMultiplier: 0.5,
      },
    });

    expect(snapshot.reviewPreferences).toEqual({
      memoryTargetPercent: 95,
      intervalMultiplier: 0.8,
    });
    expect(snapshot.cardContentPreferences).toEqual({
      frontFontSize: 24,
      backFontSize: 18,
      fullscreenFrontFontSize: 28,
      fullscreenBackFontSize: 20,
    });
  });

  it("should clamp card content font preferences for local and synced payloads", () => {
    const localSnapshot = normalizeStudyStateSnapshot({
      cardContentPreferences: {
        frontFontSize: 80,
        backFontSize: 9,
        fullscreenFrontFontSize: 13,
        fullscreenBackFontSize: 40,
      },
    });
    const syncedSnapshot = normalizeSyncedUserState({
      selectedSetIds: ["demo"],
      cardContentPreferences: {
        frontFontSize: 12,
        backFontSize: 40,
        fullscreenFrontFontSize: 99,
        fullscreenBackFontSize: 10,
      },
    });

    expect(localSnapshot.cardContentPreferences).toEqual({
      frontFontSize: 32,
      backFontSize: 14,
      fullscreenFrontFontSize: 14,
      fullscreenBackFontSize: 32,
    });
    expect(syncedSnapshot.cardContentPreferences).toEqual({
      frontFontSize: 14,
      backFontSize: 32,
      fullscreenFrontFontSize: 32,
      fullscreenBackFontSize: 14,
    });
  });

  it("should preserve legacy local card font preferences and fill fullscreen defaults", () => {
    const snapshot = normalizeStudyStateSnapshot({
      cardContentPreferences: {
        frontFontSize: 26,
        backFontSize: 19,
      },
    });

    expect(snapshot.cardContentPreferences).toEqual({
      frontFontSize: 26,
      backFontSize: 19,
      fullscreenFrontFontSize: 28,
      fullscreenBackFontSize: 20,
    });
  });

  it("should preserve the review schedule visibility preference for local and synced payloads", () => {
    const localSnapshot = normalizeStudyStateSnapshot({
      showReviewScheduleInfo: true,
    });
    const syncedSnapshot = normalizeSyncedUserState({
      selectedSetIds: ["demo"],
      showReviewScheduleInfo: true,
    });

    expect(localSnapshot.showReviewScheduleInfo).toBe(true);
    expect(syncedSnapshot.showReviewScheduleInfo).toBe(true);
  });
});
