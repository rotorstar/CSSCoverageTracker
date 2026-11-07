import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test'

/** E2E against the fixture apps (plan D5). Run with `npm run e2e`. */
const config: PlaywrightTestConfig = defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5199' },
  webServer: [
    {
      command: 'npm --prefix fixtures/vite-app run dev -- --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npm --prefix fixtures/next16 run dev -- --port 5200',
      url: 'http://localhost:5200',
      reuseExistingServer: false,
      timeout: 120_000,
      env: { NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})

export default config
