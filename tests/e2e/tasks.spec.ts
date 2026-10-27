import { expect, test } from '@playwright/test';
import { launchApp, removeUserData, tempUserData } from './helpers';

test('задачи: пустое состояние, ошибка названия без потери ввода, ▶ запускает Focus, карточка результата, аналитика', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);

    // Analytics без данных — понятное пустое состояние
    await page.click('nav [data-section="analytics"]');
    await expect(page.locator('[data-empty="analytics"]')).toBeVisible();

    // Tasks: пусто, одна строка-подсказка, пять проектов из сида
    await page.click('nav [data-section="tasks"]');
    await expect(page.locator('[data-empty="tasks"]')).toBeVisible();
    await expect(page.locator('[data-projects] li')).toHaveCount(5);

    // обязательное только название: ошибка рядом с полем, описание не теряется
    const form = page.locator('[data-task-form="create"]');
    await form.locator('textarea').fill('Черновик описания');
    await form.locator('[data-action="submit-task"]').click();
    await expect(form.locator('[data-error="title"]')).toBeVisible();
    await expect(form.locator('textarea')).toHaveValue('Черновик описания');
    expect(await page.evaluate(() => window.deepFocus.tasks.list())).toHaveLength(0);

    // создание задачи только с названием и проектом
    await form.locator('[data-field="title"]').fill('Написать отчёт');
    await form.getByLabel('Проект').selectOption('seed-work');
    await form.locator('[data-action="submit-task"]').click();
    const row = page.locator('[data-task-list] li').first();
    await expect(row).toContainText('Написать отчёт');
    await expect(row).toContainText('Работа');
    await expect(page.locator('[data-empty="tasks"]')).toHaveCount(0);

    // ▶ у задачи: Focus с taskId и projectId
    await row.locator('[data-action="start-task"]').click();
    await expect.poll(() => page.evaluate(() => window.deepFocus.timer.snapshot().then((s) => s.status))).toBe('running');
    const running = await page.evaluate(() => window.deepFocus.timer.snapshot());
    expect(running.kind).toBe('focus');
    expect(running.taskId).not.toBeNull();
    expect(running.projectId).toBe('seed-work');
    await expect(row.locator('[data-action="start-task"]')).toBeDisabled();

    // немного активного времени, затем остановка
    await page.waitForTimeout(2200);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));

    // Home: ненавязчивая карточка результата; игнорировать можно, выбор пишет исход и меняет задачу
    await page.click('nav [data-section="home"]');
    const card = page.locator('[data-outcome-card]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('Написать отчёт');
    expect(await card.locator('[data-outcome]').evaluateAll((els) => els.map((e) => e.getAttribute('data-outcome')))).toEqual([
      'done',
      'partial',
      'later',
      'cancelled',
      'dismiss',
    ]);
    await card.locator('[data-outcome="partial"]').click();
    await expect(card).toHaveCount(0);
    const tasks = await page.evaluate(() => window.deepFocus.tasks.list());
    expect(tasks[0]?.status).toBe('inProgress');
    const sessions = await page.evaluate(() => window.deepFocus.analytics.history({ from: 0, to: Date.now() + 86_400_000 }));
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ kind: 'focus', outcome: 'partial', endReason: 'stopped', projectId: 'seed-work' });
    expect(sessions[0]?.activeMs).toBeGreaterThan(1500);

    // время копится у задачи и проекта
    await page.click('nav [data-section="tasks"]');
    await expect(page.locator('[data-task-list] li').first().locator('[data-task-spent]')).toHaveText(/\d+ с/);
    await expect(page.locator('[data-project-id="seed-work"]')).toContainText(/\d+ с/);

    // история по задаче: причина, результат
    await page.locator('[data-task-list] li').first().getByText('История сессий').click();
    await expect(page.locator('[data-session-row]')).toHaveCount(1);
    await expect(page.locator('[data-session-row]')).toContainText('остановлена');
    await expect(page.locator('[data-session-row]')).toContainText('частично');

    // быстрый ввод на Home при свободном таймере создаёт задачу и стартует Focus с ней
    await page.click('nav [data-section="home"]');
    await page.locator('[data-quick-task]').fill('Быстрая задача');
    await page.locator('[data-quick-task]').press('Enter');
    await expect.poll(() => page.evaluate(() => window.deepFocus.timer.snapshot().then((s) => s.status))).toBe('running');
    expect(await page.evaluate(() => window.deepFocus.tasks.list().then((l) => l.map((x) => x.title)))).toContain('Быстрая задача');
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'reset' }));

    // прогресс цели на Home и аналитика с данными
    await expect(page.locator('[data-home-goals] [data-goal="dailyMinutes"]')).toBeVisible();
    await page.click('nav [data-section="analytics"]');
    await expect(page.locator('[data-empty="analytics"]')).toHaveCount(0);
    await expect(page.locator('[data-stat="interrupted"]')).toContainText('1');
    await expect(page.locator('[data-accuracy]')).toBeVisible();
    await expect(page.locator('[data-hours] [data-hour]')).toHaveCount(24);

    await app.close();
  } finally {
    removeUserData(userData);
  }
});
