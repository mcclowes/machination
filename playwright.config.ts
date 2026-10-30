import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './visual-tests',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  updateSnapshots: 'none',
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.001 } },
  use: {
    baseURL: 'http://127.0.0.1:3094',
    contextOptions: { reducedMotion: 'reduce' },
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run web -- --port 3094',
    url: 'http://127.0.0.1:3094',
    timeout: 180_000,
    reuseExistingServer: false,
    env: { CI: '1', BROWSER: 'none', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: '' },
  },
});
