// Значения по умолчанию и встроенные данные. Единственное место с длительностями по умолчанию (§2.1).
import type {
  AppSettings,
  BlockCategory,
  BlockRule,
  Project,
  SoundDef,
  SoundPreset,
  TimerPreset,
  WidgetDisplayMode,
} from './types';

export const BUILTIN_TIMER_PRESETS: readonly TimerPreset[] = [
  { id: 'classic', name: 'Pomodoro 25/5', builtin: true, focusMin: 25, shortBreakMin: 5, longBreakMin: 30, cyclesBeforeLong: 4 },
  { id: 'deep45', name: 'Deep 45/10', builtin: true, focusMin: 45, shortBreakMin: 10, longBreakMin: 30, cyclesBeforeLong: 4 },
  { id: 'deep60', name: 'Deep 60/10', builtin: true, focusMin: 60, shortBreakMin: 10, longBreakMin: 30, cyclesBeforeLong: 3 },
  { id: 'deep90', name: 'Deep 90/20', builtin: true, focusMin: 90, shortBreakMin: 20, longBreakMin: 30, cyclesBeforeLong: 2 },
];

/** Пределы длительности интервала, мин (§2.2, §2.11). */
export const INTERVAL_MIN_MIN = 1;
export const INTERVAL_MAX_MIN = 480;

/** Библиотека звуков. Файлы ищутся как userData/sounds/<id>.*, затем assets/sounds/<id>.mp3 (§5.1). */
export const SOUND_LIBRARY: readonly SoundDef[] = [
  { id: 'rain', nameKey: 'sounds.lib.rain', category: 'nature', source: { type: 'file', file: 'rain.mp3' } },
  { id: 'rain-window', nameKey: 'sounds.lib.rainWindow', category: 'nature', source: { type: 'file', file: 'rain-window.mp3' } },
  { id: 'waves', nameKey: 'sounds.lib.waves', category: 'nature', source: { type: 'file', file: 'waves.mp3' } },
  { id: 'wind', nameKey: 'sounds.lib.wind', category: 'nature', source: { type: 'file', file: 'wind.mp3' } },
  { id: 'forest', nameKey: 'sounds.lib.forest', category: 'nature', source: { type: 'file', file: 'forest.mp3' } },
  { id: 'birds', nameKey: 'sounds.lib.birds', category: 'nature', source: { type: 'file', file: 'birds.mp3' } },
  { id: 'stream', nameKey: 'sounds.lib.stream', category: 'nature', source: { type: 'file', file: 'stream.mp3' } },
  { id: 'river', nameKey: 'sounds.lib.river', category: 'nature', source: { type: 'file', file: 'river.mp3' } },
  { id: 'thunderstorm', nameKey: 'sounds.lib.thunderstorm', category: 'nature', source: { type: 'file', file: 'thunderstorm.mp3' } },
  { id: 'fireplace', nameKey: 'sounds.lib.fireplace', category: 'ambience', source: { type: 'file', file: 'fireplace.mp3' } },
  { id: 'coffee-shop', nameKey: 'sounds.lib.coffeeShop', category: 'ambience', source: { type: 'file', file: 'coffee-shop.mp3' } },
  { id: 'quiet-room', nameKey: 'sounds.lib.quietRoom', category: 'ambience', source: { type: 'file', file: 'quiet-room.mp3' } },
  { id: 'white-noise', nameKey: 'sounds.lib.whiteNoise', category: 'noise', source: { type: 'generated', generator: 'white' } },
  { id: 'pink-noise', nameKey: 'sounds.lib.pinkNoise', category: 'noise', source: { type: 'generated', generator: 'pink' } },
  { id: 'brown-noise', nameKey: 'sounds.lib.brownNoise', category: 'noise', source: { type: 'generated', generator: 'brown' } },
];

const track = (soundId: string, volume: number) => ({ soundId, enabled: true, volume });

export const BUILTIN_SOUND_PRESETS: readonly SoundPreset[] = [
  { id: 'rain-focus', name: 'Rain Focus', builtin: true, masterVolume: 0.8, tracks: [track('rain', 0.7), track('brown-noise', 0.15)] },
  { id: 'ocean-focus', name: 'Ocean Focus', builtin: true, masterVolume: 0.8, tracks: [track('waves', 0.7), track('wind', 0.2)] },
  { id: 'forest', name: 'Forest', builtin: true, masterVolume: 0.8, tracks: [track('forest', 0.6), track('birds', 0.3), track('stream', 0.3)] },
  { id: 'brown-noise', name: 'Brown Noise', builtin: true, masterVolume: 0.8, tracks: [track('brown-noise', 0.6)] },
  { id: 'coffee-shop', name: 'Coffee Shop', builtin: true, masterVolume: 0.8, tracks: [track('coffee-shop', 0.6)] },
  { id: 'silent', name: 'Silent Focus', builtin: true, masterVolume: 0.8, tracks: [] },
];

const BLOCK_SEED: ReadonlyArray<{ category: BlockCategory; enabled: boolean; domains: string[] }> = [
  {
    category: 'social',
    enabled: true,
    domains: [
      'instagram.com',
      'linkedin.com',
      'tiktok.com',
      'reddit.com',
      'x.com',
      'twitter.com',
      'facebook.com',
      'vk.com',
      'ok.ru',
      'pinterest.com',
      'threads.net',
      'threads.com',
    ],
  },
  { category: 'video', enabled: true, domains: ['youtube.com'] },
  { category: 'messenger', enabled: true, domains: ['web.telegram.org'] },
  { category: 'news', enabled: false, domains: ['news.google.com', 'lenta.ru', 'rbc.ru', 'ria.ru', 'bbc.com', 'cnn.com'] },
  { category: 'entertainment', enabled: false, domains: ['twitch.tv', 'netflix.com', 'pikabu.ru', '9gag.com', 'kinopoisk.ru'] },
];

export const BUILTIN_BLOCK_RULES: readonly BlockRule[] = BLOCK_SEED.flatMap(({ category, enabled, domains }) =>
  domains.map(
    (pattern): BlockRule => ({
      id: `builtin:${pattern}`,
      pattern,
      category,
      enabled,
      duringFocus: true,
      duringShortBreak: false,
      duringLongBreak: false,
      schedule: null,
      builtin: true,
    }),
  ),
);

export const SEED_PROJECTS: readonly Project[] = [
  { id: 'seed-dev', name: 'Разработка', color: '#5b7fa6', weeklyGoalMin: null, archived: false },
  { id: 'seed-study', name: 'Обучение', color: '#5f9479', weeklyGoalMin: null, archived: false },
  { id: 'seed-work', name: 'Работа', color: '#7d8590', weeklyGoalMin: null, archived: false },
  { id: 'seed-personal', name: 'Личные проекты', color: '#8a7ca8', weeklyGoalMin: null, archived: false },
  { id: 'seed-exams', name: 'Подготовка к экзаменам', color: '#a68b5b', weeklyGoalMin: null, archived: false },
];

export const DEFAULT_SETTINGS: AppSettings = {
  timer: {
    activePresetId: 'classic',
    autoSwitch: false,
    autoStartNextCycle: false,
    keepBlockingOnPause: true,
    freeExtendMin: 15,
  },
  widget: {
    opacity: 0.9,
    backgroundOpacity: 0.7,
    displayMode: 'standard',
    alwaysOnTop: true,
    clickThrough: false,
    bounds: null,
    anchor: 'topRight',
    marginPx: 24,
    showOnSessionStart: true,
    hidden: false,
    onDisplayRemoved: 'primary',
  },
  blocker: {
    enabled: false, // включается только после экрана согласия (§4.8.1)
    level: 'standard',
    scheduledEnabled: false,
    strictUnlockDelaySec: 60,
  },
  sound: {
    workPresetId: 'rain-focus',
    breakPresetId: null,
    autoStartOnSession: false,
    breakBehavior: 'lower',
    lowerFactor: 0.4,
    masterVolume: 0.8,
    fadeOutMs: 1500,
    signalEnabled: true,
    signalVolume: 0.6,
  },
  notifications: {
    enabled: true,
    silent: true,
    sessionStart: true,
    focusEnd: true,
    breakStart: true,
    breakEnd: true,
    dailyGoal: true,
    blockerError: true,
  },
  hotkeys: {
    startPause: 'Ctrl+Alt+Space',
    toggleWidget: 'Ctrl+Alt+W',
    toggleClickThrough: 'Ctrl+Alt+I',
    endSession: 'Ctrl+Alt+E',
    toggleSound: 'Ctrl+Alt+M',
  },
  goals: { dailyMinutes: 240, dailySessions: 6, weeklyMinutes: 1200, showStreak: false },
  general: {
    theme: 'dark',
    language: 'ru',
    launchAtLogin: false,
    closeToTray: true,
    quitBehavior: 'ask',
  },
};

/** Виджет: минимальный размер окна на режим (меньше — цифры не помещаются) и размер при смене режима (§3.7). */
export const WIDGET_MIN_SIZE = {
  compact: { width: 120, height: 40 },
  standard: { width: 180, height: 76 },
  expanded: { width: 220, height: 124 },
} as const satisfies Record<WidgetDisplayMode, { width: number; height: number }>;

export const WIDGET_DEFAULT_SIZE = {
  compact: { width: 168, height: 52 },
  standard: { width: 224, height: 96 },
  expanded: { width: 288, height: 152 },
} as const satisfies Record<WidgetDisplayMode, { width: number; height: number }>;

/** Через сколько после остановки сессии виджет прячется, если включён показ при старте сессии (§3.15). */
export const WIDGET_IDLE_HIDE_MS = 5000;
