import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  timeout: 30_000,
  reporter: 'list',
  outputDir: './.test-results',
  use: { baseURL: 'http://127.0.0.1:3095', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'phone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'npm run serve -- --host 127.0.0.1 --port 3095',
    url: 'http://127.0.0.1:3095',
    timeout: 60_000,
    reuseExistingServer: false,
  },
});
