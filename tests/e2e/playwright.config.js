// Playwright config for the user-tournaments e2e suite. One worker, one DB, one fake
// process: spec files run serially and each seeds its own data (README.md › Testing).
import { defineConfig, devices } from '@playwright/test'
import { APP_ENV, APP_URL, DB_STACK_PORT, FAKES_PORT, FAKES_URL, ROOT_DIR } from './support/env.js'

export default defineConfig({
  testDir: './specs',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list'], ['html', { open: 'on-failure', outputFolder: `${ROOT_DIR}/playwright-report` }]],
  outputDir: `${ROOT_DIR}/test-results`,
  use: {
    baseURL: APP_URL,
    locale: 'en-GB',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'api', testMatch: /harness\.spec\.js/ },
    {
      name: 'desktop',
      testIgnore: /harness\.spec\.js/,
      grepInvert: /@mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'mobile',
      testIgnore: /harness\.spec\.js/,
      grep: /@mobile/,
      use: { ...devices['Pixel 5'], viewport: { width: 375, height: 667 } },
    },
  ],
  // Torn down in reverse order, after the tests: the app first, Postgres last.
  webServer: [
    {
      command: 'node tests/e2e/db-stack.mjs',
      url: `http://localhost:${DB_STACK_PORT}/health`,
      cwd: ROOT_DIR,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
    },
    {
      command: 'node tests/e2e/fakes/server.mjs',
      url: `${FAKES_URL}/__control/health`,
      env: { PORT: String(FAKES_PORT) },
      cwd: ROOT_DIR,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'node tests/e2e/app-server.mjs',
      url: `${APP_URL}/api/config`,
      env: APP_ENV,
      cwd: ROOT_DIR,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
