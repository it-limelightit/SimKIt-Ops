import { defineConfig } from "@playwright/test";
import base from "./playwright.finance.config.mjs";

export default defineConfig({
  ...base,
  testMatch: "installation-inventory.browser.spec.mjs",
  outputDir: ".tmp/installation-inventory-browser",
});
