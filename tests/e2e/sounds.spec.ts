// E2E звуков (§5): библиотека и пометки файлов, микшер в скрытом окне audio, затухание, пресеты,
// свои звуки, реакция на сессию, пересоздание упавшего окна audio. Файлы звуков — сгенерированные WAV.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, launchMain, removeUserData, tempUserData } from './helpers';

interface EngineState {
  context: string;
  playing: boolean;
  master: number;
  tracks: { soundId: string; target: number; gain: number; loaded: boolean; loop: boolean; duration: number }[];
}

/** 16-бит PCM моно: синус + немного шума, тишина 0.3 с по краям. */
function wav(seconds: number, rate = 22050): Buffer {
  const pad = Math.round(rate * 0.3);
  const n = Math.round(rate * seconds) + 2 * pad;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = pad; i < n - pad; i++) {
    const v = 0.4 * Math.sin((2 * Math.PI * 220 * i) / rate) + 0.05 * (Math.random() * 2 - 1);
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}

const isAudioPage = (p: Page) => /\/audio\/index\.html/.test(p.url());

async function engine(app: ElectronApplication): Promise<EngineState | null> {
  const page = app.windows().find(isAudioPage);
  if (!page || page.isClosed()) return null;
  try {
    return await page.evaluate(() => (window as unknown as { __dfAudio: () => EngineState }).__dfAudio());
  } catch {
    return null; // окно пересоздаётся
  }
}

const loaded = async (app: ElectronApplication) =>
  ((await engine(app))?.tracks ?? [])
    .filter((t) => t.loaded)
    .map((t) => t.soundId)
    .sort();

const audioStatus = (page: Page) => page.evaluate(() => window.deepFocus.audio.status());

test('Sounds: пометки файлов, микс генератора и файла, общая громкость, mute, затухание; статус движка — только от окна audio', async () => {
  const userData = tempUserData();
  try {
    mkdirSync(join(userData, 'sounds'));
    writeFileSync(join(userData, 'sounds', 'rain.wav'), wav(3));
    writeFileSync(join(userData, 'sounds', 'waves.mp3'), Buffer.from('definitely not an mp3 '.repeat(200)));
    const { app, page } = await launchApp(userData);
    // окно audio не создаётся без надобности
    expect(app.windows().some(isAudioPage)).toBe(false);
    await page.evaluate(() => window.deepFocus.settings.patch({ sound: { fadeOutMs: 1000 } }));

    await page.click('nav [data-section="sounds"]');
    const row = (id: string) => page.locator(`[data-sound="${id}"]`);
    await expect(row('rain')).toHaveAttribute('data-availability', 'available');
    await expect(row('waves')).toHaveAttribute('data-availability', 'corrupt');
    await expect(row('wind')).toHaveAttribute('data-availability', 'missing');
    await expect(row('brown-noise')).toHaveAttribute('data-availability', 'available');
    await expect(row('wind').locator('[data-file-status]')).toHaveText('файл не добавлен');
    await expect(row('waves').locator('[data-file-status]')).toHaveText('файл повреждён');
    await expect(page.locator('[data-category="custom"] [data-sound]')).toHaveCount(0);

    // Rain Focus: файл (rain.wav из userData) + генератор коричневого шума
    await page.click('[data-preset-play="rain-focus"]');
    await expect(page.locator('[data-audio-playing]')).toHaveAttribute('data-audio-playing', 'true');
    await expect.poll(() => loaded(app), { timeout: 15_000 }).toEqual(['brown-noise', 'rain']);
    const state = (await engine(app))!;
    expect(state.context).toBe('running');
    expect(state.tracks.every((t) => t.loop)).toBe(true);
    expect(state.tracks.find((t) => t.soundId === 'brown-noise')!.duration).toBeCloseTo(10, 1);
    // rain.wav: 3 с звука, тишина обрезана, минус кроссфейд петли (≤ трети звучания)
    expect(state.tracks.find((t) => t.soundId === 'rain')!.duration).toBeGreaterThan(1.9);
    expect(state.tracks.find((t) => t.soundId === 'rain')!.duration).toBeLessThan(2.1);
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.8 * 0.8, 2);

    // Повреждённый и отсутствующий файлы не мешают остальным дорожкам
    await page.click('[data-preset-play="ocean-focus"]');
    await expect(page.locator('[data-audio-missing]')).toContainText('Морские волны');
    expect((await audioStatus(page)).missing).toEqual(['waves', 'wind']);
    await page.getByRole('switch', { name: 'Включить «Белый шум»' }).click();
    await expect.poll(() => loaded(app)).toEqual(['white-noise']);

    // Независимая громкость дорожки, общая громкость, mute
    await page.evaluate(() => window.deepFocus.audio.setTrack('white-noise', { volume: 0.3 }));
    await expect
      .poll(async () => (await engine(app))!.tracks.find((t) => t.soundId === 'white-noise')!.gain)
      .toBeCloseTo(0.3, 2);
    await page.evaluate(() => window.deepFocus.audio.setMaster(0.5));
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.5 * 0.8, 2);
    expect((await page.evaluate(() => window.deepFocus.settings.get())).sound.masterVolume).toBe(0.5);
    await page.click('[data-audio-action="mute"]');
    await expect.poll(async () => (await engine(app))!.master).toBe(0);
    await page.click('[data-audio-action="mute"]');
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.4, 2);

    // Статус движка из главного окна игнорируется: rain не становится «повреждённым»
    await page.evaluate(() => window.deepFocus.audioEngine.reportStatus({ type: 'trackFailed', soundId: 'rain', reason: 'corrupt' }));
    await page.waitForTimeout(300);
    const lib = await page.evaluate(() => window.deepFocus.audio.library());
    expect(lib.find((s) => s.id === 'rain')!.available).toBe(true);

    // Остановка — затухание 1 с: на середине мастер ещё слышен и статус «играет», после — тишина и источники остановлены
    await page.click('[data-audio-action="stop"]');
    await page.waitForTimeout(400);
    const mid = (await engine(app))!;
    expect(mid.master).toBeGreaterThan(0.02);
    expect(mid.master).toBeLessThan(0.4);
    await expect(page.locator('[data-audio-playing]')).toHaveAttribute('data-audio-playing', 'false');
    await expect.poll(async () => (await engine(app))!.tracks.length, { timeout: 5000 }).toBe(0);
    expect((await engine(app))!.master).toBe(0);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('Пресеты, свой звук, настройки звука переживают перезапуск; встроенные пресеты защищены', async () => {
  const userData = tempUserData();
  const source = join(userData, 'import', 'Lo-Fi Loop.wav');
  try {
    mkdirSync(join(userData, 'import'));
    writeFileSync(source, wav(2));
    let { app, page } = await launchApp(userData);
    await page.click('nav [data-section="sounds"]');

    // Встроенные пресеты
    await expect(page.locator('[data-preset]')).toHaveCount(6);
    const names = await page.locator('[data-preset] [data-preset-play]').allTextContents();
    for (const n of ['Rain Focus', 'Ocean Focus', 'Forest', 'Brown Noise', 'Coffee Shop', 'Silent Focus'])
      expect(names.some((x) => x.startsWith(n))).toBe(true);
    await expect(page.locator('[data-preset-delete="rain-focus"]')).toHaveCount(0);

    // Свой пресет: микс → сохранить → переименовать
    await page.getByRole('switch', { name: 'Включить «Розовый шум»' }).click();
    await page.getByRole('textbox', { name: 'Название пресета' }).fill('Мой шум');
    await page.click('[data-audio-action="save-preset"]');
    const mine = page.locator('[data-preset]', { hasText: 'Мой шум' });
    await expect(mine).toHaveCount(1);
    const id = (await mine.getAttribute('data-preset'))!;
    await page.click(`[data-preset-rename="${id}"]`);
    await page.locator(`[data-preset="${id}"] input`).fill('Розовый фокус');
    await page.locator(`[data-preset="${id}"] button[type="submit"]`).click();
    await expect(page.locator(`[data-preset="${id}"]`)).toContainText('Розовый фокус');

    // renderer не может сделать пресет встроенным или перезаписать встроенный
    const forged = await page.evaluate(() =>
      window.deepFocus.audio.savePreset({ id: 'forged', name: 'X', builtin: true, tracks: [], masterVolume: 1 }),
    );
    expect(forged.builtin).toBe(false);
    await expect(
      page.evaluate(() => window.deepFocus.audio.savePreset({ id: 'forest', name: 'X', builtin: false, tracks: [], masterVolume: 1 })),
    ).rejects.toThrow();
    expect(await page.evaluate(() => window.deepFocus.audio.deletePreset('forest'))).toBe(false);
    expect(await page.evaluate(() => window.deepFocus.audio.deletePreset('forged'))).toBe(true);

    // Свой звук: выбор файла (диалог подменён) → копия в userData/sounds, категория «Свои»
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
    }, source);
    await page.click('[data-audio-action="add-custom"]');
    const custom = page.locator('[data-category="custom"] [data-sound]');
    await expect(custom).toHaveCount(1);
    await expect(custom).toContainText('Lo-Fi Loop');
    await expect(custom).toHaveAttribute('data-availability', 'available');
    expect(readdirSync(join(userData, 'sounds')).some((f) => /^custom-[a-z0-9]+\.wav$/.test(f))).toBe(true);
    // файл для звука библиотеки кнопкой «Выбрать файл»
    await page.click('[data-choose-file="river"]');
    await expect(page.locator('[data-sound="river"]')).toHaveAttribute('data-availability', 'available');
    expect(existsSync(join(userData, 'sounds', 'river.wav'))).toBe(true);

    // Настройки → Звуки
    await page.click('nav [data-section="settings"]');
    await page.click('[data-tab="sounds"]');
    await page.getByRole('combobox', { name: 'Профиль для работы' }).selectOption(id);
    await page.getByRole('combobox', { name: 'Профиль для отдыха' }).selectOption('forest');
    await page.getByRole('switch', { name: 'Включать звук при старте сессии' }).click();
    await page.getByRole('radio', { name: 'Переключить' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.deepFocus.settings.get())).sound).toMatchObject({
      workPresetId: id,
      breakPresetId: 'forest',
      autoStartOnSession: true,
      breakBehavior: 'switch',
    });

    await app.close();
    ({ app, page } = await launchApp(userData));
    const presets = await page.evaluate(() => window.deepFocus.audio.presets());
    expect(presets.find((p) => p.id === id)).toMatchObject({ name: 'Розовый фокус', builtin: false });
    expect(presets.some((p) => p.id === 'forged')).toBe(false);
    expect((await page.evaluate(() => window.deepFocus.settings.get())).sound).toMatchObject({
      workPresetId: id,
      breakPresetId: 'forest',
      autoStartOnSession: true,
      breakBehavior: 'switch',
    });
    const lib = await page.evaluate(() => window.deepFocus.audio.library());
    expect(lib.filter((s) => s.category === 'custom').map((s) => s.nameKey)).toEqual(['Lo-Fi Loop']);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('Сессия включает рабочий профиль, перерыв делает тише; падение окна audio → окно пересоздано, звук и таймер идут', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.evaluate(() =>
      window.deepFocus.settings.patch({
        sound: { autoStartOnSession: true, workPresetId: 'brown-noise', breakBehavior: 'lower', lowerFactor: 0.5, fadeOutMs: 300 },
        widget: { showOnSessionStart: false },
      }),
    );
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(() => audioStatus(page)).toMatchObject({ playing: true, presetId: 'brown-noise' });
    await expect.poll(() => loaded(app), { timeout: 15_000 }).toEqual(['brown-noise']);
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.8 * 0.8, 2);

    await page.evaluate(() => window.deepFocus.timer.command({ type: 'switchKind', kind: 'shortBreak' }));
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.8 * 0.8 * 0.5, 2);

    // падение renderer звука
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes('/audio/'));
      w!.webContents.forcefullyCrashRenderer();
    });
    await expect
      .poll(
        async () => {
          const s = await engine(app);
          return s ? { loaded: s.tracks.filter((t) => t.loaded).map((t) => t.soundId), master: Math.round(s.master * 100) / 100 } : null;
        },
        { timeout: 20_000 },
      )
      .toEqual({ loaded: ['brown-noise'], master: 0.32 });
    const snap = await page.evaluate(() => window.deepFocus.timer.snapshot());
    expect(snap).toMatchObject({ status: 'running', kind: 'shortBreak' });
    expect((await audioStatus(page)).error).toBeNull();

    // остановка сессии гасит включённый ею звук
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    await expect.poll(() => audioStatus(page)).toMatchObject({ playing: false });
    await expect.poll(async () => (await engine(app))!.tracks.length, { timeout: 5000 }).toBe(0);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

/**
 * Мастер-gain во времени: окно audio опрашивает себя каждые 50 мс, пока main-окно выполняет действие.
 * Время — от момента, когда мастер впервые пошёл вниз (начало затухания); значения — доля от исходного.
 */
async function fadeCurve(app: ElectronApplication, act: () => Promise<unknown>, totalMs = 2600): Promise<{ t: number; master: number }[]> {
  const audioPage = app.windows().find(isAudioPage)!;
  const sampling = audioPage.evaluate(async (total) => {
    const read = () => (window as unknown as { __dfAudio: () => { master: number } }).__dfAudio().master;
    const out: { t: number; master: number }[] = [];
    const t0 = performance.now();
    while (performance.now() - t0 < total) {
      out.push({ t: performance.now() - t0, master: read() });
      await new Promise((r) => setTimeout(r, 50));
    }
    return out;
  }, totalMs);
  await new Promise((r) => setTimeout(r, 200));
  await act();
  const samples = await sampling;
  const start = samples[0]!.master;
  const from = samples.findIndex((x) => x.master < start * 0.99);
  expect(from).toBeGreaterThan(0);
  const t0 = samples[from - 1]!.t;
  return samples.slice(from - 1).map((x) => ({ t: x.t - t0, master: x.master / start }));
}

/** Линейное затухание за fadeMs: монотонно, не обрывается раньше времени, к концу — тишина. Допуск ±150 мс на опрос. */
function expectLinearFade(curve: { t: number; master: number }[], fadeMs: number): void {
  for (let i = 1; i < curve.length; i++) expect(curve[i]!.master).toBeLessThanOrEqual(curve[i - 1]!.master + 1e-6);
  const at = (ms: number) => curve.find((x) => x.t >= ms)!.master;
  expect(at(fadeMs * 0.25)).toBeGreaterThan(1 - (fadeMs * 0.25 + 150) / fadeMs);
  expect(at(fadeMs * 0.5)).toBeGreaterThan(1 - (fadeMs * 0.5 + 150) / fadeMs);
  expect(at(fadeMs * 0.5)).toBeLessThan(1 - (fadeMs * 0.5 - 150) / fadeMs);
  expect(at(fadeMs * 0.8)).toBeGreaterThan(0.02);
  expect(at(fadeMs + 200)).toBe(0);
}

test('затухание при остановке: мастер-gain гаснет линейно за fadeOutMs, индикатор «играет» держится до конца', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.evaluate(() =>
      window.deepFocus.settings.patch({
        sound: { fadeOutMs: 1500, autoStartOnSession: true, workPresetId: 'brown-noise' },
        widget: { showOnSessionStart: false },
      }),
    );
    const homeSound = page.locator('[data-home-sound]');

    // 1) кнопка звука на главной
    await page.click('[data-home-sound-toggle]');
    await expect.poll(() => loaded(app), { timeout: 15_000 }).toEqual(['brown-noise']);
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.8 * 0.8, 2);
    let indicatorMidFade: string | null = null;
    let curve = await fadeCurve(app, async () => {
      await page.click('[data-home-sound-toggle]');
      await page.waitForTimeout(750);
      indicatorMidFade = await homeSound.getAttribute('data-audio-playing');
    });
    expectLinearFade(curve, 1500);
    expect(indicatorMidFade).toBe('true');
    await expect(homeSound).toHaveAttribute('data-audio-playing', 'false');

    // 2) звук сессии гаснет по «Стоп» таймера; правка настроек посреди затухания его не обрывает
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(() => loaded(app), { timeout: 15_000 }).toEqual(['brown-noise']);
    await expect.poll(async () => (await engine(app))!.master).toBeCloseTo(0.8 * 0.8, 2);
    curve = await fadeCurve(app, async () => {
      await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
      await page.waitForTimeout(300);
      await page.evaluate(() => window.deepFocus.settings.patch({ sound: { lowerFactor: 0.4 } }));
    });
    expectLinearFade(curve, 1500);
    await expect.poll(() => audioStatus(page)).toMatchObject({ playing: false });
    await app.close();
  } finally {
    removeUserData(userData);
  }
});

test('перезапуск посреди сессии возвращает её звук: выход с «продолжить» и аварийное завершение', async () => {
  const userData = tempUserData();
  let app: ElectronApplication | undefined;
  try {
    let page: Page;
    ({ app, page } = await launchMain(userData));
    await page.evaluate(() =>
      window.deepFocus.settings.patch({
        sound: { autoStartOnSession: true, workPresetId: 'brown-noise' },
        widget: { showOnSessionStart: false },
        general: { quitBehavior: 'keep' },
      }),
    );
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro' }));
    await expect.poll(() => loaded(app!), { timeout: 15_000 }).toEqual(['brown-noise']);

    // выход «продолжить при следующем запуске»
    let exited = new Promise<void>((r) => app!.process().once('exit', () => r()));
    void page.evaluate(() => window.deepFocus.app.quit()).catch(() => undefined);
    await exited;
    ({ app, page } = await launchMain(userData));
    expect(await page.evaluate(() => window.deepFocus.timer.snapshot())).toMatchObject({ status: 'running', kind: 'focus', recovered: true });
    await expect.poll(() => audioStatus(page)).toMatchObject({ playing: true, presetId: 'brown-noise' });
    await expect.poll(() => loaded(app!), { timeout: 15_000 }).toEqual(['brown-noise']);
    await expect.poll(async () => (await engine(app!))!.master).toBeCloseTo(0.8 * 0.8, 2);

    // аварийное завершение: всё дерево процессов приложения убито без выхода
    exited = new Promise<void>((r) => app!.process().once('exit', () => r()));
    execFileSync('taskkill', ['/PID', String(app.process().pid), '/T', '/F'], { stdio: 'ignore' });
    await exited;
    // блокировку единственного экземпляра Windows отпускает не сразу — повторяем запуск
    for (let attempt = 1; ; attempt++) {
      try {
        ({ app, page } = await launchMain(userData));
        break;
      } catch (err) {
        if (attempt >= 5) throw err;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    expect(await page.evaluate(() => window.deepFocus.timer.snapshot())).toMatchObject({ status: 'running', recovered: true });
    await expect.poll(() => audioStatus(page)).toMatchObject({ playing: true, presetId: 'brown-noise' });
    await expect.poll(() => loaded(app!), { timeout: 15_000 }).toEqual(['brown-noise']);

    // стоп восстановленной сессии гасит её звук
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    await expect.poll(() => audioStatus(page), { timeout: 5000 }).toMatchObject({ playing: false });
    await app.close();
  } finally {
    await app?.close().catch(() => undefined);
    removeUserData(userData);
  }
});

// launchApp ждёт первое окно: окно audio не должно им оказаться — оно создаётся только по надобности
test('скрытое окно audio не появляется при запуске и поднимается по первой команде', async () => {
  const userData = tempUserData();
  try {
    const { app, page } = await launchApp(userData);
    await page.waitForTimeout(500);
    expect(app.windows().some(isAudioPage)).toBe(false);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    await page.evaluate(() => window.deepFocus.audio.play('brown-noise'));
    await expect.poll(() => app.windows().some(isAudioPage)).toBe(true);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).length)).toBe(1);
    await app.close();
  } finally {
    removeUserData(userData);
  }
});
