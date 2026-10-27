// Схема AppSettings: проверка каждого поля. Тип заставляет описать каждое поле каждой секции —
// новое поле в AppSettings без проверки здесь = ошибка типов.
import { INTERVAL_MAX_MIN, INTERVAL_MIN_MIN } from '../../shared/defaults';
import type { AppSettings, BlockRule, SoundPreset, TimerPreset } from '../../shared/types';
import { isNormalizedDomain } from '../blocker/domain';
import { v, type Check } from '../validate';

export type SettingsSchema = { [S in keyof AppSettings]: { [K in keyof AppSettings[S]]-?: Check } };

const accelerator = v.str({ max: 100 });
const volume = v.num(0, 1);

export const SETTINGS_SCHEMA: SettingsSchema = {
  timer: {
    activePresetId: v.id(),
    autoSwitch: v.bool(),
    autoStartNextCycle: v.bool(),
    keepBlockingOnPause: v.bool(),
    freeExtendMin: v.int(INTERVAL_MIN_MIN, INTERVAL_MAX_MIN),
  },
  widget: {
    opacity: v.num(0.4, 0.95),
    backgroundOpacity: v.num(0, 1),
    displayMode: v.oneOf('compact', 'standard', 'expanded'),
    alwaysOnTop: v.bool(),
    clickThrough: v.bool(),
    bounds: v.nullable(
      v.object({
        x: v.int(-100_000, 100_000),
        y: v.int(-100_000, 100_000),
        width: v.int(1, 20_000),
        height: v.int(1, 20_000),
        displayId: v.nullable(v.num()),
      }),
    ),
    anchor: v.oneOf('free', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight'),
    marginPx: v.int(0, 500),
    showOnSessionStart: v.bool(),
    hidden: v.bool(),
    onDisplayRemoved: v.oneOf('primary', 'nearest'),
  },
  blocker: {
    enabled: v.bool(),
    level: v.oneOf('standard', 'strict'),
    scheduledEnabled: v.bool(),
    strictUnlockDelaySec: v.int(0, 3600),
  },
  sound: {
    workPresetId: v.nullable(v.id()),
    breakPresetId: v.nullable(v.id()),
    autoStartOnSession: v.bool(),
    breakBehavior: v.oneOf('stop', 'continue', 'switch', 'lower'),
    lowerFactor: volume,
    masterVolume: volume,
    fadeOutMs: v.int(0, 60_000),
  },
  notifications: {
    enabled: v.bool(),
    silent: v.bool(),
    sessionStart: v.bool(),
    focusEnd: v.bool(),
    breakStart: v.bool(),
    breakEnd: v.bool(),
    dailyGoal: v.bool(),
    blockerError: v.bool(),
  },
  hotkeys: {
    startPause: accelerator,
    toggleWidget: accelerator,
    toggleClickThrough: accelerator,
    endSession: accelerator,
    toggleSound: accelerator,
  },
  goals: {
    dailyMinutes: v.int(0, 24 * 60),
    dailySessions: v.int(0, 100),
    weeklyMinutes: v.int(0, 7 * 24 * 60),
    showStreak: v.bool(),
  },
  general: {
    theme: v.oneOf('dark', 'light', 'system'),
    language: v.oneOf('ru', 'en'),
    launchAtLogin: v.bool(),
    closeToTray: v.bool(),
    quitBehavior: v.oneOf('ask', 'keep', 'stop'),
  },
};

const intervalMin = v.int(INTERVAL_MIN_MIN, INTERVAL_MAX_MIN);

export const isTimerPreset: Check = v.object({
  id: v.id(),
  name: v.str({ min: 1, max: 100 }),
  builtin: v.bool(),
  focusMin: intervalMin,
  shortBreakMin: intervalMin,
  longBreakMin: intervalMin,
  cyclesBeforeLong: v.int(1, 20),
} satisfies Record<keyof TimerPreset, Check>);

export const isSoundPreset: Check = v.object({
  id: v.id(),
  name: v.str({ min: 1, max: 100 }),
  builtin: v.bool(),
  tracks: v.array(v.object({ soundId: v.id(), enabled: v.bool(), volume }), { max: 100 }),
  masterVolume: volume,
} satisfies Record<keyof SoundPreset, Check>);

const hhmm = v.str({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });

export const isBlockRule: Check = v.object({
  id: v.id(),
  // только уже нормализованный домен (Т04): бэкап/база не могут подсунуть кавычки, *, путь, IP
  pattern: (x: unknown) => typeof x === 'string' && x.length <= 253 && isNormalizedDomain(x),
  category: v.oneOf('social', 'video', 'messenger', 'news', 'entertainment', 'custom'),
  enabled: v.bool(),
  duringFocus: v.bool(),
  duringShortBreak: v.bool(),
  duringLongBreak: v.bool(),
  schedule: v.nullable(v.object({ days: v.array(v.int(0, 6), { max: 7 }), from: hhmm, to: hhmm })),
  builtin: v.bool(),
} satisfies Record<keyof BlockRule, Check>);
