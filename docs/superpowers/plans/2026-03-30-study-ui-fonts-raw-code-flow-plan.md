# Study UI Fonts, Raw Code, and Card Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add separate fullscreen font controls, make raw code open at full content height without manual resize, and remove delayed next-card transitions from flipped cards.

**Architecture:** Extend the persisted study-state font preference object in a backward-compatible way, then wire the manager settings panel and study CSS to four font variables. Keep raw editor state focused on selection/scroll while deriving height from content, and add an internal instant flip-reset path so navigation does not wait on card-face transitions.

**Tech Stack:** Vite app, vanilla JavaScript modules, Playwright smoke tests, Vitest unit tests

---

### Task 1: Extend Study-State Font Preference Model

**Files:**
- Modify: `src/shared/constants.js`
- Modify: `src/shared/utils.js`
- Modify: `src/app/state.js`
- Modify: `src/core/platform-adapter.js`
- Modify: `tests/unit/study-state-sync.test.js`

- [ ] **Step 1: Write the failing unit test**

```js
it("should preserve legacy local font preferences and fill fullscreen defaults", () => {
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

it("should clamp all four card font preferences for synced payloads", () => {
  const snapshot = normalizeSyncedUserState({
    selectedSetIds: ["demo"],
    cardContentPreferences: {
      frontFontSize: 99,
      backFontSize: 10,
      fullscreenFrontFontSize: 13,
      fullscreenBackFontSize: 60,
    },
  });

  expect(snapshot.cardContentPreferences).toEqual({
    frontFontSize: 32,
    backFontSize: 14,
    fullscreenFrontFontSize: 14,
    fullscreenBackFontSize: 32,
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:unit -- tests/unit/study-state-sync.test.js`
Expected: FAIL because `fullscreenFrontFontSize` and `fullscreenBackFontSize` do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export const DEFAULT_CARD_CONTENT_PREFERENCES = Object.freeze({
  frontFontSize: 24,
  backFontSize: 18,
  fullscreenFrontFontSize: 28,
  fullscreenBackFontSize: 20,
});

return {
  frontFontSize: clamp(frontFontSize, base.frontFontSize),
  backFontSize: clamp(backFontSize, base.backFontSize),
  fullscreenFrontFontSize: clamp(fullscreenFrontFontSize, base.fullscreenFrontFontSize),
  fullscreenBackFontSize: clamp(fullscreenBackFontSize, base.fullscreenBackFontSize),
};
```

Also update state setters and synced payload normalization so the app state always holds all four keys after hydration.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:unit -- tests/unit/study-state-sync.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/unit/study-state-sync.test.js src/shared/constants.js src/shared/utils.js src/app/state.js src/core/platform-adapter.js
git commit -m "feat: extend card font preferences for fullscreen"
```

### Task 2: Add Fullscreen Font Controls and Reset Action

**Files:**
- Modify: `index.html`
- Modify: `src/features/study/study.js`
- Modify: `src/features/auth/auth.js`
- Modify: `src/features/study-state/study-state.js`
- Modify: `tests/smoke/app-smoke.spec.js`

- [ ] **Step 1: Write the failing smoke test**

```js
test("card content settings panel supports normal and fullscreen font sizes with reset", async ({ page }) => {
  await seedLocalSets(page, {
    sets: {
      typography: {
        setName: "Typography Demo",
        fileName: "typography-demo.json",
        cards: [{ q: "Ön yüz", a: "Arka yüz", subject: "Genel" }],
      },
    },
    selectedSetIds: ["typography"],
  });

  await page.locator("#card-content-settings-toggle-btn").click();

  await expect(page.locator("#card-content-front-font-size")).toHaveValue("24");
  await expect(page.locator("#card-content-back-font-size")).toHaveValue("18");
  await expect(page.locator("#card-content-fullscreen-front-font-size")).toHaveValue("28");
  await expect(page.locator("#card-content-fullscreen-back-font-size")).toHaveValue("20");

  await page.locator("#card-content-fullscreen-front-font-size").fill("30");
  await page.locator("#card-content-fullscreen-back-font-size").fill("24");

  await expect.poll(async () => readUserScopedJson(page, "card_content_preferences")).toMatchObject({
    fullscreenFrontFontSize: 30,
    fullscreenBackFontSize: 24,
  });

  await page.locator("#card-content-reset-btn").click();
  await expect(page.locator("#card-content-fullscreen-front-font-size")).toHaveValue("28");
  await expect(page.locator("#card-content-fullscreen-back-font-size")).toHaveValue("20");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:smoke -- --grep "card content settings panel supports normal and fullscreen font sizes with reset"`
Expected: FAIL because fullscreen inputs and reset button do not exist.

- [ ] **Step 3: Write minimal implementation**

```html
<div class="field-group">
  <label for="card-content-fullscreen-front-font-size">Tam ekranda ön yüz font büyüklüğü</label>
  <input id="card-content-fullscreen-front-font-size" ... />
</div>
<div class="field-group">
  <label for="card-content-fullscreen-back-font-size">Tam ekranda arka yüz font büyüklüğü</label>
  <input id="card-content-fullscreen-back-font-size" ... />
</div>
<button id="card-content-reset-btn" type="button" class="btn btn-small btn-secondary">
  Varsayılan fontlara dön
</button>
```

```js
const keyMap = {
  front: "frontFontSize",
  back: "backFontSize",
  fullscreenFront: "fullscreenFrontFontSize",
  fullscreenBack: "fullscreenBackFontSize",
};

export function resetCardContentFontSizes() {
  setCardContentPreferences(DEFAULT_CARD_CONTENT_PREFERENCES);
  syncCardContentPreferencesUi();
  saveStudyState();
}
```

Also bind the new inputs and reset button in `src/app/bootstrap.js` while keeping existing hydration and auth-reset behavior intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:smoke -- --grep "card content settings panel supports normal and fullscreen font sizes with reset"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/app/bootstrap.js src/features/study/study.js src/features/auth/auth.js src/features/study-state/study-state.js tests/smoke/app-smoke.spec.js
git commit -m "feat: add fullscreen study font controls"
```

### Task 3: Apply Fullscreen Typography Variables in Study View

**Files:**
- Modify: `index.html`
- Modify: `src/features/study/study.js`
- Test: `tests/smoke/app-smoke.spec.js`

- [ ] **Step 1: Write the failing smoke test**

```js
test("fullscreen study mode uses dedicated font variables", async ({ page }) => {
  // seed typography set, open settings, set fullscreen front/back to custom values
  await page.locator("#start-btn").click();
  await page.locator("#fullscreen-toggle-btn").click();

  const fullscreenFonts = await page.evaluate(() => ({
    front: getComputedStyle(document.querySelector(".card-container.fullscreen-active #question-text")).fontSize,
    back: (() => {
      document.querySelector("#flashcard").classList.add("flipped");
      return getComputedStyle(document.querySelector(".card-container.fullscreen-active #answer-text")).fontSize;
    })(),
  }));

  expect(fullscreenFonts.front).toBe("30px");
  expect(fullscreenFonts.back).toBe("24px");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:smoke -- --grep "fullscreen study mode uses dedicated font variables"`
Expected: FAIL because fullscreen still uses hardcoded `28px` and `20px`.

- [ ] **Step 3: Write minimal implementation**

```js
document.documentElement.style.setProperty("--card-content-font-front-fullscreen", `${cardContentPreferences.fullscreenFrontFontSize}px`);
document.documentElement.style.setProperty("--card-content-font-back-fullscreen", `${cardContentPreferences.fullscreenBackFontSize}px`);
```

```css
.card-container.fullscreen-active .card-content {
  font-size: var(--card-content-font-front-fullscreen);
}

.card-container.fullscreen-active .card-back .card-content {
  font-size: var(--card-content-font-back-fullscreen);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:smoke -- --grep "fullscreen study mode uses dedicated font variables"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/features/study/study.js tests/smoke/app-smoke.spec.js
git commit -m "feat: apply dedicated fullscreen study typography"
```

### Task 4: Make Raw Code View Expand to Content Height Without Resize

**Files:**
- Modify: `index.html`
- Modify: `src/features/editor/editor-render.js`
- Modify: `src/features/editor/editor-events.js`
- Modify: `src/features/editor/editor-state.js`
- Modify: `tests/smoke/app-smoke.spec.js`

- [ ] **Step 1: Write the failing smoke test**

```js
test("raw code view expands to content height and disables manual resize", async ({ page }) => {
  // open editor raw mode with long content
  const rawMetrics = await page.evaluate(() => {
    const raw = document.querySelector("#editor-raw-input");
    const styles = getComputedStyle(raw);
    return {
      resize: styles.resize,
      clientHeight: Math.round(raw.clientHeight),
      scrollHeight: Math.round(raw.scrollHeight),
    };
  });

  expect(rawMetrics.resize).toBe("none");
  expect(Math.abs(rawMetrics.clientHeight - rawMetrics.scrollHeight)).toBeLessThanOrEqual(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:smoke -- --grep "raw code view expands to content height and disables manual resize"`
Expected: FAIL because raw view still uses `resize: vertical` and persisted manual height.

- [ ] **Step 3: Write minimal implementation**

```js
function syncRawEditorHeight(rawInput) {
  if (!rawInput) return;
  rawInput.style.height = "auto";
  rawInput.style.height = `${rawInput.scrollHeight}px`;
}
```

```js
export function saveRawEditorState(draft, rawInput) {
  draft.rawEditorState = ensureEditorRawState({
    ...draft.rawEditorState,
    scrollTop: rawInput.scrollTop || 0,
    selectionStart: rawInput.selectionStart,
    selectionEnd: rawInput.selectionEnd,
    shouldRestoreFocus: document.activeElement === rawInput,
  });
}
```

```css
.editor-raw {
  resize: none;
  overflow: auto;
}
```

Also remove height as a user-managed field from raw state normalization so re-renders always recompute from content.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:smoke -- --grep "raw code view expands to content height and disables manual resize"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/features/editor/editor-render.js src/features/editor/editor-events.js src/features/editor/editor-state.js tests/smoke/app-smoke.spec.js
git commit -m "feat: auto-size raw editor content"
```

### Task 5: Remove Delayed Navigation from Flipped Cards

**Files:**
- Modify: `index.html`
- Modify: `src/features/study/study.js`
- Modify: `src/features/study/assessment.js`
- Modify: `tests/smoke/app-smoke.spec.js`

- [ ] **Step 1: Write the failing smoke test**

```js
test("navigating from a flipped card advances immediately", async ({ page }) => {
  await seedLocalSets(page, {
    sets: {
      flow: {
        setName: "Flow Demo",
        fileName: "flow-demo.json",
        cards: [
          { id: "flow-1", q: "Birinci soru", a: "Birinci cevap", subject: "Genel" },
          { id: "flow-2", q: "Ikinci soru", a: "Ikinci cevap", subject: "Genel" },
        ],
      },
    },
    selectedSetIds: ["flow"],
  });

  await page.locator("#start-btn").click();
  await page.locator("#flashcard").click();
  await expect(page.locator("#flashcard")).toHaveClass(/flipped/);

  await page.locator("#next-btn").click();
  await expect(page.locator("#question-text")).toHaveText("Ikinci soru");
  await expect(page.locator("#flashcard")).not.toHaveClass(/flipped/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:smoke -- --grep "navigating from a flipped card advances immediately"`
Expected: FAIL or flake because the current card transition still waits on the flip-back timing.

- [ ] **Step 3: Write minimal implementation**

```js
function resetFlippedState({ instant = false } = {}) {
  const flashcard = document.getElementById("flashcard");
  if (!flashcard || !isFlipped) return;

  if (instant) flashcard.classList.add("card--instant-reset");
  flashcard.classList.remove("flipped");
  setIsFlipped(false);
  showAssessmentPanel(false);
  if (instant) requestAnimationFrame(() => flashcard.classList.remove("card--instant-reset"));
}

export const nextCard = () => {
  if (currentCardIndex >= filteredFlashcards.length - 1) return;
  resetFlippedState({ instant: true });
  setCurrentCardIndex(currentCardIndex + 1);
  displayCard();
};
```

```css
.card.card--instant-reset .card-face {
  transition: none !important;
}
```

Also update auto-advance and any shared display path so the same instant reset is reused instead of duplicating logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:smoke -- --grep "navigating from a flipped card advances immediately"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/features/study/study.js src/features/study/assessment.js tests/smoke/app-smoke.spec.js
git commit -m "fix: advance study cards without flip delay"
```

### Task 6: Full Verification and Cleanup

**Files:**
- Modify: `tests/smoke/app-smoke.spec.js`
- Modify: `tests/unit/study-state-sync.test.js`
- Review: `index.html`
- Review: `src/features/study/study.js`
- Review: `src/features/editor/editor-render.js`
- Review: `src/features/editor/editor-events.js`

- [ ] **Step 1: Run focused smoke coverage**

Run: `npm run test:smoke -- --grep "card content settings panel supports normal and fullscreen font sizes with reset|fullscreen study mode uses dedicated font variables|raw code view expands to content height and disables manual resize|navigating from a flipped card advances immediately"`
Expected: PASS

- [ ] **Step 2: Run focused unit coverage**

Run: `npm run test:unit -- tests/unit/study-state-sync.test.js`
Expected: PASS

- [ ] **Step 3: Run required workspace verification**

Run: `npm run test:smoke`
Expected: PASS

- [ ] **Step 4: Run full verification for touched areas**

Run: `npm run test:unit`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html src/app/bootstrap.js src/app/state.js src/core/platform-adapter.js src/features/auth/auth.js src/features/editor/editor-events.js src/features/editor/editor-render.js src/features/editor/editor-state.js src/features/study/assessment.js src/features/study/study.js src/features/study-state/study-state.js src/shared/constants.js src/shared/utils.js tests/smoke/app-smoke.spec.js tests/unit/study-state-sync.test.js
git commit -m "feat: improve study fonts raw editor and card flow"
```
