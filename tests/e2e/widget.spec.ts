// E2E виджета (§3): настоящее окно Windows — WS_EX_TOPMOST после фокуса чужого окна, WS_EX_TRANSPARENT
// в click-through, глобальные клавиши, показ/скрытие без влияния на таймер, всё состояние — после перезапуска.
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TimerSnapshot } from '../../src/shared/types';
import { removeUserData, ROOT, tempUserData } from './helpers';

interface WindowStyles {
  exists: boolean;
  visible: boolean;
  topmost: boolean;
  transparent: boolean;
  layered: boolean;
  noActivate: boolean;
}

function win32(args: string[]): {
  window?: WindowStyles;
  foreignForeground?: boolean;
  foreignWindow?: boolean;
  aboveForeign?: boolean;
} {
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-File', join(__dirname, 'win32.ps1'), ...args],
    { encoding: 'utf8', timeout: 30_000 },
  );
  return JSON.parse(out.trim() || '{}');
}

const styles = (hwnd: string) => win32(['-Hwnd', hwnd]).window!;
const pressKeys = (combo: string) => win32(['-Keys', combo]);

/** Запуск с отдельной папкой данных; главное окно ищем по адресу — виджет может открыться раньше него. */
async function launch(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, val] of Object.entries(process.env)) {
    if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
  }
  env.DEEPFOCUS_USER_DATA = userData;
  const app = await electron.launch({ args: [ROOT], cwd: ROOT, env });
  let page: Page | undefined;
  await expect
    .poll(() => (page = app.windows().find((w) => w.url().includes('/app/'))) !== undefined, { timeout: 30_000 })
    .toBe(true);
  await page!.waitForSelector('nav [data-section="home"]');
  return { app, page: page! };
}

/** Состояние окна виджета со стороны main (или null, если окна ещё нет). */
function widgetWindow(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/widget/'));
    if (!w) return null;
    const buf = w.getNativeWindowHandle();
    const hwnd = (buf.length >= 8 ? buf.readBigUInt64LE(0) : BigInt(buf.readUInt32LE(0))).toString();
    return {
      hwnd,
      visible: w.isVisible(),
      alwaysOnTop: w.isAlwaysOnTop(),
      opacity: w.getOpacity(),
      bounds: w.getBounds(),
      focusable: w.isFocusable(),
    };
  });
}

async function widgetPage(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined;
  await expect.poll(() => (page = app.windows().find((w) => w.url().includes('/widget/'))) !== undefined).toBe(true);
  await page!.waitForSelector('[data-testid="widget-time"]');
  return page!;
}

const timerState = (page: Page) =>
  page.evaluate(async () => {
    const { now: _now, ...rest } = (await window.deepFocus.timer.snapshot()) as TimerSnapshot;
    return rest;
  });

test('виджет: поверх окон после фокуса чужого окна, click-through, клавиши, скрытие не трогает таймер, состояние после перезапуска', async () => {
  test.setTimeout(150_000);
  const userData = tempUserData();
  try {
    let { app, page } = await launch(userData);

    // Без сессии виджет по умолчанию скрыт (§3.15) и окна ещё нет
    expect(await page.evaluate(() => window.deepFocus.widget.isVisible())).toBe(false);
    const timerBefore = await timerState(page);

    await page.evaluate(() => window.deepFocus.widget.show());
    await expect.poll(async () => (await widgetWindow(app))?.visible).toBe(true);
    let w = (await widgetWindow(app))!;
    expect(w.alwaysOnTop).toBe(true);

    // Цифры непрозрачные, режим по умолчанию — стандартный, до старта показана длительность пресета 25:00
    let wp = await widgetPage(app);
    await expect(wp.locator('.widget-root')).toHaveAttribute('data-mode', 'standard');
    await expect(wp.getByTestId('widget-time')).toHaveText('25:00');
    expect(await wp.getByTestId('widget-time').evaluate((el) => getComputedStyle(el).color)).toMatch(/^rgb\(/);

    // Настоящее окно Windows: WS_EX_TOPMOST, в том числе после того как фокус ушёл в Блокнот и в главное окно
    expect(styles(w.hwnd)).toMatchObject({ exists: true, visible: true, topmost: true, transparent: false });
    // главное окно уже показано и не заберёт фокус у Блокнота посреди проверки
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().some((x) => x.webContents.getURL().includes('/app/') && x.isVisible()),
        ),
      )
      .toBe(true);
    // Windows не всегда отдаёт передний план чужому процессу (блокировка фокуса, пока пользователь работает
    // за машиной) — до трёх попыток; z-порядок «виджет выше Блокнота» проверяется в любом случае
    let foreign = win32(['-Hwnd', w.hwnd, '-Foreign']);
    for (let attempt = 1; attempt < 3 && !foreign.foreignForeground; attempt++) foreign = win32(['-Hwnd', w.hwnd, '-Foreign']);
    expect(foreign.foreignWindow).toBe(true);
    expect(foreign.aboveForeign).toBe(true);
    if (!foreign.foreignForeground) {
      test.info().annotations.push({ type: 'warning', description: 'Windows не отдала фокус Блокноту; проверен только z-порядок' });
    }
    expect(foreign.window).toMatchObject({ visible: true, topmost: true });
    await app.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/app/'))!;
      main.show();
      main.focus();
    });
    expect(styles(w.hwnd).topmost).toBe(true);

    // Click-through: из главного окна, затем горячей клавишей Ctrl+Alt+I обратно
    await page.evaluate(() => window.deepFocus.widget.setClickThrough(true));
    expect(styles(w.hwnd)).toMatchObject({ transparent: true, topmost: true });
    pressKeys('ctrl+alt+i');
    await expect.poll(() => page.evaluate(async () => (await window.deepFocus.settings.get()).widget.clickThrough)).toBe(false);
    expect(styles(w.hwnd).transparent).toBe(false);
    pressKeys('ctrl+alt+i');
    await expect.poll(() => styles(w.hwnd).transparent).toBe(true);
    await page.evaluate(() => window.deepFocus.widget.setClickThrough(false));
    expect(styles(w.hwnd).transparent).toBe(false);

    // Показ/скрытие горячей клавишей Ctrl+Alt+W и из главного окна не меняет состояние таймера
    pressKeys('ctrl+alt+w');
    await expect.poll(async () => (await widgetWindow(app))?.visible).toBe(false);
    expect(styles(w.hwnd).visible).toBe(false);
    pressKeys('ctrl+alt+w');
    await expect.poll(async () => (await widgetWindow(app))?.visible).toBe(true);
    await page.evaluate(() => window.deepFocus.widget.toggle());
    await page.evaluate(() => window.deepFocus.widget.toggle());
    expect(await timerState(page)).toEqual(timerBefore);

    // Вкладка настроек: режим, прозрачности, «поверх всех окон», click-through, показ при старте сессии
    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="widget"]');
    await expect(page.getByTestId('widget-visibility')).toHaveText('Показан');
    await page.getByRole('radio', { name: 'Расширенный' }).click();
    await expect(wp.locator('.widget-root')).toHaveAttribute('data-mode', 'expanded');
    await expect(wp.getByTestId('widget-task')).toBeVisible();
    await expect(wp.getByTestId('widget-status-blocker')).toBeVisible();
    await page.getByRole('switch', { name: 'Показывать при старте сессии' }).click();
    await page.getByRole('switch', { name: 'Поверх всех окон' }).click();
    await expect.poll(async () => (await widgetWindow(app))?.alwaysOnTop).toBe(false);
    expect(styles(w.hwnd).topmost).toBe(false);
    await page.getByRole('slider', { name: 'Прозрачность окна' }).fill('60');
    await page.getByRole('slider', { name: 'Плотность фона' }).fill('30');
    await expect.poll(async () => (await widgetWindow(app))?.opacity).toBeCloseTo(0.6, 2);

    // Ширина и высота из настроек; меньше минимума режима — прижимается к минимуму
    await page.getByRole('spinbutton', { name: 'Ширина, px' }).fill('320');
    await page.getByRole('spinbutton', { name: 'Ширина, px' }).press('Enter');
    await page.getByRole('spinbutton', { name: 'Высота, px' }).fill('20');
    await page.getByRole('spinbutton', { name: 'Высота, px' }).press('Enter');
    await expect.poll(async () => (await widgetWindow(app))?.bounds).toMatchObject({ width: 320, height: 124 });

    // «В угол»: левый нижний с отступом 24
    await page.evaluate(() => window.deepFocus.widget.snapTo('bottomLeft'));
    const workArea = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().workArea);
    await expect
      .poll(async () => (await widgetWindow(app))?.bounds)
      .toEqual({ x: workArea.x + 24, y: workArea.y + workArea.height - 124 - 24, width: 320, height: 124 });

    // Перетаскивание (окно сдвинуто как мышью): привязка снимается, позиция сохраняется через 500 мс
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/widget/'))!.setPosition(200, 150);
    });
    await expect
      .poll(() => page.evaluate(async () => (await window.deepFocus.settings.get()).widget))
      .toMatchObject({ anchor: 'free', bounds: { x: 200, y: 150, width: 320, height: 124 } });
    await page.evaluate(() => window.deepFocus.widget.setClickThrough(true));

    // Перезапуск: всё состояние виджета восстановлено
    await app.close();
    ({ app, page } = await launch(userData));
    await expect.poll(async () => (await widgetWindow(app))?.visible, { timeout: 15_000 }).toBe(true);
    w = (await widgetWindow(app))!;
    expect(w.bounds).toEqual({ x: 200, y: 150, width: 320, height: 124 });
    expect(w.opacity).toBeCloseTo(0.6, 2);
    expect(w.alwaysOnTop).toBe(false);
    expect(w.focusable).toBe(false);
    expect(styles(w.hwnd)).toMatchObject({ visible: true, transparent: true, topmost: false });
    wp = await widgetPage(app);
    await expect(wp.locator('.widget-root')).toHaveAttribute('data-mode', 'expanded');
    await expect(wp.locator('.widget-root')).toHaveAttribute('style', /var\(--df-surface\) 30%/);

    // Вернуть интерактивность из главного окна; скрыть — и скрытость тоже переживает перезапуск
    await page.evaluate(() => window.deepFocus.widget.setClickThrough(false));
    expect(styles(w.hwnd).transparent).toBe(false);
    await page.evaluate(() => window.deepFocus.widget.hide());
    await app.close();
    ({ app, page } = await launch(userData));
    expect(await page.evaluate(() => window.deepFocus.widget.isVisible())).toBe(false);
    expect((await page.evaluate(() => window.deepFocus.settings.get())).widget.hidden).toBe(true);
    expect(await widgetWindow(app)).toBeNull();
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('сессия: виджет появляется при старте сессии, идёт обратный отсчёт, после стопа прячется через 5 с', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launch(userData);
    expect(await page.evaluate(() => window.deepFocus.widget.isVisible())).toBe(false);

    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(async () => (await widgetWindow(app))?.visible).toBe(true);
    const wp = await widgetPage(app);
    await expect(wp.getByTestId('widget-label')).toHaveText('Фокус');
    await expect(wp.getByTestId('widget-time')).toHaveText(/^2[45]:\d\d$/);
    await expect(wp.getByTestId('widget-progress')).toBeVisible();

    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    const stoppedAt = Date.now();
    await expect.poll(async () => (await widgetWindow(app))?.visible, { timeout: 10_000 }).toBe(false);
    expect(Date.now() - stoppedAt).toBeGreaterThanOrEqual(4500);
    // автоскрытие — не «скрыл пользователь»: следующая сессия снова покажет виджет
    expect((await page.evaluate(() => window.deepFocus.settings.get())).widget.hidden).toBe(false);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});
