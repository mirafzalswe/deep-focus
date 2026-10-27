import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, removeUserData, ROOT, tempUserData } from './helpers';

/**
 * Запуск, когда первым может открыться не главное окно (идущая сессия показывает виджет при старте):
 * ищем окно главного renderer по адресу.
 */
async function launchWithSession(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
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

const action = (page: Page, id: string) => page.locator(`[data-timer-action="${id}"]`);
const actionIds = (page: Page) =>
  page.locator('[data-timer-action]').evaluateAll((els) => els.map((e) => e.getAttribute('data-timer-action')));
const allSessions = (page: Page) => page.evaluate(() => window.deepFocus.analytics.history({ from: 0, to: Date.now() + 86_400_000 }));

test('Home: старт, пауза, продолжение, стоп; кнопки по состоянию; сессия в базе; снимки по timer:state', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    const panel = page.locator('[data-timer-status]');
    await expect(panel).toHaveAttribute('data-timer-status', 'idle');
    await expect(page.locator('[data-timer-display]')).toHaveText('25:00');
    expect(await actionIds(page)).toEqual(['start']);

    await action(page, 'start').click();
    await expect(panel).toHaveAttribute('data-timer-status', 'running');
    expect(await actionIds(page)).toEqual(['pause', 'stop', 'skipSession', 'restart', 'reset']);
    // рассылка timer:state обновляет отсчёт без запросов из окна
    await expect(page.locator('[data-timer-display]')).toHaveText(/^24:5\d$/, { timeout: 5000 });

    // повторный старт не создаёт второй таймер
    const first = await page.evaluate(() => window.deepFocus.timer.snapshot());
    const again = await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'stopwatch' }));
    expect(again.sessionId).toBe(first.sessionId);
    expect(again.mode).toBe('pomodoro');

    await action(page, 'pause').click();
    await expect(panel).toHaveAttribute('data-timer-status', 'paused');
    expect(await actionIds(page)).toEqual(['resume', 'stop', 'skipSession', 'restart', 'reset']);
    await action(page, 'resume').click();
    await expect(panel).toHaveAttribute('data-timer-status', 'running');
    await action(page, 'stop').click();
    await expect(panel).toHaveAttribute('data-timer-status', 'idle');

    const sessions = await allSessions(page);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: 'focus', mode: 'pomodoro', endReason: 'stopped', plannedMs: 25 * 60_000 });
    expect(sessions[0]!.activeMs).toBeGreaterThan(0);

    // неверная команда отвергается main-процессом
    await expect(page.evaluate(() => window.deepFocus.timer.command({ type: 'extend', min: 0 }))).rejects.toThrow(/Invalid/);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('сессия с задачей продолжается после перезапуска с флагом recovered', async () => {
  const userData = tempUserData();
  try {
    let { app, page } = await launchApp(userData);
    const task = await page.evaluate(() => window.deepFocus.tasks.create({ title: 'Глава 3', projectId: 'seed-study' }));
    const before = await page.evaluate(
      (taskId) => window.deepFocus.timer.command({ type: 'start', mode: 'free', plannedMin: 90, taskId }),
      task.id,
    );
    expect(before).toMatchObject({ status: 'running', mode: 'free', taskId: task.id, projectId: 'seed-study' });
    await app.close();

    ({ app, page } = await launchWithSession(userData));
    const after = await page.evaluate(() => window.deepFocus.timer.snapshot());
    expect(after).toMatchObject({
      status: 'running',
      mode: 'free',
      recovered: true,
      sessionId: before.sessionId,
      taskId: task.id,
      endAt: before.endAt,
    });
    await expect(page.locator('[data-timer-task]')).toContainText('Глава 3');
    await expect(page.locator('[data-timer-mode]')).toHaveAttribute('data-timer-mode', 'free');
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('Timer: свой пресет создаётся и выбирается; неверная длительность не сохраняется', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.click('nav [data-section="timer"]');
    await page.click('[data-action="create-preset"]');
    const form = page.locator('form[data-preset-form]');
    await form.locator('input[name="name"]').fill('Спринт');
    await form.locator('input[name="focusMin"]').fill('0');
    await form.locator('button[type="submit"]').click();
    await expect(form.getByRole('alert')).toBeVisible();
    await form.locator('input[name="focusMin"]').fill('50');
    await form.locator('button[type="submit"]').click();
    await expect(form).toHaveCount(0);

    const row = page.locator('[data-preset]', { hasText: 'Спринт' });
    await expect(row).toContainText('50/');
    await row.getByRole('button', { name: 'Выбрать' }).click();
    await expect(row).toContainText('Активный');

    await expect(page.evaluate(() =>
      window.deepFocus.timer.savePreset({ id: 'bad', name: 'Bad', builtin: false, focusMin: 481, shortBreakMin: 5, longBreakMin: 5, cyclesBeforeLong: 4 }),
    )).rejects.toThrow(/Invalid/);
    expect((await page.evaluate(() => window.deepFocus.timer.presets())).some((p) => p.id === 'bad')).toBe(false);

    await page.click('nav [data-section="home"]');
    await expect(page.locator('[data-timer-display]')).toHaveText('50:00');
    await app.close();
  } finally {
    removeUserData(userData);
  }
});
