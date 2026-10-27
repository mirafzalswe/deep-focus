import { spawn } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
