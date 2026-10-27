import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  outputDir: '../node_modules/.cache/playwright-results',
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4200',
    browserName: 'chromium',
    channel: process.env['PLAYWRIGHT_CHANNEL'] ?? 'chrome',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 320, height: 900 }, isMobile: true, hasTouch: true },
    },
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:4200',
    reuseExistingServer: !process.env['CI'],
    timeout: 120000,
  },
});
