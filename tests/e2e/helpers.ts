// Общие помощники e2e: запуск собранного приложения с отдельной папкой данных.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';

export const ROOT = resolve(__dirname, '../..');

export function tempUserData(): string {
  return mkdtempSync(join(tmpdir(), 'df-e2e-'));
}

/** Удаляет временную папку данных; файлы Chromium могут быть заняты ещё секунду после выхода. */
export function removeUserData(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // не мешаем результату теста: временная папка останется в %TEMP%
  }
}

export async function launchApp(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) {
    if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
  }
  env.DEEPFOCUS_USER_DATA = userData;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const page = await app.firstWindow();
  await page.waitForSelector('nav [data-section="home"]');
  return { app, page };
}

/** Запуск, когда первым может открыться не главное окно (идущая сессия: виджет, окно audio) — главное ищем по адресу. */
export async function launchMain(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) {
    if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
  }
  env.DEEPFOCUS_USER_DATA = userData;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const isMain = (p: Page) => /\/app\/index\.html/.test(p.url());
  let page: Page | undefined;
  await expect.poll(() => (page = app.windows().find(isMain)) !== undefined, { timeout: 30_000 }).toBe(true);
  await page!.waitForSelector('nav [data-section="home"]');
  return { app, page: page! };
}
