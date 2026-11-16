import { describe, expect, it } from "vitest";
import {
  createStudySession, configureSession, reconcileSession, getSessionPresentation,
  advanceSession, rewindSession, jumpSession, canAdvanceSession, assessSession, clearSessionCards,
} from "../../src/features/study/session-queue.js";

const preferences = { dunnoGapCards: 3, reviewGapCards: 5 };
const now = new Date(2026, 10, 16, 9);
function session(keys = ["A", "B", "C", "D", "E", "F", "G"]) {
  const state = createStudySession();
  configureSession(state, keys);
  return state;
}
const key = (state) => getSessionPresentation(state)?.key;
function answer(state, level, previous = null, date = now) {
  return assessSession(state, level, previous?.assessment || null, previous?.schedule || null, preferences, date);
}
const forward = (state, count) => Array.from({ length: count }, () => { advanceSession(state); return key(state); });

describe("in-session relearning", () => {
  it.each([["dunno", ["B", "C", "D", "A"]], ["review", ["B", "C", "D", "E", "F", "A"]]])(
    "inserts %s after exactly the configured other presentations", (level, expected) => {
      const state = session();
      answer(state, level);
      expect(forward(state, expected.length)).toEqual(expected);
    },
  );

  it("accepts the same answer on later presentations until know removes the repeat", () => {
    const state = session(["A"]);
    let result = answer(state, "dunno");
    for (let i = 0; i < 3; i += 1) {
      expect(canAdvanceSession(state)).toBe(true);
      advanceSession(state);
      result = answer(state, "dunno", result);
      expect(result.assessment).toBe("dunno");
      expect(result.cleared).toBe(false);
    }
    advanceSession(state);
    answer(state, "know", result);
    expect(canAdvanceSession(state)).toBe(false);
  });

  it("alternates the remaining two cards fairly despite their different gaps", () => {
    const state = session(["A", "B"]);
    answer(state, "review");
    advanceSession(state);
    answer(state, "dunno");
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      advanceSession(state);
      seen.push(key(state));
      answer(state, key(state) === "A" ? "review" : "dunno");
    }
    expect(seen).toEqual(["A", "B", "A", "B", "A", "B", "A", "B"]);
  });

  it("does not consume repeat gaps by retracing history", () => {
    const state = session();
    answer(state, "dunno");
    expect(forward(state, 2)).toEqual(["B", "C"]);
    rewindSession(state);
    expect(key(state)).toBe("B");
    advanceSession(state);
    expect(key(state)).toBe("C");
    expect(forward(state, 2)).toEqual(["D", "A"]);
  });

  it("keeps jump numbering without treating skipped cards as intervening presentations", () => {
    const state = session();
    answer(state, "dunno");
    jumpSession(state, "D");
    expect(forward(state, 4)).toEqual(["E", "F", "G", "A"]);
  });

  it("suspends out-of-scope repeats and restores their remaining gaps", () => {
    const state = session();
    answer(state, "dunno");
    configureSession(state, ["B", "C"]);
    expect(forward(state, 1)).toEqual(["C"]);
    expect(canAdvanceSession(state)).toBe(false);
    configureSession(state, ["A", "B", "C", "D", "E"]);
    expect(forward(state, 4)).toEqual(["B", "C", "D", "A"]);
  });

  it("restores history, shuffled order and a repeat through JSON serialization", () => {
    const state = session(["C", "A", "B", "D", "E"]);
    answer(state, "dunno");
    forward(state, 2);
    const restored = createStudySession(JSON.parse(JSON.stringify(state)));
    configureSession(restored, ["A", "B", "C", "D", "E"]);
    expect(key(restored)).toBe("B");
    expect(forward(restored, 2)).toEqual(["D", "C"]);
  });

  it("purges removed card IDs including undo snapshots", () => {
    const state = session(["A", "B"]);
    answer(state, "dunno");
    advanceSession(state);
    reconcileSession(state, ["B"]);
    configureSession(state, ["B"]);
    expect(key(state)).toBe("B");
    expect(canAdvanceSession(state)).toBe(false);
    expect(JSON.stringify(state)).not.toContain('"A"');
  });

  it("rejects malformed restored queue/history state and clears selected progress", () => {
    const state = createStudySession({ version: 1, order: [null, "A", "A"], pending: [{ key: "missing", remaining: -9 }], history: [null], cursor: Infinity });
    reconcileSession(state, ["A"]);
    configureSession(state, ["A"]);
    const first = answer(state, "review");
    expect(first.assessment).toBe("review");
    clearSessionCards(state, ["A"]);
    expect(canAdvanceSession(state)).toBe(false);
  });
});

describe("daily learning credit", () => {
  it("uses the pre-day baseline and hardest answer while keeping the latest assessment", () => {
    const state = session(["A"]);
    const first = answer(state, "dunno");
    advanceSession(state);
    const second = answer(state, "review", first);
    advanceSession(state);
    const third = answer(state, "know", second);
    expect(third.assessment).toBe("know");
    expect(third.schedule.lastAssessment).toBe("know");
    expect(third.schedule.lapses).toBe(1);
    expect(third.schedule.repetition).toBe(0);
    expect(third.schedule.intervalDays).toBe(first.schedule.intervalDays);
    expect(third.schedule.easeFactor).toBe(first.schedule.easeFactor);
  });

  it("corrects and clears only this presentation, restoring earlier learning", () => {
    const state = session(["A"]);
    const first = answer(state, "dunno");
    advanceSession(state);
    const second = answer(state, "know", first);
    const undone = answer(state, "know", second);
    expect(undone.cleared).toBe(true);
    expect(undone.assessment).toBe("dunno");
    expect(undone.schedule.lapses).toBe(1);
    expect(canAdvanceSession(state)).toBe(true);
  });

  it("can replace the first failure before leaving the presentation", () => {
    const state = session(["A"]);
    const first = answer(state, "dunno");
    const corrected = answer(state, "know", first);
    expect(corrected.schedule.lapses).toBe(0);
    expect(corrected.schedule.repetition).toBe(1);
    const cleared = answer(state, "know", corrected);
    expect(cleared.assessment).toBeNull();
    expect(cleared.schedule).toBeNull();
    expect(canAdvanceSession(state)).toBe(false);
  });

  it("retains the daily baseline after reload and gives new credit next local day", () => {
    let state = session(["A"]);
    const first = answer(state, "review");
    state = createStudySession(JSON.parse(JSON.stringify(state)));
    advanceSession(state);
    const sameDay = answer(state, "review", first);
    expect(sameDay.schedule.repetition).toBe(1);
    const nextDay = answer(state, "review", sameDay, new Date(2026, 10, 17, 9));
    expect(nextDay.cleared).toBe(false);
    expect(nextDay.schedule.repetition).toBe(2);
  });
});
