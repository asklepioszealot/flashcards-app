const path = require("path");
const { pathToFileURL } = require("url");
const { test, expect } = require("playwright/test");

function appUrl() {
  const indexPath = path.resolve(process.cwd(), "index.html");
  return pathToFileURL(indexPath).toString();
}

test.describe("Flashcards smoke", () => {
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
});
