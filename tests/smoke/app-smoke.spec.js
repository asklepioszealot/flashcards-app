const path = require("path");
const { test, expect } = require("playwright/test");

const APP_NAMESPACE = "fc_v2";
const MOCK_SESSION_KEY = `${APP_NAMESPACE}::mock::session`;
const AUTH_REMEMBER_ME_KEY = `${APP_NAMESPACE}::auth::remember_me`;
const APP_PORT = Number(process.env.FLASHCARDS_TEST_PORT || 4173);
const DEMO_USER = {
  id: "demo-demo-local-flashcards",
  email: "demo@local.flashcards",
  provider: "demo",
};

function appUrl() {
  return `http://127.0.0.1:${APP_PORT}/`;
}

function legacyCardId(question) {
  let h = 0;
  for (let i = 0; i < question.length; i++) {
    h = ((h << 5) - h + question.charCodeAt(i)) | 0;
  }
  return `c${Math.abs(h)}`;
}

function userScopedKey(userId, key) {
  return `${APP_NAMESPACE}::user::${userId}::${key}`;
}

async function readUserScopedJson(page, key, userId = DEMO_USER.id) {
  return page.evaluate(
    ({ storageKey }) => JSON.parse(localStorage.getItem(storageKey) || "{}"),
    { storageKey: userScopedKey(userId, key) },
  );
}

async function readUserScopedText(page, key, userId = DEMO_USER.id) {
  return page.evaluate(
    ({ storageKey }) => localStorage.getItem(storageKey),
    { storageKey: userScopedKey(userId, key) },
  );
}

async function readStorageValue(page, storageType, key) {
  return page.evaluate(
    ({ storageType, key }) => {
      const targetStorage = storageType === "session" ? sessionStorage : localStorage;
      return targetStorage.getItem(key);
    },
    { storageType, key },
  );
}

function normalizeSetForSeed(setId, setData) {
  const fileName = setData.fileName || `${setId}.json`;
  const sourceFormat =
    setData.sourceFormat || (/\.(md|txt)$/i.test(fileName) ? "markdown" : "json");

  return {
    id: setId,
    slug: setData.slug || setId,
    setName: setData.setName || setId,
    fileName,
    sourceFormat,
    sourcePath: setData.sourcePath || "",
    rawSource: setData.rawSource || "",
    cards: (setData.cards || []).map((card, index) => ({
      id: card.id || `${setId}-card-${index + 1}`,
      q: card.q,
      a: card.a,
      subject: card.subject || "Genel",
    })),
    updatedAt: setData.updatedAt || new Date().toISOString(),
  };
}

async function clearStorage(page) {
  await page.goto(appUrl());
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload();
}

async function seedLocalSets(page, { sets, selectedSetIds, assessments, session }) {
  await page.goto(appUrl());
  await page.evaluate(
    ({ sets, selectedSetIds, assessments, session, demoUser, mockSessionKey, appNamespace }) => {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(mockSessionKey, JSON.stringify(demoUser));
      const loadedSetIds = Object.keys(sets);
      localStorage.setItem(
        `${appNamespace}::user::${demoUser.id}::set_records`,
        JSON.stringify(Object.entries(sets).map(([setId, setData]) => ({ ...setData, id: setId }))),
      );
      localStorage.setItem(
        `${appNamespace}::user::${demoUser.id}::selected_sets`,
        JSON.stringify(selectedSetIds ?? loadedSetIds),
      );
      if (assessments) {
        localStorage.setItem(
          `${appNamespace}::user::${demoUser.id}::assessments`,
          JSON.stringify(assessments),
        );
      }
      if (session) {
        localStorage.setItem(
          `${appNamespace}::user::${demoUser.id}::session`,
          JSON.stringify(session),
        );
      }
    },
    {
      sets: Object.fromEntries(
        Object.entries(sets).map(([setId, setData]) => [
          setId,
          normalizeSetForSeed(setId, setData),
        ]),
      ),
      selectedSetIds,
      assessments,
      session,
      demoUser: DEMO_USER,
      mockSessionKey: MOCK_SESSION_KEY,
      appNamespace: APP_NAMESPACE,
    },
  );
  await page.reload();
}

async function continueWithDemo(page) {
  await page.goto(appUrl());
  const authScreen = page.locator("#auth-screen");
  if (await authScreen.isVisible()) {
    await page.locator("#auth-demo-btn").click();
  }
  await expect(page.locator("#set-manager")).toBeVisible();
}

async function loadFixtureAndStart(page) {
  const fixturePath = path.resolve(
    process.cwd(),
    "tests",
    "fixtures",
    "smoke-set.json",
  );

  await clearStorage(page);
  await continueWithDemo(page);
  await page.setInputFiles("#file-picker", fixturePath);
  await page.locator("#start-btn").click();
}

async function jumpToCard(page, cardNumber) {
  await page.fill("#jump-input", String(cardNumber));
  await page.press("#jump-input", "Enter");
  await expect(page.locator("#card-counter")).toContainText(`${cardNumber} /`);
}

async function assessCurrentCard(page, level) {
  const flashcard = page.locator("#flashcard");
  const isFlipped = await flashcard.evaluate((node) =>
    node.classList.contains("flipped"),
  );
  if (!isFlipped) {
    await flashcard.click();
  }
  await page.locator(`#assessment-panel button.assess-btn.${level}`).click();
  await page.waitForTimeout(550);
}

async function setManagerAutoAdvance(page, enabled) {
  const input = page.locator("#auto-advance-toggle-manager");
  const toggleSwitch = page.locator(".toggle-switch", { has: input });
  const current = await input.isChecked();
  if (current !== enabled) {
    await toggleSwitch.click();
  }
  if (enabled) {
    await expect(input).toBeChecked();
    return;
  }
  await expect(input).not.toBeChecked();
}

test.describe("Flashcards smoke", () => {
  test("set manager flow works from upload to start", async ({ page }) => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "smoke-set.json",
    );

    await clearStorage(page);

    await expect(page.locator("#auth-screen")).toBeVisible();
    await expect(page.locator("#theme-select-auth")).toBeVisible();
    await expect(page.locator("#theme-select-auth option")).toHaveText([
      "☀️⛅ AYDINLIK",
      "🌑🌃 KARANLIK",
      "🟫🟧 AMBER",
      "🟦🟪 MAVİ",
    ]);
    await expect(page.locator("#auth-demo-btn")).toBeVisible();
    await page.locator("#auth-demo-btn").click();

    const setManager = page.locator("#set-manager");
    const appContainer = page.locator("#app-container");
    const startButton = page.locator("#start-btn");
    const setManagerHint = setManager.locator(".kbd-hint");

    await expect(setManager).toBeVisible();
    await expect(setManagerHint).toBeVisible();
    await expect(setManagerHint).toContainText("Space");
    await expect(setManagerHint).toContainText("S");
    await expect(setManagerHint).toContainText("F");
    const themeSelect = page.locator("#theme-select-manager");
    await expect(themeSelect).toBeVisible();

    await themeSelect.selectOption("dark");
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBe("dark");

    await themeSelect.selectOption("ember");
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBe("ember");

    await themeSelect.selectOption("light");
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme")),
      )
      .toBeNull();

    await page.setInputFiles("#file-picker", fixturePath);
    await expect(
      page.locator("#set-list .set-title", { hasText: "Smoke Flashcard Set" }),
    ).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(appContainer).toBeVisible();
    await expect(setManager).toBeHidden();
    await expect(appContainer.locator(".kbd-hint")).toHaveCount(0);
  });

  test("set list scrolls after two decks and bulk toggle selects all or none", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        alpha: {
          setName: "Alfa Seti",
          fileName: "alpha.json",
          cards: [{ q: "A1", a: "C1", subject: "Genel" }],
        },
        beta: {
          setName: "Beta Seti",
          fileName: "beta.json",
          cards: [{ q: "B1", a: "C2", subject: "Genel" }],
        },
        gamma: {
          setName: "Gamma Seti",
          fileName: "gamma.json",
          cards: [{ q: "G1", a: "C3", subject: "Genel" }],
        },
      },
      selectedSetIds: [],
    });

    await expect(page.locator("#set-manager")).toBeVisible();
    await expect(page.locator("#set-list-tools")).toBeVisible();
    await expect(page.locator("#set-bulk-toggle-meta")).toHaveText("3/3 seçili");
    await expect(page.locator("#set-bulk-menu-trigger")).toHaveCount(0);

    const scrollState = await page.locator("#set-list").evaluate((node) => ({
      className: node.className,
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
    }));
    expect(scrollState.className).toContain("set-list--scrollable");
    expect(scrollState.scrollHeight).toBeGreaterThan(scrollState.clientHeight);

    await page.locator("#set-bulk-toggle").click();
    await expect(page.locator("#set-bulk-toggle-meta")).toHaveText("0/3 seçili");
    await expect(page.locator("#start-btn")).toBeDisabled();
    await expect(page.locator('#set-list input[type="checkbox"]:checked')).toHaveCount(0);

    await page.locator("#set-bulk-toggle").click();
    await expect(page.locator("#set-bulk-toggle-meta")).toHaveText("3/3 seçili");
    await expect(page.locator("#start-btn")).toBeEnabled();
    await expect(page.locator('#set-list input[type="checkbox"]:checked')).toHaveCount(3);
  });

  test("remember me defaults to checked and persists mock auth to localStorage", async ({
    page,
  }) => {
    await clearStorage(page);

    await expect(page.locator("#auth-screen")).toBeVisible();
    await expect(page.locator("#auth-remember-me")).toBeChecked();

    await page.locator("#auth-demo-btn").click();
    await expect(page.locator("#set-manager")).toBeVisible();

    await expect.poll(async () => readStorageValue(page, "local", AUTH_REMEMBER_ME_KEY)).toBe("1");
    await expect.poll(async () => readStorageValue(page, "local", MOCK_SESSION_KEY)).not.toBeNull();
    await expect.poll(async () => readStorageValue(page, "session", MOCK_SESSION_KEY)).toBeNull();

    await page.reload();
    await expect(page.locator("#set-manager")).toBeVisible();
  });

  test("remember me off keeps mock auth in sessionStorage only", async ({ page }) => {
    await clearStorage(page);

    await expect(page.locator("#auth-screen")).toBeVisible();
    await page.locator("#auth-remember-me").uncheck();
    await page.locator("#auth-demo-btn").click();
    await expect(page.locator("#set-manager")).toBeVisible();

    await expect.poll(async () => readStorageValue(page, "local", AUTH_REMEMBER_ME_KEY)).toBe("0");
    await expect.poll(async () => readStorageValue(page, "local", MOCK_SESSION_KEY)).toBeNull();
    await expect.poll(async () => readStorageValue(page, "session", MOCK_SESSION_KEY)).not.toBeNull();

    await page.reload();
    await expect(page.locator("#set-manager")).toBeVisible();
  });

  test("edit mode opens separate editor and saves question text", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        editor: {
          setName: "Editor Demo",
          fileName: "editor-demo.md",
          sourcePath: "C:/fixtures/editor-demo.md",
          sourceFormat: "markdown",
          rawSource: "# Editor Demo\n\n### İlk soru\n\nAçıklama satırı",
          cards: [{ id: "card-1", q: "İlk soru", a: "Açıklama satırı", subject: "Genel" }],
        },
      },
      selectedSetIds: ["editor"],
    });

    await expect(page.locator("#set-manager")).toBeVisible();
    await expect(page.locator("#edit-mode-btn")).toHaveCount(0);
    await expect(page.locator("#delete-mode-btn")).toHaveCount(0);
    await expect(page.locator("#edit-selected-btn")).toBeEnabled();

    await page.locator("#edit-selected-btn").click();
    await expect(page.locator("#editor-screen")).toBeVisible();
    await expect(page.locator("#editor-screen")).not.toContainText("Araçlar üstte iki alan için ortaktır");
    await expect(page.locator("#editor-screen")).not.toContainText("Soru ve açıklama için ortak araçlar");
    await expect(page.locator("#editor-screen h1")).toHaveText("Kartları Düzenle");
    await expect(page.locator("#editor-add-card-btn")).toBeVisible();

    const questionInput = page.locator('[data-editor-field="question"]').first();
    await questionInput.fill("Düzenlenmiş soru");
    await page.locator("#editor-save-btn").click();
    await expect(page.locator("#editor-status")).toContainText("kaydedildi");

    const savedSetRecords = await page.evaluate(
      ({ storageKey }) => JSON.parse(localStorage.getItem(storageKey) || "[]"),
      { storageKey: userScopedKey(DEMO_USER.id, "set_records") },
    );
    expect(savedSetRecords[0].sourcePath).toBe("C:/fixtures/editor-demo.md");

    await page.locator("#editor-back-btn").click();
    await page.locator("#start-btn").click();
    await expect(page.locator("#question-text")).toHaveText("Düzenlenmiş soru");

    await page.reload();
    await expect(page.locator("#set-manager")).toBeVisible();
    await page.locator("#start-btn").click();
    await expect(page.locator("#question-text")).toHaveText("Düzenlenmiş soru");
  });

  test("editor uses a question list, preserves tables, and supports add/delete", async ({ page }) => {
    const tableAnswerHtml = [
      "<p>Laboratuvar değerlendirmesi:</p>",
      '<div class="markdown-table-wrap"><table><thead><tr><th>Tetkik</th><th>Yorum</th></tr></thead><tbody><tr><td>Hemogram + periferik yayma</td><td>Lökopeni</td></tr><tr><td>CRP</td><td>Antibiyotik cevabını en iyi gösteren belirteç</td></tr></tbody></table></div>',
    ].join("");

    await seedLocalSets(page, {
      sets: {
        editor: {
          setName: "Editor Navigation Demo",
          fileName: "editor-navigation-demo.md",
          sourceFormat: "markdown",
          rawSource: [
            "# Editor Navigation Demo",
            "",
            "### İlk soru",
            "Konu: Konu 1",
            "",
            "Laboratuvar değerlendirmesi:",
            "",
            "| Tetkik | Yorum |",
            "| --- | --- |",
            "| Hemogram + periferik yayma | Lökopeni |",
            "| CRP | Antibiyotik cevabını en iyi gösteren belirteç |",
            "",
            "### İkinci soru",
            "Konu: Konu 2",
            "",
            "İkinci cevap",
            "",
            "### Üçüncü soru",
            "Konu: Konu 3",
            "",
            "Üçüncü cevap",
          ].join("\n"),
          cards: [
            { id: "card-1", q: "İlk soru", a: tableAnswerHtml, subject: "Konu 1" },
            { id: "card-2", q: "İkinci soru", a: "<p>İkinci cevap</p>", subject: "Konu 2" },
            { id: "card-3", q: "Üçüncü soru", a: "<p>Üçüncü cevap</p>", subject: "Konu 3" },
          ],
        },
      },
      selectedSetIds: ["editor"],
    });

    await expect(page.locator("#edit-selected-btn")).toBeEnabled();
    await page.locator("#edit-selected-btn").click();
    await expect(page.locator("#editor-screen")).toBeVisible();

    await expect(page.locator("#editor-layout-list-btn")).toHaveCount(0);
    await expect(page.locator("#editor-layout-single-btn")).toHaveCount(0);
    await expect(page.locator("#editor-prev-btn")).toHaveCount(0);
    await expect(page.locator("#editor-jump-input")).toHaveCount(0);
    await expect(page.locator("[data-editor-toggle-list]")).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".editor-list-row")).toHaveCount(3);
    await expect(page.locator("#editor-screen")).not.toContainText("Aşağı çekerek büyüt");
    await expect(page.locator("#editor-screen")).not.toContainText("Yerleşim");
    await expect(page.locator('[data-editor-card-body="card-1"]')).toBeVisible();
    await expect(page.locator('[data-editor-card-root="card-1"] .editor-card-expand-btn')).toHaveCount(0);
    await expect(page.locator('[data-editor-select-card="card-1"]')).toHaveClass(/active/);
    await expect(page.locator('[data-toolbar-toggle="card-1"]')).toHaveCount(0);
    await expect(page.locator('[data-editor-field="answer"][data-card-id="card-1"]')).toHaveValue(
      /\| Tetkik \| Yorum \|/,
    );
    await expect(page.locator('[data-editor-preview="card-1"] table')).toBeVisible();
    await expect(page.locator('[data-editor-preview="card-1"] th')).toHaveText(["Tetkik", "Yorum"]);

    const compactHeights = await page.evaluate(() => {
      const question = document.querySelector('[data-editor-field="question"]');
      const answer = document.querySelector('[data-editor-field="answer"]');
      const preview = document.querySelector('[data-editor-preview]');
      return {
        question: question?.clientHeight ?? 0,
        answer: answer?.clientHeight ?? 0,
        preview: preview?.clientHeight ?? 0,
      };
    });
    expect(compactHeights.question).toBeGreaterThanOrEqual(150);
    expect(compactHeights.answer).toBeGreaterThanOrEqual(200);
    expect(Math.abs(compactHeights.answer - compactHeights.question)).toBeLessThanOrEqual(70);
    expect(compactHeights.preview).toBeGreaterThan(compactHeights.question);
    expect(compactHeights.preview).toBeGreaterThanOrEqual(compactHeights.answer);
    expect(compactHeights.preview - compactHeights.answer).toBeLessThanOrEqual(80);

    await page.locator('[data-editor-split-handle="card-1"]').focus();
    await page.keyboard.press("End");
    const splitWidthsBeforeToggle = await page.evaluate(() => {
      const answer = document.querySelector('[data-editor-field="answer"][data-card-id="card-1"]');
      const preview = document.querySelector('[data-editor-preview="card-1"]');
      return {
        answer: Math.round(answer?.getBoundingClientRect().width ?? 0),
        preview: Math.round(preview?.getBoundingClientRect().width ?? 0),
      };
    });
    expect(Math.abs(splitWidthsBeforeToggle.answer - splitWidthsBeforeToggle.preview)).toBeGreaterThanOrEqual(24);

    await page.locator("[data-editor-toggle-list]").click();
    await expect(page.locator("[data-editor-toggle-list]")).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator('[data-editor-card-body="card-1"]')).toBeVisible();
    await page.locator("[data-editor-toggle-list]").click();
    await expect(page.locator("[data-editor-toggle-list]")).toHaveAttribute("aria-expanded", "true");
    const splitWidthsAfterToggle = await page.evaluate(() => {
      const answer = document.querySelector('[data-editor-field="answer"][data-card-id="card-1"]');
      const preview = document.querySelector('[data-editor-preview="card-1"]');
      return {
        answer: Math.round(answer?.getBoundingClientRect().width ?? 0),
        preview: Math.round(preview?.getBoundingClientRect().width ?? 0),
      };
    });
    expect(Math.abs(splitWidthsAfterToggle.answer - splitWidthsAfterToggle.preview)).toBeGreaterThanOrEqual(24);
    expect(Math.abs(splitWidthsAfterToggle.answer - splitWidthsBeforeToggle.answer)).toBeLessThanOrEqual(24);
    expect(Math.abs(splitWidthsAfterToggle.preview - splitWidthsBeforeToggle.preview)).toBeLessThanOrEqual(24);

    await page.locator('[data-editor-select-card="card-2"]').click();
    await expect(page.locator('[data-editor-select-card="card-2"]')).toHaveClass(/active/);
    await expect(page.locator('[data-editor-field="question"][data-card-id="card-2"]')).toHaveValue(
      "İkinci soru",
    );

    await page.locator("#editor-add-card-btn").click();
    await expect(page.locator(".editor-list-row")).toHaveCount(4);
    await expect(page.locator('[data-editor-field="question"]')).toHaveValue("");
    await page.locator('[data-editor-field="question"]').fill("Yeni soru");
    await expect(page.locator(".editor-list-question").last()).toHaveText("Yeni soru");

    await page.locator("[data-editor-toggle-delete-mode]").click();
    await expect(page.locator('[data-editor-delete-select="card-2"]')).toBeVisible();
    await page.locator('[data-editor-delete-select="card-2"]').check();
    page.once("dialog", (dialog) => dialog.accept());
    await page.locator("[data-editor-delete-selected]").click();
    await expect(page.locator(".editor-list-row")).toHaveCount(3);
    await expect(page.locator('[data-editor-select-card="card-2"]')).toHaveCount(0);

    await page.locator("#editor-save-btn").click();
    await expect(page.locator("#editor-status")).toContainText("kaydedildi");

    const savedSetRecords = await page.evaluate(
      ({ storageKey }) => JSON.parse(localStorage.getItem(storageKey) || "[]"),
      { storageKey: userScopedKey(DEMO_USER.id, "set_records") },
    );
    expect(savedSetRecords[0].cards).toHaveLength(3);
    expect(savedSetRecords[0].cards.some((card) => card.q === "İkinci soru")).toBe(false);
    expect(savedSetRecords[0].cards.some((card) => card.q === "Yeni soru")).toBe(true);
    expect(savedSetRecords[0].rawSource).toContain("| Tetkik | Yorum |");
  });

  test("subject label is only under the card, not next to the counter", async ({
    page,
  }) => {
    await loadFixtureAndStart(page);

    const navInfo = page.locator(".navigation .card-info");
    await expect(navInfo.locator("#card-counter")).toBeVisible();
    await expect(
      navInfo.locator(".subject-display, .subject-badge, #subject-display-front"),
    ).toHaveCount(0);
    await expect(navInfo).not.toContainText("Genel");

    await expect(page.locator("#subject-display-front")).toBeVisible();
    await expect(page.locator("#subject-display-front")).toHaveText("Genel");
    await expect(page.locator("#card-counter")).toHaveText("1 / 1");
  });

  test("mobile viewport disables sticky header over the flashcard", async ({ page }) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await loadFixtureAndStart(page);
    await expect(page.locator("#app-container")).toBeVisible();

    const headerPosition = await page.locator(".header").evaluate((node) =>
      window.getComputedStyle(node).position,
    );
    expect(headerPosition).toBe("static");
  });

  test("desktop viewport keeps sticky header for the flashcard controls", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await loadFixtureAndStart(page);
    await expect(page.locator("#app-container")).toBeVisible();

    const headerStyles = await page.locator(".header").evaluate((node) => {
      const styles = window.getComputedStyle(node);
      return {
        position: styles.position,
        top: styles.top,
      };
    });
    expect(headerStyles.position).toBe("sticky");
    expect(headerStyles.top).toBe("20px");
  });

  test("jump input keeps Enter navigation and no longer shows a Git button", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        nav: {
          setName: "Gezinme Seti",
          fileName: "nav.json",
          cards: [
            { q: "Kart 1", a: "Cevap 1", subject: "Genel" },
            { q: "Kart 2", a: "Cevap 2", subject: "Genel" },
            { q: "Kart 3", a: "Cevap 3", subject: "Genel" },
          ],
        },
      },
      selectedSetIds: ["nav"],
    });

    await page.locator("#start-btn").click();
    await expect(page.locator('#app-container button', { hasText: "Git" })).toHaveCount(0);

    await jumpToCard(page, 3);
    await expect(page.locator("#question-text")).toHaveText("Kart 3");
  });

  test("resume exact card after reload", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Resume Demo",
          fileName: "resume-demo.json",
          cards: [
            { q: "Kart A", a: "Cevap A", subject: "Genel" },
            { q: "Kart B", a: "Cevap B", subject: "Genel" },
            { q: "Kart C", a: "Cevap C", subject: "Genel" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await page.locator("#next-btn").click();
    await page.locator("#next-btn").click();
    await expect(page.locator("#card-counter")).toHaveText("3 / 3");
    await expect(page.locator("#question-text")).toHaveText("Kart C");

    await page.reload();
    await page.locator("#start-btn").click();
    await expect(page.locator("#card-counter")).toHaveText("3 / 3");
    await expect(page.locator("#question-text")).toHaveText("Kart C");
  });

  test("assessment persistence without duplicates", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Persistence Demo",
          fileName: "persist-demo.json",
          cards: [
            { q: "Soru A?", a: "Cevap A", subject: "S1" },
            { q: "Soru B?", a: "Cevap B", subject: "S1" },
            { q: "Soru C?", a: "Cevap C", subject: "S2" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await assessCurrentCard(page, "review");

    await page.reload();
    await page.locator("#start-btn").click();

    await jumpToCard(page, 1);
    await expect(page.locator("#assessment-panel button.assess-btn.know")).toHaveClass(/selected/);
    await expect(page.locator("#assessment-panel button.assess-btn.review")).not.toHaveClass(
      /selected/,
    );

    await jumpToCard(page, 2);
    await expect(page.locator("#assessment-panel button.assess-btn.review")).toHaveClass(
      /selected/,
    );
    await expect(page.locator("#assessment-panel button.assess-btn.know")).not.toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await readUserScopedJson(page, "assessments");
    const setScopedEntries = Object.entries(assessmentSnapshot).filter(([key]) =>
      key.startsWith("set:"),
    );
    expect(
      setScopedEntries.filter(([, value]) => value === "know"),
    ).toHaveLength(1);
    expect(
      setScopedEntries.filter(([, value]) => value === "review"),
    ).toHaveLength(1);
  });

  test("clicking same assessment twice clears the card status", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Toggle Demo",
          fileName: "toggle-demo.json",
          cards: [
            { q: "Soru A?", a: "Cevap A", subject: "S1" },
            { q: "Soru B?", a: "Cevap B", subject: "S1" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");

    await jumpToCard(page, 1);
    await assessCurrentCard(page, "know");

    await expect(page.locator("#card-counter")).toHaveText("1 / 2");
    await expect(page.locator("#assessment-panel button.assess-btn.know")).not.toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("fc_assessments") || "{}"),
    );
    expect(Object.keys(assessmentSnapshot)).toHaveLength(0);
  });

  test("auto-advance toggle controls navigation and persists after refresh", async ({
    page,
  }) => {
    await seedLocalSets(page, {
      sets: {
        demo: {
          setName: "Auto Advance Demo",
          fileName: "auto-advance-demo.json",
          cards: [
            { q: "Kart 1?", a: "Cevap 1", subject: "S1" },
            { q: "Kart 2?", a: "Cevap 2", subject: "S1" },
          ],
        },
      },
      selectedSetIds: ["demo"],
    });

    await setManagerAutoAdvance(page, false);
    await expect(page.locator("#auto-advance-status")).toHaveText("OTOMATİK İLERLE ✕");
    await expect.poll(async () => readUserScopedText(page, "auto_advance")).toBe("0");

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await expect(page.locator("#card-counter")).toHaveText("1 / 2");

    await page.reload();
    await expect(page.locator("#auto-advance-status")).toHaveText("OTOMATİK İLERLE ✕");
    await setManagerAutoAdvance(page, false);

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "review");
    await expect(page.locator("#card-counter")).toHaveText("1 / 2");

    await page
      .locator("button.btn-small.btn-secondary", { hasText: "Setlere Dön" })
      .click();
    await setManagerAutoAdvance(page, true);
    await expect(page.locator("#auto-advance-status")).toHaveText("OTOMATİK İLERLE ✓");
    await expect.poll(async () => readUserScopedText(page, "auto_advance")).toBe("1");

    await page.locator("#start-btn").click();
    await jumpToCard(page, 1);
    await assessCurrentCard(page, "dunno");
    await expect(page.locator("#card-counter")).toHaveText("2 / 2");
  });

  test("duplicate question across sets is independent", async ({ page }) => {
    await seedLocalSets(page, {
      sets: {
        "set-a": {
          setName: "Set A",
          fileName: "set-a.json",
          cards: [{ q: "Aynı soru?", a: "Set A cevabı", subject: "A" }],
        },
        "set-b": {
          setName: "Set B",
          fileName: "set-b.json",
          cards: [{ q: "Aynı soru?", a: "Set B cevabı", subject: "B" }],
        },
      },
      selectedSetIds: ["set-a", "set-b"],
    });

    await page.locator("#start-btn").click();
    await assessCurrentCard(page, "know");
    await assessCurrentCard(page, "dunno");

    await page.reload();
    await page.locator("#start-btn").click();

    await jumpToCard(page, 1);
    await expect(page.locator("#assessment-panel button.assess-btn.know")).toHaveClass(/selected/);

    await jumpToCard(page, 2);
    await expect(page.locator("#assessment-panel button.assess-btn.dunno")).toHaveClass(
      /selected/,
    );

    const assessmentSnapshot = await readUserScopedJson(page, "assessments");
    const setScopedEntries = Object.entries(assessmentSnapshot).filter(([key]) =>
      key.startsWith("set:"),
    );
    expect(setScopedEntries).toHaveLength(2);
    expect(setScopedEntries.map(([, value]) => value).sort()).toEqual([
      "dunno",
      "know",
    ]);
  });

  test("legacy migration maps question-hash assessments to set-based keys", async ({
    page,
  }) => {
    const legacyQuestion = "Legacy soru?";
    const legacyKey = legacyCardId(legacyQuestion);

    await seedLocalSets(page, {
      sets: {
        legacy: {
          setName: "Legacy Set",
          fileName: "legacy-set.json",
          cards: [{ q: legacyQuestion, a: "Legacy cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["legacy"],
      assessments: { [legacyKey]: "review" },
      session: {
        currentCardIndex: 0,
        theme: "light",
        topic: "hepsi",
        activeFilter: "all",
      },
    });

    await page.locator("#start-btn").click();
    await expect(page.locator("#assessment-panel button.assess-btn.review")).toHaveClass(
      /selected/,
    );

    const migratedAssessments = await readUserScopedJson(page, "assessments");
    expect(migratedAssessments["set:legacy::id:legacy-card-1"]).toBe("review");
  });

  test("legacy state does not overwrite modern assessments on refresh", async ({
    page,
  }) => {
    await seedLocalSets(page, {
      sets: {
        stable: {
          setName: "Stable Set",
          fileName: "stable-set.json",
          cards: [{ q: "Stabil soru?", a: "Cevap", subject: "Genel" }],
        },
      },
      selectedSetIds: ["stable"],
      assessments: { "set:stable::id:stable-card-1": "know" },
    });

    await page.evaluate(() => {
      localStorage.setItem(
        "flashcards_state_v6",
        JSON.stringify({ assessments: {} }),
      );
    });

    await page.reload();
    await page.locator("#start-btn").click();
    await expect(page.locator("#assessment-panel button.assess-btn.know")).toHaveClass(/selected/);

    const snapshot = await readUserScopedJson(page, "assessments");
    expect(snapshot["set:stable::id:stable-card-1"]).toBe("know");
  });
test("fullscreen toggle works and card navigation remains functional", async ({ page }) => {
    await loadFixtureAndStart(page);

    const container = page.locator('.card-container');
    const fullscreenBtn = page.locator('#fullscreen-toggle-btn');

    await expect(fullscreenBtn).toBeVisible();

    await fullscreenBtn.click();
    await expect(container).toHaveClass(/fullscreen-active/);
    await expect(page.locator('.card-container.fullscreen-active #fullscreen-card-counter')).toBeVisible();
    await expect(page.locator('#fullscreen-nav-bar button')).toHaveCount(5);

    await page.locator('#flashcard').click();
    await expect(page.locator('#flashcard')).toHaveClass(/flipped/);

    await page.keyboard.press('Escape');
    await expect(container).not.toHaveClass(/fullscreen-active/);

    await page.keyboard.press('f');
    await expect(container).toHaveClass(/fullscreen-active/);

    await page.keyboard.press('f');
    await expect(container).not.toHaveClass(/fullscreen-active/);
  });
});
