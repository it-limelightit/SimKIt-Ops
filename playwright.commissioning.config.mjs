import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome='C:/Program Files/Google/Chrome/Application/chrome.exe';
export default defineConfig({
  testDir:'./tests',testMatch:'commissioning-drive.browser.spec.mjs',workers:1,
  outputDir:'.tmp/commissioning-ui-browser',timeout:45000,
  use:{baseURL:'http://127.0.0.1:8080',headless:true,
    launchOptions:existsSync(chrome)?{executablePath:chrome}:{}},
});
