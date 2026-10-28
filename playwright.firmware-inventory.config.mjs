import { defineConfig } from "@playwright/test";
import base from "./playwright.finance.config.mjs";
export default defineConfig({
  ...base,
  testMatch: "firmware-inventory.browser.spec.mjs",
  outputDir: ".tmp/firmware-inventory-browser",
});
