import { defineConfig } from '@playwright/test';

// E2E против собранного приложения: сначала `npm run build`, затем `npm run e2e`.
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  workers: 1,
  reporter: [['list']],
});
