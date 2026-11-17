import {defineConfig} from '@playwright/test';
import base from './playwright.commissioning.config.mjs';
export default defineConfig({...base,testMatch:'payment-alerts.browser.spec.mjs',outputDir:'.tmp/payment-alerts-browser'});
