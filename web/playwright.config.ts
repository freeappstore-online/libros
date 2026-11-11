import { defineConfig, devices } from '@playwright/test'

// End-to-end tests against the production build (books#16). Hugging Face is
// stubbed in e2e/fixtures.ts with silent WAVs and generated timings.
const PORT = 4318
const baseURL = `http://localhost:${PORT}`
// The offline edge cases run against their own server (e2e/edge/server.ts)
const EDGE_PORT = 4319
// The Spanish interface (books#54): a build of the Spanish test edition (test/edition-es/README.md)
const ES_PORT = 4320

const chrome = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1200, height: 800 },
  // Auto-advance starts the next chapter outside a click
  launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
}

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  // The service worker precaches the app in every new context; tests that need it allow it
  use: { baseURL, trace: 'retain-on-failure', serviceWorkers: 'block' },
  webServer: [
    {
      // Built from the test edition, so a language app runs the same tests (test/edition/README.md)
      command: `BOOKS_EDITION=test/edition vite build && vite preview --port ${PORT} --strictPort`,
      url: baseURL,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      // Serves dist/ as built by the command above (tests start once both are up)
      command: `node e2e/edge/server.ts ${EDGE_PORT}`,
      url: `http://localhost:${EDGE_PORT}/__e2e`,
      reuseExistingServer: false,
    },
    {
      // In .cache/, which the platform's compliance check skips like dist/
      command: `BOOKS_EDITION=test/edition-es vite build --outDir .cache/dist-es && vite preview --outDir .cache/dist-es --port ${ES_PORT} --strictPort`,
      url: `http://localhost:${ES_PORT}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: 'chromium', testIgnore: ['edge/**', 'es/**'], use: chrome },
    {
      name: 'firefox',
      testIgnore: ['edge/**', 'es/**'],
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1200, height: 800 },
        launchOptions: { firefoxUserPrefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 } },
      },
    },
    { name: 'webkit', testIgnore: ['edge/**', 'es/**'], use: { ...devices['iPhone 13'] } },
    // Playwright runs (and routes) service workers in Chromium only
    {
      name: 'edge',
      testMatch: 'edge/**/*.spec.ts',
      use: { ...chrome, baseURL: `http://localhost:${EDGE_PORT}`, serviceWorkers: 'allow' },
    },
    { name: 'es', testMatch: 'es/**/*.spec.ts', use: { ...chrome, baseURL: `http://localhost:${ES_PORT}` } },
  ],
})
