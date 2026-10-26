import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './tests', testMatch: ['cms.spec.ts', 'analytics.spec.ts', 'seo.spec.ts'], fullyParallel: false, workers: 1, timeout: 30_000,
  outputDir: 'test-results/cms',
  use: { baseURL: 'http://127.0.0.1:8198', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: { command: 'node tests/cms-server.mjs', url: 'http://127.0.0.1:8198/healthz', reuseExistingServer: false, timeout: 120_000 },
})
