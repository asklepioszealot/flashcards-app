# In-session Card Relearning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repeat difficult cards until “Tamam”, with account-configurable 3/5-card gaps and fair short-deck fallback, then publish verified web, desktop and Android builds.

**Architecture:** A pure session engine owns the normal cursor, one pending repeat per card, navigation history and daily assessment baselines. Existing display, assessment and snapshot modules adapt to this engine without duplicating cards. Extend the existing reviewPreferences JSON fields; reuse current GitHub Actions for distribution.

**Tech Stack:** JavaScript ES modules, Vite, Vitest/jsdom, Playwright, Tauri, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-16-in-session-card-relearning-design.md` (approved 2026-11-16).

## Global Constraints

- Work on the current branch in this directory; no branch or worktree creation.
- Default gaps: `dunnoGapCards: 3`, `reviewGapCards: 5`; independent integer values from 1–50.
- Show the front face on every new presentation; history traversal does not advance gap counters.
- Preserve unique-card counters, exports, font-only reset and account isolation.
- Same-day scheduling uses the pre-day baseline and hardest remaining answer; lastAssessment shows the latest actual answer.
- User explicitly authorized all three releases after successful verification, overriding the design's initial publication exclusion. Bump the Tauri version only for this requested release.
- Run `npm run test:smoke` before push and every release/deployment dispatch. Do not change database schema or live user data.

## Review Focus

- Restoring malformed/obsolete session records must not select nonexistent cards or leak another account's queue.
- Correcting/clearing a historical response must not multiply repeats or erase a later valid response.
- Suspended repeats across filters and removed/reimported card IDs must remain bounded and valid.
- Same-day state restored after refresh and crossing local midnight must not compound review intervals.
- Last-card manual advancement, repeated same answers and rapid input must produce one coherent presentation each.

---

### Task 1: Pure session engine and daily scheduling

**Files:** Create `src/features/study/session-queue.js`, `tests/unit/session-queue.test.js`.

**Interfaces:** Produces `createStudySession(saved?)`, `configureSession(session, keys, options?)`, `reconcileSession(session, availableKeys)`, `getSessionPresentation(session)`, `advanceSession(session)`, `rewindSession(session)`, `jumpSession(session, key)`, `canAdvanceSession(session)`, `assessSession(session, level, assessment, schedule, preferences, now?) -> { assessment, schedule, cleared }`, `clearSessionCards(session, keys)`. Mutates only the explicitly supplied serializable session object; no DOM or global state. `configureSession` accepts `preferredKey`, `restart`, and preserves saved order when resuming the same scope.

- [ ] Write behavior tests for literal 3/5 intervening cards, repeated failure/know removal, one/two-card fallback, fair tail, history/jump gaps, scope suspension, deleted IDs and JSON restoration. Add daily scheduling/correction/undo and local next-day assertions.
- [ ] Run `npm run test:unit -- tests/unit/session-queue.test.js`; expect missing implementation failures.
- [ ] Implement the pure engine and normalization. Use existing `scheduleNextReview` once against the saved baseline, strongest rating for interval and latest answer for display. Validate saved records and undo data.
- [ ] Run the same command; expect all assertions passing.
- [ ] Commit engine and tests after verification.

### Task 2: Account preferences and study integration

**Files:** Modify `src/shared/constants.js`, `src/shared/utils.js`, `src/app/state.js`, `src/features/study/study.js`, `src/features/study/assessment.js`, `src/features/study-state/study-state.js`, `src/features/auth/auth.js`, `src/app/bootstrap.js`, `index.html`; update `tests/unit/study-state-sync.test.js`, add smoke cases in `tests/smoke/app-smoke.spec.js`.

**Interfaces:** Consumes Task 1 engine. Produces state `studySession`/`setStudySession`, existing reviewPreferences plus the two gap keys, session snapshot `.relearning`, and `syncSessionReviewPreferencesUi()`/`updateSessionReviewPreference(field, value)` for settings bindings. Existing public navigation and assessment exports retain their signatures.

- [ ] Add normalization tests for legacy defaults, invalid independent ranges and synced values. Add smoke cases for 3/5 gaps, consecutive repeat answers, last-card auto/manual loop, same-presentation undo, configured gaps after refresh, font reset and resume/history.
- [ ] Run the new unit tests and targeted smoke cases; expect absence of gap fields/settings and repeated flow to fail.
- [ ] Add defaults and normalization, delegate preference setters to the common normalizer, preserve both keys through the existing remote reviewPreferences object.
- [ ] Wire engine state to display/navigation, filters/shuffle/jump, assessment and progress reset. Save/restore `.relearning`, reconcile against all available card keys and reset memory on account changes. Guard queued auto-advance against presentation changes.
- [ ] Add two number fields to the existing card settings panel, bind change/blur, keep font reset scoped and update accessible panel labels.
- [ ] Run unit suite and `npm run test:smoke`; expect green. Update existing tests only where the approved same-presentation semantics or extended preference object change their contract.
- [ ] Commit integrated behavior and tests after verification.

### Task 3: Independent review and publication

**Files:** Modify `src-tauri/tauri.conf.json`, `CHANGELOG.md`, approved spec/plan status; existing workflows `.github/workflows/pages.yml`, `release-desktop.yml`, `release-android.yml` remain the publishing mechanism.

**Interfaces:** Consumes verified application commit; produces published Pages deployment, signed desktop installer/updater manifest and signed Android APK associated with the same final source commit and new Tauri version.

- [ ] Request one fresh whole-change review against the spec and Review Focus. Fix material findings with failing regression tests first and run full unit/smoke suites.
- [ ] Inspect remote main and release tags without changing branches. Choose the next unused patch version above 0.1.14; update only Tauri config and changelog required by these releases.
- [ ] Run `npm test` (full smoke and unit suites), `git diff --check`; commit release metadata. Run required smoke verification immediately before push and release dispatches.
- [ ] Push current branch without force. Observe the matching Pages workflow; dispatch existing desktop and Android workflows against that exact main head. GitHub connector lacks dispatch/release management, so use authenticated `gh` for those operations.
- [ ] Continue monitoring CI/build/deploy jobs to completion; investigate and resolve failures. Verify release assets/updater versions, source commit association and deployed web content. Provide the website, installer and APK links with actual outcome.

## Execution Record

Execution proceeds inline in the current session under the user's explicit “prepare the plan and proceed with development” instruction. No additional plan approval or publish confirmation is needed. Keep task evidence and rulings in `.superpowers/sdd/2026-11-16-in-session-card-relearning/progress.md`; final review is a fresh subagent as required by executing-plans.
