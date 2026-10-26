import {defineConfig} from '@playwright/test';
import base from './playwright.finance.config.mjs';
export default defineConfig({...base,testMatch:'company-source.browser.spec.mjs',outputDir:'.tmp/company-source-browser'});
