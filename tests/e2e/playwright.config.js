import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ensureBuildScript = resolve(__dirname, 'scripts/ensure-build.mjs')

/**
 * Playwright config for the Engagr Mini App auto-test harness.
 *
 * Strategy:
 *  - The Mini App is a static Vite build. We spin it up via `vite preview`
 *    (the `webServer` block below) and point tests at the preview URL.
 *  - All backend calls are intercepted with `page.route()` per-test, so the
 *    harness runs fully offline — no Railway backend, no Telegram, no
 *    extension needed. This is the "Browser MCP" style auto-test the user
 *    asked for: load the app, drive the Feed UI, assert behaviour, report.
 *  - A separate `action-selectors.spec.js` validates the LinkedIn/X/Reddit
 *    DOM selectors the extension relies on, against saved fixture HTML, so
 *    we catch selector drift before it breaks posting in production.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },

  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    viewport: { width: 390, height: 844 }, // iPhone-ish Mini App size
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  // Spin up the built Mini App. The ensure-build script builds the Vite
  // production bundle on first run, then `vite preview` serves it. The script
  // path is resolved absolutely here because webServer runs from `cwd`.
  webServer: {
    command: `node ${ensureBuildScript} && npx vite preview --port 4173 --strictPort`,
    cwd: '../../frontend',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
