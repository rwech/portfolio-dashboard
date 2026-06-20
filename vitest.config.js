import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      include: ['src/**', 'api/**'],
      thresholds: {
        statements: 99,
        branches: 90,
        functions: 99,
        lines: 99,
      },
    },
  },
});
