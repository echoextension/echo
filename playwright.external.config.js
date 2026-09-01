import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/external',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 30_000 },
  outputDir: 'test-results/external',
  reporter: [
    ['line'],
    ['json', { outputFile: 'external-contract-report.json' }],
    ['html', { open: 'never', outputFolder: 'external-playwright-report' }]
  ],
  use: {
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
