import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    setupFiles: ['tests/setup.js'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 5000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 64,
        branches: 53,
        functions: 64,
        lines: 67
      },
      include: [
        'core/**/*.js',
        'background/**/*.js',
        'ntp/modules/**/*.js'
      ]
    }
  }
});