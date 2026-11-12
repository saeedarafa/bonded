// QA-47: cross-device layout check of the static site in web/ (landing + /j/).
// Run: npm --prefix qa/web ci && npx --prefix qa/web playwright install chromium webkit firefox
//      npm --prefix qa/web test            (CI: bash qa/ci/web.sh)
import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.WEB_PORT || 4173);
const android = devices['Galaxy S8']; // Chrome on Android: isMobile, touch, DPR 3
const iphone = devices['iPhone 13']; // Mobile Safari

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 4 : 6,
  timeout: 60_000,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'off',
  },
  webServer: {
    command: `node serve.mjs ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    // Chromium, Android phones (the PO's friend's phone broke the notes section, 2026-11-12)
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
    { name: 'galaxy-s8', use: { ...devices['Galaxy S8'] } }, // 360x740
    { name: 'galaxy-s9plus', use: { ...devices['Galaxy S9+'] } },
    { name: 'android-360x640', use: { ...android, viewport: { width: 360, height: 640 } } },
    // WebKit, iPhones and iPad
    { name: 'iphone-13', use: { ...devices['iPhone 13'] } },
    { name: 'iphone-se', use: { ...devices['iPhone SE'] } }, // 1st gen, 320x568
    { name: 'iphone-se-3', use: { ...devices['iPhone SE (3rd gen)'] } }, // 375x667, as REL-B
    { name: 'iphone-pro-402x874', use: { ...iphone, viewport: { width: 402, height: 874 } } },
    { name: 'ipad-mini', use: { ...devices['iPad Mini'] } },
    // Desktop
    { name: 'desktop-chrome-1366x768', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'desktop-safari-1440x900', use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-firefox-1366x768', use: { ...devices['Desktop Firefox'], viewport: { width: 1366, height: 768 } } },
  ],
});
