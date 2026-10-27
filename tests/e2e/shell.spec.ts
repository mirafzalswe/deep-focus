import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';
import { launchApp, removeUserData, ROOT, tempUserData } from './helpers';

test('оболочка: 7 разделов, безопасность окна, язык и тема без перезапуска, настройки переживают перезапуск', async () => {
  const userData = tempUserData();
  try {
    let { app, page } = await launchApp(userData);
    await expect(page).toHaveTitle('Deep Focus');

    const sections = await page.locator('nav [data-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    expect(sections).toEqual(['home', 'timer', 'sounds', 'blocker', 'tasks', 'analytics', 'settings']);

    // renderer изолирован: нет Node, есть только window.deepFocus
    const sandbox = await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
      api: Object.keys(window.deepFocus).sort(),
    }));
    expect(sandbox.require).toBe('undefined');
    expect(sandbox.process).toBe('undefined');
    expect(sandbox.api).toEqual(['analytics', 'app', 'audio', 'audioEngine', 'blocker', 'hotkeys', 'settings', 'tasks', 'timer', 'widget']);
    const renderers = await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().filter((m) => m.type === 'Tab').map((m) => m.sandboxed),
    );
    expect(renderers.length).toBeGreaterThan(0);
    expect(renderers.every(Boolean)).toBe(true);

    // вкладки настроек
    await page.click('nav [data-section="settings"]');
    await expect(page.locator('[role="tab"]')).toHaveCount(5);
    const tabs = await page.locator('[role="tab"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tab')));
    expect(tabs).toEqual(['timer', 'widget', 'blocker', 'sounds', 'general']);
    await page.click('[data-tab="general"]');

    // язык ru → en без перезапуска
    await expect(page.locator('nav [data-section="settings"]')).toHaveText('Настройки');
    await page.getByRole('radio', { name: 'English' }).click();
    await expect(page.locator('nav [data-section="settings"]')).toHaveText('Settings');

    // тема dark → light → system без перезапуска
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(238, 240, 242)');

    // журнал ошибок в userData/logs
    expect(await page.evaluate(() => window.deepFocus.app.logPath())).toBe(join(userData, 'logs', 'deepfocus.log'));

    // недопустимое значение отвергается main-процессом
    await expect(page.evaluate(() => window.deepFocus.settings.patch({ widget: { opacity: 5 } }))).rejects.toThrow(/SettingsError|Invalid/);

    await app.close();
    ({ app, page } = await launchApp(userData));
    await expect(page.locator('nav [data-section="settings"]')).toHaveText('Settings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(existsSync(join(userData, 'deepfocus.db'))).toBe(true);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('второй запуск не создаёт второй экземпляр, а показывает первое окно', async () => {
  const userData = tempUserData();
  try {
    const { app } = await launchApp(userData);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.minimize());
    const electronPath = (await import('electron')).default as unknown as string;
    const env: NodeJS.ProcessEnv = { ...process.env, DEEPFOCUS_USER_DATA: userData };
    delete env.ELECTRON_RUN_AS_NODE;
    const second = spawn(electronPath, [ROOT], { cwd: ROOT, env, stdio: 'ignore' });
    const code = await new Promise<number | null>((res) => second.on('exit', res));
    expect(code).toBe(0);
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => !w.isMinimized())))
      .toEqual([true]);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('повреждённая база переименовывается в .corrupt-<дата>, приложение запускается', async () => {
  const userData = tempUserData();
  try {
    writeFileSync(join(userData, 'deepfocus.db'), 'garbage '.repeat(1000));
    const { app, page } = await launchApp(userData);
    await expect(page.locator('nav [data-section]')).toHaveCount(7);
    expect(readdirSync(userData).some((f) => /^deepfocus\.db\.corrupt-\d{8}-\d{6}$/.test(f))).toBe(true);
    const presets = await page.evaluate(() => window.deepFocus.timer.presets());
    expect(presets.map((p) => p.focusMin)).toEqual([25, 45, 60, 90]);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('чужая file://-страница: переход на неё запрещён, а в отдельном окне с нашим preload IPC её не слушается', async () => {
  const userData = tempUserData();
  try {
    const evil = join(userData, 'dropped.html');
    writeFileSync(evil, '<!doctype html><title>dropped</title><p>dropped</p>', 'utf8');
    const evilUrl = pathToFileURL(evil).href;
    const { app, page } = await launchApp(userData);
    const ownUrl = page.url();
    expect(ownUrl).toMatch(/\/renderer\/app\/index\.html/);

    // перетащенный .html или переход по ссылке: главное окно остаётся на своей странице
    await page.evaluate((url) => (window.location.href = url), evilUrl);
    await page.waitForTimeout(1500);
    expect(page.url().split('#')[0]).toBe(ownUrl.split('#')[0]);
    // (локаторы Playwright ждали бы отменённую навигацию — проверяем страницу напрямую)
    expect(await page.evaluate(() => document.querySelector('nav [data-section="home"]') !== null)).toBe(true);

    // даже если чужая страница оказалась в окне с нашим preload, main не выполняет её запросы
    const preload = join(ROOT, 'out', 'preload', 'index.js');
    const result = await app.evaluate(
      async ({ BrowserWindow }, { file, preload }) => {
        const win = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true } });
        try {
          await win.loadFile(file);
          return (await win.webContents.executeJavaScript(
            'window.deepFocus.app.version().then((v) => "ok:" + v, (e) => "err:" + e.message)',
          )) as string;
        } finally {
          win.destroy();
        }
      },
      { file: evil, preload },
    );
    expect(result).toMatch(/^err:.*Untrusted IPC sender/);
    // наши окна по-прежнему работают
    expect(await page.evaluate(() => window.deepFocus.app.version())).toMatch(/^\d+\.\d+\.\d+/);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('база не открылась → работа в памяти видна: storage = error, в журнале путь (§12.3)', async () => {
  const userData = tempUserData();
  try {
    // на месте файла базы — папка: SQLite не откроет её, и это не «повреждение», которое чинится переименованием
    mkdirSync(join(userData, 'deepfocus.db'));
    const { app, page } = await launchApp(userData);
    const modules = await page.evaluate(() => window.deepFocus.app.modules());
    const storage = modules.find((m) => m.name === 'storage');
    expect(storage?.state).toBe('error');
    expect(storage?.error).toBeTruthy();
    const log = readFileSync(join(userData, 'logs', 'deepfocus.log'), 'utf8');
    expect(log).toContain('in-memory');
    expect(log).toContain(join(userData, 'deepfocus.db'));
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('окно виджета: падение renderer → окно пересоздаётся видимым; закрытие пользователем = «Скрыть» (§12.2)', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro', kind: 'focus' }));
    const widgetWindows = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()
          .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('/widget/'))
          .map((w) => ({ id: w.id, visible: w.isVisible() })),
      );
    await expect.poll(widgetWindows, { timeout: 15_000 }).toEqual([expect.objectContaining({ visible: true })]);
    const [first] = await widgetWindows();

    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.webContents.forcefullyCrashRenderer(), first!.id);
    await expect
      .poll(async () => (await widgetWindows()).filter((w) => w.id !== first!.id && w.visible).length, { timeout: 15_000 })
      .toBe(1);
    expect(await page.evaluate(() => window.deepFocus.widget.isVisible())).toBe(true);
    expect((await page.evaluate(() => window.deepFocus.timer.snapshot())).status).toBe('running');

    const [second] = await widgetWindows();
    await app.evaluate(({ BrowserWindow }, id) => BrowserWindow.fromId(id)?.close(), second!.id);
    await expect.poll(widgetWindows, { timeout: 10_000 }).toEqual([{ id: second!.id, visible: false }]);
    expect(await page.evaluate(() => window.deepFocus.widget.isVisible())).toBe(false);
    expect((await page.evaluate(() => window.deepFocus.settings.get())).widget.hidden).toBe(true);

    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    await app.close();
  } finally {
    removeUserData(userData);
  }
});
