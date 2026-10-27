// Сквозные проверки готовности (Т08): безопасность окон, обновления без источника, соответствие
// docs/acceptance.md реальным тестам; установленное приложение — при DF_INSTALLED_EXE=<путь к Deep Focus.exe>.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { launchApp, removeUserData, ROOT, tempUserData } from './helpers';

// getLastWebPreferences есть в Electron, но не описан в его типах
interface WebPrefsSource {
  getLastWebPreferences(): Record<string, unknown> | undefined;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

test('безопасность: в коде нет ослабления окон, во всех страницах есть строгий CSP', () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (/nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false|enableRemoteModule/.test(text)) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
  for (const entry of ['app', 'widget', 'audio']) {
    const html = readFileSync(join(ROOT, 'src/renderer', entry, 'index.html'), 'utf8');
    expect(html, entry).toContain('Content-Security-Policy');
    expect(html, entry).toMatch(/default-src '(self|none)'/);
expect(html, entry).toContain("script-src 'self'");
    expect(html, entry).not.toContain("'unsafe-eval'");
  }
});

test('безопасность: главное окно и виджет созданы с contextIsolation и sandbox, без nodeIntegration; обновления без источника', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed()).length), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2);
    const prefs = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().map((w) => {
        const p = (w.webContents as unknown as WebPrefsSource).getLastWebPreferences() ?? {};
        return { contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, webviewTag: p.webviewTag };
      }),
    );
    expect(prefs.length).toBeGreaterThanOrEqual(2);
    for (const p of prefs) expect(p).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false });
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));

    // Обновления: источник [GITHUB_OWNER]/[GITHUB_REPO] не заполнен — кнопка показывает «источник не настроен»
    await page.evaluate(() => {
      window.location.hash = '#/settings/general';
    });
    const button = page.locator('[data-action="check-updates"]');
    await button.waitFor();
    await button.click();
    await expect(page.locator('[data-update-message="disabled"]')).toContainText('не настроен');
    const status = await page.evaluate(() => window.deepFocus.app.updateStatus());
    expect(status).toEqual({ state: 'disabled', version: null, reasonKey: 'updates.notConfigured' });
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

const SCENARIOS = 17;

test('docs/acceptance.md: все 17 сценариев сопоставлены, указанные файлы существуют', () => {
  const text = readFileSync(join(ROOT, 'docs/acceptance.md'), 'utf8');
  const rows = text.split('\n').filter((line) => /^\|\s*\d+\s*\|/.test(line));
  expect(rows.map((r) => Number(/^\|\s*(\d+)\s*\|/.exec(r)![1]))).toEqual(Array.from({ length: SCENARIOS }, (_, i) => i + 1));
  const missing: string[] = [];
  for (const row of rows) {
    const files = [...row.matchAll(/`((?:src|tests|docs)\/[^`\s]+)`/g)].map((m) => m[1]!);
    expect(files.length, row.slice(0, 40)).toBeGreaterThan(0);
    for (const f of files) if (!existsSync(join(ROOT, f))) missing.push(f);
  }
  expect(missing).toEqual([]);
});

const installedExe = process.env.DF_INSTALLED_EXE;

test('установленное приложение: запуск, база, безопасность окна, обновления, автозапуск выключен без согласия', async () => {
  test.skip(!installedExe, 'нужен DF_INSTALLED_EXE — путь к Deep Focus.exe установленной сборки');
  const userData = tempUserData();
  try {
    const env: Record<string, string> = {};
    for (const [k, val] of Object.entries(process.env)) {
      if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
    }
    env.DEEPFOCUS_USER_DATA = userData;
    const app = await electron.launch({ executablePath: installedExe, args: [], env });
    const page = await app.firstWindow();
    await page.waitForSelector('nav [data-section="home"]');
    expect(await app.evaluate(({ app: a }) => a.isPackaged)).toBe(true);
    // база открылась (нативный better-sqlite3 из установленной сборки), модули без ошибок
    const modules = await page.evaluate(() => window.deepFocus.app.modules());
    expect(modules.filter((m) => m.state !== 'ok')).toEqual([]);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(async () => (await page.evaluate(() => window.deepFocus.timer.snapshot())).status).toBe('running');
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    const sessions = await page.evaluate(() => window.deepFocus.analytics.history({ from: 0, to: Date.now() + 86_400_000 }));
    expect(sessions).toHaveLength(1);
    // звуковые файлы и значки трея лежат в ресурсах
    const res = await app.evaluate(({ app: a }) => a.getAppPath());
    expect(existsSync(join(res, '..', 'assets', 'sounds'))).toBe(true);
    expect(existsSync(join(res, '..', 'icons', 'tray-idle.png'))).toBe(true);
    // обновления: источник не настроен
    expect(await page.evaluate(() => window.deepFocus.app.updateStatus())).toMatchObject({ state: 'disabled', reasonKey: 'updates.notConfigured' });
    // автозапуск включается только по настройке пользователя
    const login = await app.evaluate(({ app: a }) => a.getLoginItemSettings().openAtLogin);
    expect(login).toBe(false);
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => (w.webContents as unknown as WebPrefsSource).getLastWebPreferences()));
    for (const p of prefs) expect(p).toMatchObject({ contextIsolation: true, sandbox: true, nodeIntegration: false });
    await app.close();
  } finally {
    removeUserData(userData);
  }
});
