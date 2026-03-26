/** @type {import('@playwright/test').PlaywrightTestConfig} */
const testPort = Number(process.env.FLASHCARDS_TEST_PORT || 4173);

module.exports = {
  testDir: "./tests/smoke",
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: "node tools/test-static-server.js",
    url: `http://127.0.0.1:${testPort}`,
    timeout: 30_000,
    reuseExistingServer: !process.env.CI,
  },
};
