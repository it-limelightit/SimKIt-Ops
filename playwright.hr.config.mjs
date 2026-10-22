import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: "hr.browser.spec.mjs",
  workers: 1,
  outputDir: ".tmp/hr-browser",
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: "http://127.0.0.1:4182",
    headless: true,
    launchOptions: { ...(existsSync(chrome) ? { executablePath: chrome } : {}) },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4182",
    url: "http://127.0.0.1:4182",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: {
      VITE_SUPABASE_URL: "https://hr-test.supabase.co",
      VITE_SUPABASE_PROJECT_ID: "hr-test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
