import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end smoke tests against the production build. They cover everything that works without signing in
 * (routing, validation, PWA install and offline start, mobile layout). The build points at a placeholder
 * Supabase project so no real account or data is ever touched; signed-in flows are covered by the
 * component tests and the database tests in supabase/tests.
 */
const PORT = 4174

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://placeholder-project.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'placeholder-anon-key',
    },
  },
})
