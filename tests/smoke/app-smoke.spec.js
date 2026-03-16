const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("playwright/test");

function appUrl() {
  const indexPath = path.resolve(process.cwd(), "dist", "index.html");
  return pathToFileURL(indexPath).toString();
}

test.describe("Flashcards smoke", () => {
  async function loadFixtureAndStart(page) {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "smoke-set.json",
    );

    await page.addInitScript(() => localStorage.clear());
    await page.goto(appUrl());
    await page.setInputFiles("#file-picker", fixturePath);
    await page.locator("#start-btn").click();
  }

  test("set manager flow works from upload to start", async ({ page }) => {
    const fixturePath = path.resolve(
      process.cwd(),
      "tests",
      "fixtures",
      "smoke-set.json",
    );

    await page.addInitScript(() => localStorage.clear());
    await page.goto(appUrl());

    const setManager = page.locator("#set-manager");
    const appContainer = page.locator("#app-container");
    const startButton = page.locator("#start-btn");

    await expect(setManager).toBeVisible();
    const themeToggleSwitch = page.locator("#set-manager .toggle-switch").first();
    await expect(themeToggleSwitch).toBeVisible();

    await themeToggleSwitch.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBe("dark");

    await themeToggleSwitch.click();
    await expect
      .poll(async () => page.evaluate(() => document.documentElement.getAttribute("data-theme")))
      .toBeNull();

    await page.setInputFiles("#file-picker", fixturePath);
    await expect(page.locator("#set-list .set-title", { hasText: "Smoke Flashcard Set" })).toBeVisible();
    await expect(startButton).toBeEnabled();

    await startButton.click();
    await expect(appContainer).toBeVisible();
    await expect(setManager).toBeHidden();
  });

  test("subject label is only under the card, not next to the counter", async ({ page }) => {
    await loadFixtureAndStart(page);

    const navInfo = page.locator(".navigation .card-info");
    await expect(navInfo.locator("#card-counter")).toBeVisible();
    await expect(navInfo.locator(".subject-display, .subject-badge, #subject-display-front")).toHaveCount(0);
    await expect(navInfo).not.toContainText("Genel");

    await expect(page.locator("#subject-display-front")).toBeVisible();
    await expect(page.locator("#subject-display-front")).toHaveText("Genel");
    await expect(page.locator("#card-counter")).toHaveText("1 / 1");
  });
});
