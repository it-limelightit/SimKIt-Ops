import {defineConfig} from '@playwright/test';
import base from './playwright.finance.config.mjs';
export default defineConfig({...base,testMatch:'inventory-history.browser.spec.mjs',outputDir:'.tmp/inventory-history-browser'});
