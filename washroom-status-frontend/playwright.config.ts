import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:56300',
    // Authenticated traces contain bearer tokens; retain only visual failure evidence.
    trace: 'off',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    geolocation: { latitude: 39.9526, longitude: -75.1652 },
    permissions: ['geolocation'],
  },
  webServer: {
    command: 'node e2e/start.mjs',
    url: 'http://127.0.0.1:56300',
    timeout: 600_000,
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 30_000 },
  },
});
