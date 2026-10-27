// Т07: горячие клавиши, уведомления, трей и закрытие окна, выход с идущей сессией, General, резервная копия,
// «Удалить все данные». Глобальные сочетания регистрируются на настоящей машине — в конце каждого теста снимаются.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { removeUserData, ROOT, tempUserData } from './helpers';

/** Запуск с отдельной папкой данных; главное окно ищем по адресу (при идущей сессии первым может быть виджет). */
async function launch(userData: string, extraEnv: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) {
    if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
  }
  Object.assign(env, extraEnv, { DEEPFOCUS_USER_DATA: userData });
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  const isMain = (p: Page) => /\/app\/index\.html/.test(p.url());
  let page: Page | undefined;
  await expect.poll(() => (page = app.windows().find(isMain)) !== undefined, { timeout: 30_000 }).toBe(true);
  await page!.waitForSelector('nav [data-section="home"]');
  return { app, page: page! };
}

/** Снять глобальные сочетания и закрыть приложение (если ещё живо). */
async function shutdown(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  await app.evaluate(({ globalShortcut }) => globalShortcut.unregisterAll()).catch(() => undefined);
  await app.close().catch(() => undefined);
}

/** Дождаться выхода процесса приложения (выход инициирован самим приложением). */
async function waitExit(app: ElectronApplication): Promise<void> {
  const proc = app.process();
  if (proc.exitCode !== null) return;
  await new Promise<void>((resolve) => proc.once('exit', () => resolve()));
}

const settingsOf = (page: Page) => page.evaluate(() => window.deepFocus.settings.get());
const mainWindowState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/app/index.html'));
    return w ? { exists: true, visible: w.isVisible() } : { exists: false, visible: false };
  });

test('горячие клавиши: пять по умолчанию; системное, дубликат и занятое отклоняются; запись сочетания в Settings', async () => {
  const userData = tempUserData();
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    const results = await page.evaluate(() => window.deepFocus.hotkeys.results());
    expect(results.map((r) => [r.action, r.accelerator])).toEqual([
      ['startPause', 'Ctrl+Alt+Space'],
      ['toggleWidget', 'Ctrl+Alt+W'],
      ['toggleClickThrough', 'Ctrl+Alt+I'],
      ['endSession', 'Ctrl+Alt+E'],
      ['toggleSound', 'Ctrl+Alt+M'],
    ]);
    // На чужой машине сочетание может быть занято другой программой — тогда это сказано, а не молча.
    for (const r of results) expect(r.registered || r.reasonKey === 'system.hotkeys.reason.taken').toBe(true);
    const registered = results.filter((r) => r.registered).map((r) => r.accelerator);
    expect(await app.evaluate(({ globalShortcut }, list) => list.map((a) => globalShortcut.isRegistered(a)), registered)).toEqual(
      registered.map(() => true),
    );

    const assign = (action: string, accel: string) =>
      page.evaluate(([a, k]) => window.deepFocus.hotkeys.assign(a as 'toggleSound', k!), [action, accel] as const);
    expect(await assign('toggleSound', 'Alt+F4')).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.system' });
    expect(await assign('toggleSound', 'Alt+Ctrl+W')).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.duplicate' });
    expect((await settingsOf(page)).hotkeys.toggleSound).toBe('Ctrl+Alt+M');

    // «Занято другой программой»: сочетание уже держит кто-то другой — прежнее остаётся рабочим.
    await app.evaluate(({ globalShortcut }) => globalShortcut.register('Ctrl+Alt+Shift+F10', () => undefined));
    expect(await assign('toggleSound', 'Ctrl+Alt+Shift+F10')).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.taken' });
    expect((await settingsOf(page)).hotkeys.toggleSound).toBe('Ctrl+Alt+M');

    expect(await assign('toggleSound', 'Ctrl+Alt+Shift+F9')).toMatchObject({ registered: true, reasonKey: null, accelerator: 'Ctrl+Alt+Shift+F9' });
    expect((await settingsOf(page)).hotkeys.toggleSound).toBe('Ctrl+Alt+Shift+F9');
    expect(await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered('Ctrl+Alt+Shift+F9'), globalShortcut.isRegistered('Ctrl+Alt+M')])).toEqual([
      true,
      false,
    ]);

    // Поле записи в Settings → Общие
    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="general"]');
    const field = page.locator('[data-hotkey="endSession"] [data-hotkey-value]');
    await expect(field).toHaveAttribute('data-hotkey-value', 'Ctrl+Alt+E');
    await field.click();
    await page.keyboard.press('Control+Alt+Shift+F8');
    await expect(field).toHaveAttribute('data-hotkey-value', 'Ctrl+Alt+Shift+F8');
    expect((await settingsOf(page)).hotkeys.endSession).toBe('Ctrl+Alt+Shift+F8');
    await field.click();
    await page.keyboard.press('Alt+F4');
    await expect(page.locator('[data-hotkey="endSession"] [data-hotkey-message]')).toHaveText(/систем/i);
    await expect(field).toHaveAttribute('data-hotkey-value', 'Ctrl+Alt+Shift+F8');
    await page.click('[data-hotkey="endSession"] [data-hotkey-clear]');
    await expect(field).toHaveAttribute('data-hotkey-value', '');
    expect(await app.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('Ctrl+Alt+Shift+F8'))).toBe(false);
  } finally {
    await shutdown(app);
    removeUserData(userData);
  }
});

test('уведомления: начало сессии приходит тихим, отключённое событие не приходит; General: цели и переключатели', async () => {
  const userData = tempUserData();
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    await app.evaluate(({ Notification }) => {
      const g = globalThis as unknown as { __toasts: { title: string; body: string; silent: boolean }[] };
      g.__toasts = [];
      Notification.prototype.show = function (this: Electron.Notification) {
        g.__toasts.push({ title: this.title, body: this.body, silent: this.silent });
      };
    });
    const toasts = () => app!.evaluate(() => (globalThis as unknown as { __toasts: { title: string; body: string; silent: boolean }[] }).__toasts);

    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(toasts).toEqual([{ title: 'Фокус начался', body: '25 мин. Удачной работы.', silent: true }]);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));

    // Переключатель «Начало сессии» в Settings → Общие
    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="general"]');
    await page.click('[data-notify-setting="sessionStart"] [role="switch"]');
    await expect.poll(async () => (await settingsOf(page)).notifications.sessionStart).toBe(false);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    expect(await toasts()).toHaveLength(1);

    // Цели задаются в интерфейсе
    const daily = page.locator('[data-goal-input="dailyMinutes"]');
    await daily.fill('90');
    await daily.press('Enter');
    await expect.poll(async () => (await settingsOf(page)).goals.dailyMinutes).toBe(90);
    expect((await page.evaluate(() => window.deepFocus.analytics.goals())).dailyMinutes.goal).toBe(90);
    await daily.fill('abc');
    await daily.press('Enter');
    await expect(daily).toHaveAttribute('aria-invalid', 'true');
    expect((await settingsOf(page)).goals.dailyMinutes).toBe(90);

    // Пути данных и журнала видны
    await expect(page.locator('[data-path="data"]')).toHaveText(userData);
    await expect(page.locator('[data-path="log"]')).toContainText(join(userData, 'logs'));

    // Home: звуковой профиль, статус блокировки, сводка дня
    await page.click('nav [data-section="home"]');
    await expect(page.locator('[data-home-sound] select')).toBeVisible();
    await expect(page.locator('[data-home-blocker]')).toHaveAttribute('data-home-blocker', 'disabled');
    await expect(page.locator('[data-home-today] [data-today="sessions"]')).toHaveText('0');
  } finally {
    await shutdown(app);
    removeUserData(userData);
  }
});

test('закрытие окна прячет в трей; без closeToTray закрытие — выход', async () => {
  const userData = tempUserData();
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    expect((await settingsOf(page)).general.closeToTray).toBe(true);
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .find((x) => x.webContents.getURL().includes('/app/index.html'))!
        .close(),
    );
    await expect.poll(() => mainWindowState(app!)).toEqual({ exists: true, visible: false });
    // Приложение живо: таймер отвечает
    expect((await page.evaluate(() => window.deepFocus.timer.snapshot())).status).toBe('idle');

    await page.evaluate(() => window.deepFocus.settings.patch({ general: { closeToTray: false } }));
    const exited = waitExit(app);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/app/index.html'))!;
      w.show();
      w.close();
    });
    await exited;
    app = undefined;
  } finally {
    await shutdown(app);
    removeUserData(userData);
  }
});

test('выход с идущей сессией: диалог; «продолжить» восстанавливается, «остановить» записывает сессию', async () => {
  const userData = tempUserData();
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));

    // Ответ диалога подменяется; сначала «Отмена» — приложение остаётся, а текст диалога говорит о блокировке.
    const stubDialog = (response: number, remember: boolean) =>
      app!.evaluate(
        ({ dialog }, [r, c]) => {
          const g = globalThis as unknown as { __quitDialog: unknown[] };
          g.__quitDialog = [];
          dialog.showMessageBox = (async (...args: unknown[]) => {
            g.__quitDialog.push(args[args.length - 1]);
            return { response: r, checkboxChecked: c };
          }) as typeof dialog.showMessageBox;
        },
        [response, remember] as const,
      );
    await stubDialog(2, true);
    expect(await page.evaluate(() => window.deepFocus.app.quit())).toBe(false);
    const shown = (await app.evaluate(() => (globalThis as unknown as { __quitDialog: Record<string, unknown>[] }).__quitDialog))[0]!;
    expect(shown.buttons).toEqual(['Остановить сессию', 'Продолжить при следующем запуске', 'Отмена']);
    expect(String(shown.detail)).toMatch(/Блокировка сайтов снимется при выходе в любом случае/);
    expect(shown.checkboxLabel).toBe('Запомнить выбор');
    expect((await settingsOf(page)).general.quitBehavior).toBe('ask');

    // «Продолжить при следующем запуске» + «запомнить»
    await stubDialog(1, true);
    let exited = waitExit(app);
    void page.evaluate(() => window.deepFocus.app.quit()).catch(() => undefined);
    await exited;
    ({ app, page } = await launch(userData));
    const resumed = await page.evaluate(() => window.deepFocus.timer.snapshot());
    expect(resumed).toMatchObject({ status: 'running', kind: 'focus', recovered: true });
    expect((await settingsOf(page)).general.quitBehavior).toBe('keep');

    // «Остановить сессию» (без запоминания)
    await page.evaluate(() => window.deepFocus.settings.patch({ general: { quitBehavior: 'ask' } }));
    await stubDialog(0, false);
    exited = waitExit(app);
    void page.evaluate(() => window.deepFocus.app.quit()).catch(() => undefined);
    await exited;
    ({ app, page } = await launch(userData));
    expect((await page.evaluate(() => window.deepFocus.timer.snapshot())).status).toBe('idle');
    const history = await page.evaluate(() => window.deepFocus.analytics.history({ from: 0, to: Date.now() + 86_400_000 }));
    expect(history.map((s) => s.endReason)).toEqual(['stopped']);
    expect((await settingsOf(page)).general.quitBehavior).toBe('ask');
  } finally {
    await shutdown(app);
    removeUserData(userData);
  }
});

test('резервная копия: экспорт и импорт через диалог; битый файл — сообщение, настройки нетронуты', async () => {
  const userData = tempUserData();
  const files = join(tmpdir(), `df-backup-${Date.now()}`);
  mkdirSync(files, { recursive: true });
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData));
    const stubFile = (kind: 'save' | 'open', path: string) =>
      app!.evaluate(
        ({ dialog }, [k, p]) => {
          if (k === 'save') dialog.showSaveDialog = (async () => ({ canceled: false, filePath: p })) as typeof dialog.showSaveDialog;
          else dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [p] })) as typeof dialog.showOpenDialog;
        },
        [kind, path] as const,
      );

    await page.evaluate(() => window.deepFocus.settings.patch({ goals: { dailyMinutes: 123 } }));
    const backup = join(files, 'backup.json');
    await stubFile('save', backup);
    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="general"]');
    await page.click('[data-action="export-backup"]');
    await expect(page.locator('[data-backup-message]')).toHaveAttribute('data-backup-message', 'ok');
    const saved = JSON.parse(readFileSync(backup, 'utf8'));
    expect(saved).toMatchObject({ app: 'deep-focus', version: 1, settings: { goals: { dailyMinutes: 123 } } });

    const before = await settingsOf(page);
    const broken = join(files, 'broken.json');
    writeFileSync(broken, '{"app":"deep-focus","version":1,"settings":{"widget":{"opacity":7}}');
    await stubFile('open', broken);
    await page.click('[data-action="import-backup"]');
    await expect(page.locator('[data-backup-message]')).toHaveAttribute('data-backup-message', 'error');
    await expect(page.locator('[data-backup-message]')).toContainText('текущие настройки не изменены');
    expect(await settingsOf(page)).toEqual(before);

    await page.evaluate(() => window.deepFocus.settings.patch({ goals: { dailyMinutes: 30 } }));
    await stubFile('open', backup);
    await page.click('[data-action="import-backup"]');
    await expect(page.locator('[data-backup-message]')).toHaveAttribute('data-backup-message', 'ok');
    expect((await settingsOf(page)).goals.dailyMinutes).toBe(123);
  } finally {
    await shutdown(app);
    removeUserData(userData);
    rmSync(files, { recursive: true, force: true });
  }
});

test('удалить все данные: слово подтверждения, перезапуск чистым, вне папки данных ничего не тронуто', async () => {
  const userData = tempUserData();
  const outside = `${userData}-outside.txt`; // соседний файл в %TEMP%, не внутри userData
  writeFileSync(outside, 'keep me');
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launch(userData, { DEEPFOCUS_NO_RELAUNCH: '1' }));
    await page.evaluate(() => window.deepFocus.tasks.create({ title: 'Секретная задача' }));
    await page.evaluate(() => window.deepFocus.settings.patch({ general: { theme: 'light' } }));
    mkdirSync(join(userData, 'sounds'), { recursive: true });
    writeFileSync(join(userData, 'sounds', 'custom-test.mp3'), 'x');

    // Неверное слово — ничего не происходит
    expect(await page.evaluate(() => window.deepFocus.settings.deleteAllData('да'))).toEqual({ ok: false, errorKey: 'settings.deleteWrongWord' });
    expect(existsSync(join(userData, '.delete-all-data'))).toBe(false);

    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="general"]');
    await page.click('[data-action="delete-all-data"]');
    const confirm = page.locator('[data-action="delete-confirm"]');
    await page.fill('[data-delete-word]', 'удали');
    await expect(confirm).toBeDisabled();
    await page.fill('[data-delete-word]', 'УДАЛИТЬ');
    await expect(confirm).toBeEnabled();
    const exited = waitExit(app);
    await confirm.click();
    await exited;
    app = undefined;
    expect(existsSync(join(userData, '.delete-all-data'))).toBe(true);

    ({ app, page } = await launch(userData));
    const tasks = await page.evaluate(() => window.deepFocus.tasks.list({}));
    expect(tasks.map((t) => t.title)).not.toContain('Секретная задача');
    expect((await settingsOf(page)).general.theme).toBe('dark');
    expect(existsSync(join(userData, 'sounds'))).toBe(false);
    expect(existsSync(join(userData, '.delete-all-data'))).toBe(false);
    expect(existsSync(join(userData, 'logs'))).toBe(true);
    expect(readFileSync(outside, 'utf8')).toBe('keep me');
  } finally {
    await shutdown(app);
    removeUserData(userData);
    rmSync(outside, { force: true });
  }
});
