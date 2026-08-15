import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['line']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:8790',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --import tsx e2e/server.ts',
    url: 'http://127.0.0.1:8790/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
