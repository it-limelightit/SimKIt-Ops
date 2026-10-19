import { defineConfig } from "@playwright/test";
import { existsSync } from "node:fs";
const windowsChrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
export default defineConfig({
  testDir: "./tests",
  testMatch: "finance.browser.spec.mjs",
  fullyParallel: false,
  workers: 1,
  outputDir: ".tmp/finance-browser",
  timeout: 45000,
  use: {
    baseURL: "http://127.0.0.1:4181",
    headless: true,
    launchOptions: { ...(existsSync(windowsChrome) ? { executablePath: windowsChrome } : {}) },
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4181",
    url: "http://127.0.0.1:4181",
    reuseExistingServer: !process.env.CI,
    timeout: 90000,
    env: {
      VITE_SUPABASE_URL: "https://finance-test.supabase.co",
      VITE_SUPABASE_PROJECT_ID: "finance-test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
    },
  },
});
