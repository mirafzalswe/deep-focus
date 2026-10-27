// SettingsManager — единственный владелец AppSettings. Хранение — секции в таблице settings.
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings, BackupFile, SettingsSection } from '../../shared/types';
import type { Storage } from '../db';
import { TypedEmitter } from '../events';
import { isPlainObject, isSchemaKey, v } from '../validate';
import { isBlockRule, isSoundPreset, isTimerPreset, SETTINGS_SCHEMA } from './schema';

export class SettingsError extends Error {
  /** Путь к неверному полю, например 'widget.opacity' или 'backup.timerPresets'. */
  constructor(public readonly field: string) {
    super(`Invalid settings value: ${field}`);
    this.name = 'SettingsError';
  }
}

type SettingsEvents = { change: (next: AppSettings, prev: AppSettings) => void };

const clone = <T>(x: T): T => structuredClone(x);
const sections = Object.keys(SETTINGS_SCHEMA) as SettingsSection[];
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Значения из базы поверх значений по умолчанию; неверные поля молча заменяются умолчаниями. */
function loadFromStorage(stored: Record<string, unknown>): AppSettings {
  const result = clone(DEFAULT_SETTINGS);
  for (const section of sections) {
    const saved = stored[section];
    if (!isPlainObject(saved)) continue;
    const target = result[section] as Record<string, unknown>;
    const checks = SETTINGS_SCHEMA[section] as Record<string, (x: unknown) => boolean>;
    for (const [key, value] of Object.entries(saved)) {
      if (isSchemaKey(checks, key) && checks[key]!(value)) target[key] = clone(value);
    }
  }
  return result;
}

/**
 * Применяет патч к base: группы сливаются, листья заменяются целиком.
 * Любое неизвестное или неверное поле → SettingsError, base не меняется.
 */
function applyPatch(base: AppSettings, patch: unknown, prefix = ''): AppSettings {
  if (!isPlainObject(patch)) throw new SettingsError(prefix || 'patch');
  const next = clone(base);
  for (const [section, sectionPatch] of Object.entries(patch)) {
    if (!isSchemaKey(SETTINGS_SCHEMA, section)) throw new SettingsError(`${prefix}${section}`);
    if (sectionPatch === undefined) continue;
    if (!isPlainObject(sectionPatch)) throw new SettingsError(`${prefix}${section}`);
    const checks = SETTINGS_SCHEMA[section as SettingsSection] as Record<string, (x: unknown) => boolean>;
    const target = next[section as SettingsSection] as Record<string, unknown>;
    for (const [key, value] of Object.entries(sectionPatch)) {
      if (value === undefined) continue;
      const check = isSchemaKey(checks, key) ? checks[key] : undefined;
      if (!check || !check(value)) throw new SettingsError(`${prefix}${section}.${key}`);
      target[key] = clone(value);
    }
  }
  return next;
}

export class SettingsManager extends TypedEmitter<SettingsEvents> {
  private current: AppSettings;

  constructor(
    private readonly storage: Storage,
    private readonly opts: { now?: () => number; onListenerError?: (err: unknown) => void } = {},
  ) {
    super();
    this.current = loadFromStorage(storage.settings.getAll());
  }

  get(): AppSettings {
    return clone(this.current);
  }

  /** Какими станут настройки после patch(partial) — без сохранения и событий. Неверное значение → SettingsError. */
  preview(partial: unknown): AppSettings {
    return applyPatch(this.current, partial);
  }

  /** Глубокое слияние + валидация. Неверное значение → SettingsError, сохранённое не меняется. */
  patch(partial: unknown): AppSettings {
    const next = applyPatch(this.current, partial);
    this.commit(next);
    return this.get();
  }

  exportBackup(): BackupFile {
    return {
      app: 'deep-focus',
      version: 1,
      exportedAt: (this.opts.now ?? Date.now)(),
      settings: this.get(),
      timerPresets: this.storage.timerPresets.list(),
      soundPresets: this.storage.soundPresets.list(),
      blockRules: this.storage.blockRules.list(),
    };
  }

  /** Проверяет файл целиком; при любой ошибке бросает SettingsError и ничего не меняет. */
  importBackup(file: unknown): AppSettings {
    if (!isPlainObject(file)) throw new SettingsError('backup');
    if (file.app !== 'deep-focus') throw new SettingsError('backup.app');
    if (file.version !== 1) throw new SettingsError('backup.version');
    const settings = applyPatch(DEFAULT_SETTINGS, file.settings, 'backup.settings.');
    const lists = [
      ['timerPresets', isTimerPreset],
      ['soundPresets', isSoundPreset],
      ['blockRules', isBlockRule],
    ] as const;
    for (const [key, check] of lists) {
      if (file[key] !== undefined && !v.array(check)(file[key])) throw new SettingsError(`backup.${key}`);
    }
    const timerPresets = (file.timerPresets ?? []) as BackupFile['timerPresets'];
    const soundPresets = (file.soundPresets ?? []) as BackupFile['soundPresets'];
    const blockRules = (file.blockRules ?? []) as BackupFile['blockRules'];

    this.storage.transaction(() => {
      for (const p of timerPresets) this.storage.timerPresets.upsert(p);
      for (const p of soundPresets) this.storage.soundPresets.upsert(p);
      for (const r of blockRules) this.storage.blockRules.upsert(r);
      this.persist(settings, sections);
    });
    this.swap(settings);
    return this.get();
  }

  protected override onListenerError(err: unknown): void {
    this.opts.onListenerError?.(err);
  }

  private commit(next: AppSettings) {
    const changed = sections.filter((s) => !sameJson(next[s], this.current[s]));
    if (changed.length === 0) return;
    this.storage.transaction(() => this.persist(next, changed));
    this.swap(next);
  }

  private persist(next: AppSettings, which: SettingsSection[]) {
    for (const s of which) this.storage.settings.set(s, next[s]);
  }

  private swap(next: AppSettings) {
    if (sameJson(next, this.current)) return;
    const prev = this.current;
    this.current = next;
    this.emit('change', clone(next), clone(prev));
  }
}
