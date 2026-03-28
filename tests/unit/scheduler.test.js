import { describe, expect, it } from "vitest";
import {
  formatRelativeReviewLabel,
  getReviewUrgency,
  scheduleNextReview,
  summarizeReviewSchedule,
} from "../../src/features/study/scheduler.js";

describe("Study scheduler", () => {
  it("should create a first review interval from a know assessment", () => {
    const result = scheduleNextReview("know", null, "2026-03-01T09:00:00.000Z");

    expect(result.lastAssessment).toBe("know");
    expect(result.repetition).toBe(1);
    expect(result.intervalDays).toBeGreaterThanOrEqual(1);
    expect(result.easeFactor).toBeGreaterThanOrEqual(2.5);
  });

  it("should grow intervals more cautiously for review than know", () => {
    const first = scheduleNextReview("know", null, "2026-03-01T09:00:00.000Z");
    const knowFollowUp = scheduleNextReview("know", first, "2026-03-02T09:00:00.000Z");
    const reviewFollowUp = scheduleNextReview("review", first, "2026-03-02T09:00:00.000Z");

    expect(knowFollowUp.intervalDays).toBeGreaterThan(first.intervalDays);
    expect(reviewFollowUp.intervalDays).toBeLessThan(knowFollowUp.intervalDays);
  });

  it("should reset repetition and increase lapses on dunno", () => {
    const previous = scheduleNextReview("know", null, "2026-03-01T09:00:00.000Z");
    const failed = scheduleNextReview("dunno", previous, "2026-03-05T09:00:00.000Z");

    expect(failed.repetition).toBe(0);
    expect(failed.lapses).toBe(previous.lapses + 1);
    expect(failed.intervalDays).toBeLessThanOrEqual(1);
  });

  it("should scale future intervals with memory target and tempo preferences", () => {
    const baseline = scheduleNextReview("know", null, "2026-03-01T09:00:00.000Z");
    const conservative = scheduleNextReview(
      "know",
      null,
      "2026-03-01T09:00:00.000Z",
      { memoryTargetPercent: 95, intervalMultiplier: 0.8 },
    );
    const faster = scheduleNextReview(
      "know",
      null,
      "2026-03-01T09:00:00.000Z",
      { memoryTargetPercent: 75, intervalMultiplier: 1.3 },
    );

    expect(conservative.intervalDays).toBeLessThan(baseline.intervalDays);
    expect(faster.intervalDays).toBeGreaterThan(baseline.intervalDays);
  });

  it("should summarize due, upcoming and new cards", () => {
    const now = "2026-03-10T12:00:00.000Z";
    const summary = summarizeReviewSchedule(
      ["card-1", "card-2", "card-3", "card-4"],
      {
        "card-1": { dueAt: "2026-03-10T08:00:00.000Z", intervalDays: 1, easeFactor: 2.5, repetition: 1, lapses: 0, difficulty: 5, stability: 1, lastAssessment: "know" },
        "card-2": { dueAt: "2026-03-10T18:00:00.000Z", intervalDays: 0.5, easeFactor: 2.3, repetition: 1, lapses: 0, difficulty: 5.3, stability: 0.5, lastAssessment: "review" },
        "card-3": { dueAt: "2026-03-20T18:00:00.000Z", intervalDays: 10, easeFactor: 2.6, repetition: 3, lapses: 0, difficulty: 4.5, stability: 10, lastAssessment: "know" },
      },
      now,
    );

    expect(summary.dueCount).toBe(1);
    expect(summary.upcomingCount).toBe(1);
    expect(summary.scheduledCount).toBe(1);
    expect(summary.newCount).toBe(1);
    expect(getReviewUrgency({ dueAt: "2026-03-10T08:00:00.000Z" }, now)).toBe("due");
    expect(formatRelativeReviewLabel({ dueAt: "2026-03-10T18:00:00.000Z" }, now)).toContain("saat");
  });
});
