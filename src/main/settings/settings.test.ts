import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings } from '../../shared/types';
import { translateDynamic } from '../../shared/i18n';
import { openStorage, type Storage } from '../db';
import { SettingsError, SettingsManager } from './SettingsManager';

let dir: string;
let storage: Storage;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-settings-'));
  storage = openStorage(join(dir, 'deepfocus.db'));
});
afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const reopen = () => {
  storage.close();
  storage = openStorage(join(dir, 'deepfocus.db'));
  return new SettingsManager(storage);
};

describe('SettingsManager', () => {
  it('без сохранённых значений отдаёт DEFAULT_SETTINGS (тёмная тема, русский)', () => {
    const s = new SettingsManager(storage).get();
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(s.general.theme).toBe('dark');
    expect(s.general.language).toBe('ru');
  });

  it('patch глубоко сливает: соседние поля секции не теряются, изменения переживают перезапуск', () => {
    const m = new SettingsManager(storage);
    m.patch({ general: { theme: 'light' } });
    m.patch({ widget: { opacity: 0.6, bounds: { x: 10, y: 20, width: 300, height: 120, displayId: 7 } } });
    const after = reopen().get();
    expect(after.general).toEqual({ ...DEFAULT_SETTINGS.general, theme: 'light' });
    expect(after.widget.opacity).toBe(0.6);
    expect(after.widget.bounds).toEqual({ x: 10, y: 20, width: 300, height: 120, displayId: 7 });
    expect(after.widget.displayMode).toBe(DEFAULT_SETTINGS.widget.displayMode);
  });

  it('неверное значение → SettingsError, сохранённое не меняется', () => {
    const m = new SettingsManager(storage);
    m.patch({ general: { language: 'en' } });
    const bad: unknown[] = [
      { general: { language: 'de' } },
      { widget: { opacity: 1.5 } },
      { widget: { opacity: 0.1 } },
      { timer: { freeExtendMin: 0 } },
      { general: { theme: 'light', unknownField: 1 } },
      { nope: {} },
      { widget: { bounds: { x: 1 } } },
      'not an object',
    ];
    for (const p of bad) expect(() => m.patch(p), JSON.stringify(p)).toThrow(SettingsError);
    expect(m.get().general.theme).toBe('dark'); // частично верный патч тоже не применился
    expect(reopen().get().general).toEqual({ ...DEFAULT_SETTINGS.general, language: 'en' });
  });

  it("on('change') получает (next, prev); пустой по смыслу патч событие не шлёт", () => {
    const m = new SettingsManager(storage);
    const calls: Array<[AppSettings, AppSettings]> = [];
    const off = m.on('change', (next, prev) => calls.push([next, prev]));
    m.patch({ general: { theme: 'system' } });
    m.patch({ general: { theme: 'system' } });
    off();
    m.patch({ general: { theme: 'light' } });
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].general.theme).toBe('system');
    expect(calls[0]![1].general.theme).toBe('dark');
  });

  it('preview: проверяет патч и показывает результат, ничего не сохраняя и не рассылая', () => {
    const m = new SettingsManager(storage);
    let changed = 0;
    m.on('change', () => changed++);
    expect(m.preview({ blocker: { level: 'strict' } }).blocker.level).toBe('strict');
    expect(m.get().blocker.level).toBe(DEFAULT_SETTINGS.blocker.level);
    expect(() => m.preview({ blocker: { level: 'hard' } })).toThrow(SettingsError);
    expect(changed).toBe(0);
    expect(reopen().get()).toEqual(DEFAULT_SETTINGS);
  });

  it('get() возвращает копию: правка снаружи не меняет состояние', () => {
    const m = new SettingsManager(storage);
    const s = m.get();
    s.general.theme = 'light';
    expect(m.get().general.theme).toBe('dark');
  });

  it('битое значение в базе заменяется значением по умолчанию', () => {
    storage.settings.set('widget', { opacity: 'много', marginPx: 40 });
    const s = new SettingsManager(storage).get();
    expect(s.widget.opacity).toBe(DEFAULT_SETTINGS.widget.opacity);
    expect(s.widget.marginPx).toBe(40);
  });
});

describe('Резервная копия', () => {
  it('экспорт → импорт в чистую базу восстанавливает настройки, свои пресеты и правила', () => {
    const m = new SettingsManager(storage);
    m.patch({ general: { language: 'en' }, goals: { dailyMinutes: 90 } });
    storage.timerPresets.upsert({ id: 'mine', name: 'Мой', builtin: false, focusMin: 50, shortBreakMin: 10, longBreakMin: 20, cyclesBeforeLong: 3 });
    const file = JSON.parse(JSON.stringify(m.exportBackup()));
    expect(file).toMatchObject({ app: 'deep-focus', version: 1 });

    storage.close();
    rmSync(join(dir, 'deepfocus.db'), { force: true });
    rmSync(join(dir, 'deepfocus.db-wal'), { force: true });
    rmSync(join(dir, 'deepfocus.db-shm'), { force: true });
    storage = openStorage(join(dir, 'deepfocus.db'));
    const fresh = new SettingsManager(storage);
    let changed = 0;
    fresh.on('change', () => changed++);
    fresh.importBackup(file);
    expect(fresh.get().general.language).toBe('en');
    expect(fresh.get().goals.dailyMinutes).toBe(90);
    expect(storage.timerPresets.get('mine')?.focusMin).toBe(50);
    expect(changed).toBe(1);
  });

  it('битый или чужой файл → SettingsError, ничего не меняется', () => {
    const m = new SettingsManager(storage);
    const good = JSON.parse(JSON.stringify(m.exportBackup()));
    const broken: unknown[] = [
      null,
      { hello: 'world' },
      { ...good, app: 'other-app' },
      { ...good, version: 99 },
      { ...good, settings: { ...good.settings, general: { ...good.settings.general, theme: 'neon' } } },
      { ...good, timerPresets: [{ id: 'x', name: 'x', builtin: false, focusMin: 0, shortBreakMin: 5, longBreakMin: 5, cyclesBeforeLong: 4 }] },
      { ...good, blockRules: [{ id: 'r', pattern: 'a.com' }] },
      { ...good, settings: { ...good.settings, general: { ...good.settings.general, language: 'en' } }, soundPresets: 'nope' },
    ];
    for (const f of broken) expect(() => m.importBackup(f), JSON.stringify(f)?.slice(0, 80)).toThrow(SettingsError);
    expect(m.get()).toEqual(DEFAULT_SETTINGS);
    expect(storage.timerPresets.get('x')).toBeNull();
  });

  it('унаследованные имена в файле (__proto__, constructor, toString) → SettingsError, Object.prototype не меняется', () => {
    const m = new SettingsManager(storage);
    const toString = Object.prototype.toString;
    const hasOwn = Object.prototype.hasOwnProperty;
    const files = [
      '{"app":"deep-focus","version":1,"settings":{"__proto__":{"toString":"x"}}}',
      '{"app":"deep-focus","version":1,"settings":{"constructor":{"prototype":{"polluted":1}}}}',
      '{"app":"deep-focus","version":1,"settings":{"toString":{"x":1}}}',
      '{"app":"deep-focus","version":1,"settings":{"general":{"__proto__":{"polluted":1}}}}',
      '{"app":"deep-focus","version":1,"settings":{"general":{"hasOwnProperty":"x"}}}',
      '{"app":"deep-focus","version":1,"settings":{"prototype":{"polluted":1}}}',
    ];
    try {
      for (const text of files) expect(() => m.importBackup(JSON.parse(text)), text).toThrow(SettingsError);
      for (const text of files) expect(() => m.patch(JSON.parse(text).settings), text).toThrow(SettingsError);
      expect(Object.prototype.toString).toBe(toString);
      expect(Object.prototype.hasOwnProperty).toBe(hasOwn);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(m.get()).toEqual(DEFAULT_SETTINGS);
    } finally {
      Object.prototype.toString = toString;
      Object.prototype.hasOwnProperty = hasOwn;
      delete (Object.prototype as Record<string, unknown>).polluted;
    }
  });

  it('унаследованные имена в базе пропускаются при чтении', () => {
    storage.settings.set('general', JSON.parse('{"toString":"x","constructor":"y","theme":"light"}'));
    const s = new SettingsManager(storage).get();
    expect(s.general).toEqual({ ...DEFAULT_SETTINGS.general, theme: 'light' });
    expect(Object.hasOwn(s.general, 'toString')).toBe(false);
  });
});

describe('Сообщение «база не открылась» (§12.3)', () => {
  it('на обоих языках: изменения не сохранятся, путь к базе и к журналу', () => {
    const params = { path: 'C:\\data\\deepfocus.db', log: 'C:\\data\\logs\\deepfocus.log' };
    for (const lang of ['ru', 'en'] as const) {
      const text = translateDynamic(lang, 'settings.dbUnavailable', params);
      expect(text, lang).not.toContain('settings.dbUnavailable');
      expect(text, lang).toContain(params.path);
      expect(text, lang).toContain(params.log);
    }
    expect(translateDynamic('ru', 'settings.dbUnavailable', params)).toMatch(/не сохранятся/);
    expect(translateDynamic('en', 'settings.dbUnavailable', params)).toMatch(/not be saved/);
  });
});
