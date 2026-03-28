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
  });
});
