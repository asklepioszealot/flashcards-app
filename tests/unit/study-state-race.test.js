import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  setCurrentUser, incrementAuthStateToken, setStorage, setPlatformAdapter,
  setPendingRemoteStudyStateSnapshot, setReviewPreferences, reviewPreferences,
  setStudySession, setLoadedSets, loadedSets,
} from "../../src/app/state.js";
import { flushRemoteStudyStateSync, loadUserStudyState, loadUserWorkspace } from "../../src/features/study-state/study-state.js";

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const snapshot = {
  selectedSetIds: ["A-set"], reviewPreferences: { dunnoGapCards: 2, reviewGapCards: 4 },
  session: { relearning: { version: 1, pending: [{ key: "A-only", remaining: 0, serial: 1 }] } },
  updatedAt: "2026-11-16T10:00:00.000Z",
};
describe("study state account boundaries", () => {
  let values;
  beforeEach(() => {
    values = new Map();
    setStorage({ getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) });
    setCurrentUser({ id: "A" });
    incrementAuthStateToken();
    setLoadedSets({});
  });
  afterEach(() => {
    setCurrentUser(null);
    incrementAuthStateToken();
    setPendingRemoteStudyStateSnapshot(null);
    setPlatformAdapter(null);
    setStorage(null);
    setStudySession(null);
    setReviewPreferences(null);
    setLoadedSets({});
  });

  it("does not write an old account's delayed save response under the new account", async () => {
    const request = deferred();
    setPlatformAdapter({ saveUserState: () => request.promise });
    setPendingRemoteStudyStateSnapshot(snapshot);
    const saving = flushRemoteStudyStateSync();
    setCurrentUser({ id: "B" });
    incrementAuthStateToken();
    request.resolve(snapshot);
    await saving;
    expect(values.get("fc_v2::user::B::study_state_sync")).toBeUndefined();
  });

  it.each(["B", "A"])("ignores a delayed load after switching sessions to %s", async (nextUser) => {
    const request = deferred();
    setPlatformAdapter({ loadUserState: () => request.promise });
    const loading = loadUserStudyState();
    setCurrentUser({ id: nextUser });
    incrementAuthStateToken();
    setReviewPreferences({ dunnoGapCards: 8, reviewGapCards: 9 });
    request.resolve(snapshot);
    await loading;
    expect(reviewPreferences.dunnoGapCards).toBe(8);
    expect(values.get(`fc_v2::user::${nextUser}::study_state_sync`)).toBeUndefined();
  });

  it("still persists a completed save belonging to the active account", async () => {
    setPlatformAdapter({ saveUserState: async () => snapshot });
    setPendingRemoteStudyStateSnapshot(snapshot);
    await flushRemoteStudyStateSync();
    const saved = JSON.parse(values.get("fc_v2::user::A::study_state_sync"));
    expect(saved.session.relearning.pending[0].key).toBe("A-only");
  });

  it("does not hydrate the old account's delayed set list after an account switch", async () => {
    const request = deferred();
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    setPlatformAdapter({ loadSets: () => { started(); return request.promise; } });
    const loading = loadUserWorkspace();
    await didStart;
    setCurrentUser({ id: "B" });
    incrementAuthStateToken();
    setLoadedSets({ "B-set": { id: "B-set", cards: [] } });
    // No old records means the test isolates the assignment boundary without a migration.
    request.resolve([]);
    await loading;
    expect(Object.keys(loadedSets)).toEqual(["B-set"]);
  });
});
