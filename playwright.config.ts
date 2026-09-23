import { defineConfig, devices } from "@playwright/test";

const chromiumWidths = [320, 390, 768, 1024, 1440];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [["list"], ["html", { outputFolder: "output/playwright/report", open: "never" }]],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    ...chromiumWidths.map((width) => ({
      name: `chromium-${width}`,
      use: { ...devices[width === 390 ? "Pixel 7" : "Desktop Chrome"], viewport: { width, height: width <= 390 ? 780 : 900 } },
    })),
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], viewport: { width: 390, height: 844 } } },
    { name: "webkit-desktop", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev:web -- --port 5174 --strictPort",
    env: { VITE_API_URL: "" },
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
