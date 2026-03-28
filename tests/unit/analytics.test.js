import { describe, expect, it } from "vitest";
import { buildAnalyticsSnapshot } from "../../src/features/analytics/analytics.js";

describe("Analytics dashboard data", () => {
  it("should summarize activity, success and retention from study data", () => {
    const cards = [
      { id: "card-1", q: "Q1", a: "<p>A1</p>", __cardKey: "set:s1::id:card-1" },
      { id: "card-2", q: "Q2", a: "<p>A2</p>", __cardKey: "set:s1::id:card-2" },
      { id: "card-3", q: "Q3", a: "<p>A3</p>", __cardKey: "set:s1::id:card-3" },
    ];

    const snapshot = buildAnalyticsSnapshot(
      cards,
      {
        "set:s1::id:card-1": "know",
        "set:s1::id:card-2": "review",
        "set:s1::id:card-3": "dunno",
      },
      {
        "set:s1::id:card-1": {
          dueAt: "2026-03-12T12:00:00.000Z",
          lastReviewedAt: "2026-03-10T10:00:00.000Z",
          intervalDays: 2,
          easeFactor: 2.5,
          repetition: 2,
          lapses: 0,
          difficulty: 4.8,
          stability: 2,
          lastAssessment: "know",
        },
        "set:s1::id:card-2": {
          dueAt: "2026-03-09T12:00:00.000Z",
          lastReviewedAt: "2026-03-09T09:00:00.000Z",
          intervalDays: 1,
          easeFactor: 2.2,
          repetition: 1,
          lapses: 0,
          difficulty: 5.4,
          stability: 1,
          lastAssessment: "review",
        },
      },
      new Date("2026-03-10T12:00:00.000Z"),
    );

    expect(snapshot.totalCards).toBe(3);
    expect(snapshot.assessedCount).toBe(3);
    expect(snapshot.successRate).toBe(33);
    expect(snapshot.retention.rate).toBe(50);
    expect(snapshot.retention.dueCount).toBe(1);
    expect(snapshot.dailyActivity.some((day) => day.count > 0)).toBe(true);
  });
});
