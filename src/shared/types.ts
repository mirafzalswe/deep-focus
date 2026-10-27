// Общие типы Deep Focus. Имена — из interfaces.md; позже — только добавление полей своего домена.
// Время — number (мс Unix epoch). Длительности — …Ms / …Min.

export type Unsubscribe = () => void;

// ── Таймер ────────────────────────────────────────────────────────────────
export type IntervalKind = 'focus' | 'shortBreak' | 'longBreak';
export type TimerMode = 'pomodoro' | 'stopwatch' | 'free'; // free — Deep Work без обязательных перерывов
export type TimerStatus = 'idle' | 'running' | 'paused' | 'awaiting'; // awaiting — интервал кончился, ждём решения
export type EndReason =
  | 'completed'
  | 'stopped'
  | 'skipped'
  | 'restarted'
  | 'reset'
  | 'appQuit'
  | 'recoveredCompleted';
export type SessionOutcome = 'done' | 'partial' | 'later' | 'cancelled';

export interface TimerPreset {
  id: string;
  name: string;
  builtin: boolean;
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  cyclesBeforeLong: number;
}

export interface TimerSnapshot {
  status: TimerStatus;
  mode: TimerMode;
  kind: IntervalKind;
  presetId: string;
  sessionId: string | null;
  plannedMs: number | null; // null — stopwatch / free без лимита
  startedAt: number | null;
  endAt: number | null; // абсолютное время конца интервала
  pausedAt: number | null;
  pausedMs: number;
  suspendedMs: number;
  elapsedMs: number;
  remainingMs: number | null;
  activeMs: number; // elapsed − paused − suspended
  completedFocusInCycle: number;
  taskId: string | null;
  projectId: string | null;
  recovered: boolean;
  now: number;
}

export interface SessionRecord {
  id: string;
  kind: IntervalKind;
  mode: TimerMode;
  presetId: string;
  taskId: string | null;
  projectId: string | null;
  startedAt: number;
  endedAt: number;
  plannedMs: number | null;
  activeMs: number;
  pausedMs: number;
  suspendedMs: number;
  endReason: EndReason;
  outcome: SessionOutcome | null;
  recovered: boolean;
}

export type TimerCommand =
  | {
      type: 'start';
      mode: TimerMode;
      kind?: IntervalKind;
      presetId?: string;
      plannedMin?: number | null;
      taskId?: string | null;
    }
  | { type: 'pause' | 'resume' | 'stop' | 'reset' | 'skipBreak' | 'skipSession' | 'restartSession' }
  | { type: 'switchKind'; kind: IntervalKind }
  | { type: 'extend'; min: number };

// ── Задачи и проекты ──────────────────────────────────────────────────────
export type Priority = 'low' | 'medium' | 'high';
export type TaskStatus = 'open' | 'inProgress' | 'done' | 'cancelled';

export interface Project {
  id: string;
  name: string;
  color: string;
  weeklyGoalMin: number | null;
  archived: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  projectId: string | null;
  priority: Priority;
  plannedMin: number | null;
  status: TaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface TaskFilter {
  projectId?: string | null;
  status?: TaskStatus[];
}

type TaskEditable = 'description' | 'projectId' | 'priority' | 'plannedMin' | 'status';
/** Новая задача: обязательно только название. */
export type TaskDraft = Pick<Task, 'title'> & Partial<Pick<Task, TaskEditable>>;
export type TaskPatch = Partial<Pick<Task, 'title' | TaskEditable>>;

/** Накопленное активное время Focus-сессий, мс: по задачам и по проектам. */
export interface TimeTotals {
  byTask: Record<string, number>;
  byProject: Record<string, number>;
}

/** Завершённая Focus-сессия с задачей, результат которой ещё не отмечен (карточка на Home). */
export interface OutcomePrompt {
  sessionId: string;
  taskId: string;
  taskTitle: string;
}

// ── Блокировка ────────────────────────────────────────────────────────────
export interface Schedule {
  days: number[]; // 0=вс..6=сб
  from: string; // 'HH:MM'
  to: string; // 'HH:MM'
}

export type BlockCategory = 'social' | 'video' | 'messenger' | 'news' | 'entertainment' | 'custom';

export interface BlockRule {
  id: string;
  pattern: string; // нормализованный домен, без схемы и пути
  category: BlockCategory;
  enabled: boolean;
  duringFocus: boolean;
  duringShortBreak: boolean;
  duringLongBreak: boolean;
  schedule: Schedule | null;
  builtin: boolean;
}

export type BlockerState = 'off' | 'active' | 'error' | 'unavailable';

export interface BlockerStatus {
  state: BlockerState;
  reasonKey: string | null; // i18n-ключ причины
  activeDomains: string[];
  activeRuleIds: string[];
  verifiedAt: number | null;
  strictLocked: boolean;
  unlockAvailableAt: number | null;
  /** Пользователь прошёл экран согласия (§4.8.1); без него реестр не трогается. Т04. */
  consentGiven: boolean;
}

export interface BlockContext {
  timerKind: IntervalKind | null;
  timerStatus: TimerStatus;
  now: number;
  scheduledEnabled: boolean;
  keepBlockingOnPause: boolean;
}

// ── Звук ──────────────────────────────────────────────────────────────────
export type SoundCategory = 'nature' | 'noise' | 'ambience' | 'custom';

export interface SoundDef {
  id: string;
  nameKey: string;
  category: SoundCategory;
  source: { type: 'file'; file: string } | { type: 'generated'; generator: 'white' | 'pink' | 'brown' };
}

export interface SoundAvailability {
  id: string;
  available: boolean;
  path: string | null;
}

export interface TrackState {
  soundId: string;
  enabled: boolean;
  volume: number; // 0..1
}

export interface SoundPreset {
  id: string;
  name: string;
  builtin: boolean;
  tracks: TrackState[];
  masterVolume: number;
}

export interface AudioStatus {
  playing: boolean;
  presetId: string | null;
  tracks: TrackState[];
  masterVolume: number;
  muted: boolean;
  missing: string[];
  error: string | null;
}

/** Источник дорожки для движка: файл по df-sound:// или генератор шума. */
export type EngineSource = { type: 'url'; url: string } | { type: 'generated'; generator: 'white' | 'pink' | 'brown' };

/** main → скрытое окно audio (канал audio:engine-command). */
export type AudioEngineCommand =
  | {
      type: 'apply';
      playing: boolean;
      /** итоговое усиление мастера (громкость × уровень пресета × приглушение; 0 при mute) */
      masterGain: number;
      /** длительность затухания при переходе playing → false, мс */
      fadeMs: number;
      tracks: { soundId: string; source: EngineSource; gain: number }[];
    }
  | { type: 'probe'; requestId: number; items: { soundId: string; url: string }[] };

/** скрытое окно audio → main (канал audio:engine-status). */
export type AudioEngineReport =
  | { type: 'ready' }
  | { type: 'trackFailed'; soundId: string; reason: 'missing' | 'corrupt' }
  | { type: 'probeResult'; requestId: number; results: { soundId: string; ok: boolean }[] }
  | { type: 'error'; message: string };

// ── Виджет ────────────────────────────────────────────────────────────────
export type WidgetDisplayMode = 'compact' | 'standard' | 'expanded';
export type Anchor = 'free' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export interface WidgetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  displayId: number | null;
}

// ── Настройки ─────────────────────────────────────────────────────────────
export type Theme = 'dark' | 'light' | 'system';
export type Language = 'ru' | 'en';

export interface AppSettings {
  timer: {
    activePresetId: string;
    autoSwitch: boolean;
    autoStartNextCycle: boolean;
    keepBlockingOnPause: boolean;
    freeExtendMin: number;
  };
  widget: {
    opacity: number;
    backgroundOpacity: number;
    displayMode: WidgetDisplayMode;
    alwaysOnTop: boolean;
    clickThrough: boolean;
    bounds: WidgetBounds | null;
    anchor: Anchor;
    marginPx: number;
    showOnSessionStart: boolean;
    hidden: boolean;
    onDisplayRemoved: 'primary' | 'nearest';
  };
  blocker: {
    enabled: boolean;
    level: 'standard' | 'strict';
    scheduledEnabled: boolean;
    strictUnlockDelaySec: number;
  };
  sound: {
    workPresetId: string | null;
    breakPresetId: string | null;
    autoStartOnSession: boolean;
    breakBehavior: 'stop' | 'continue' | 'switch' | 'lower';
    lowerFactor: number;
    masterVolume: number;
    fadeOutMs: number;
  };
  notifications: {
    enabled: boolean;
    silent: boolean;
    sessionStart: boolean;
    focusEnd: boolean;
    breakStart: boolean;
    breakEnd: boolean;
    dailyGoal: boolean;
    blockerError: boolean;
  };
  hotkeys: {
    startPause: string;
    toggleWidget: string;
    toggleClickThrough: string;
    endSession: string;
    toggleSound: string;
  }; // Electron accelerator, '' — отключено
  goals: { dailyMinutes: number; dailySessions: number; weeklyMinutes: number; showStreak: boolean };
  general: {
    theme: Theme;
    language: Language;
    launchAtLogin: boolean;
    closeToTray: boolean;
    quitBehavior: 'ask' | 'keep' | 'stop';
  };
}

export type SettingsSection = keyof AppSettings;

/** Глубокий частичный патч настроек: группы сливаются, листья (включая widget.bounds) заменяются. */
export type SettingsPatch = { [S in SettingsSection]?: Partial<AppSettings[S]> };

/** Файл резервной копии (экспорт/импорт JSON): настройки, пресеты, правила. */
export interface BackupFile {
  app: 'deep-focus';
  version: 1;
  exportedAt: number;
  settings: AppSettings;
  timerPresets: TimerPreset[];
  soundPresets: SoundPreset[];
  blockRules: BlockRule[];
}

/** Результат действия с диалогом выбора файла. */
export type FileActionResult = { ok: true; path: string } | { ok: false; cancelled: true } | { ok: false; errorKey: string };

// ── Аналитика и достижения ────────────────────────────────────────────────
export interface DateRange {
  from: number;
  to: number;
}

export type AchievementKind = 'daily' | 'weekly' | 'project';

export interface Achievement {
  id: string;
  kind: AchievementKind;
  period: string;
  achievedAt: number;
  valueMin: number;
}

/** Время и число Focus-сессий по проекту или задаче (id = null — «без проекта»/«без задачи»). */
export interface BreakdownEntry {
  id: string | null;
  activeMs: number;
  sessions: number;
}

/** «Точность учёта»: запланированное против фактического (только Focus-сессии). */
export interface AccuracyBlock {
  plannedMs: number;
  activeMs: number;
  pausedMs: number;
  /** прерванные до плановой длительности */
  earlyCount: number;
  recoveredCount: number;
}

/** Сводка по Focus-сессиям за период; время — только activeMs. */
export interface AnalyticsSummary {
  range: DateRange;
  focusActiveMs: number;
  completedSessions: number;
  interruptedSessions: number;
  /** completed / (completed + interrupted); null — сессий нет */
  completionRate: number | null;
  avgSessionMs: number;
  byProject: BreakdownEntry[];
  byTask: BreakdownEntry[];
  /** 24 значения: активные мс по часам суток (локальное время) */
  hourlyMs: number[];
  accuracy: AccuracyBlock;
}

export interface ProjectGoalProgress {
  projectId: string;
  name: string;
  doneMin: number;
  goalMin: number;
}

export interface GoalProgress {
  dailyMinutes: { done: number; goal: number };
  dailySessions: { done: number; goal: number };
  weeklyMinutes: { done: number; goal: number };
  /** недельные цели проектов (только у проектов с целью) */
  projects: ProjectGoalProgress[];
  streakDays: number | null;
}

// ── Горячие клавиши, уведомления, обновления ─────────────────────────────
export type HotkeyAction = keyof AppSettings['hotkeys'];

export interface HotkeyCheck {
  ok: boolean;
  reasonKey: string | null;
}

export interface HotkeyResult {
  action: HotkeyAction;
  accelerator: string;
  registered: boolean;
  reasonKey: string | null;
}

export type NotifyEvent = 'sessionStart' | 'focusEnd' | 'breakStart' | 'breakEnd' | 'dailyGoal' | 'blockerError';

export type UpdateState = 'disabled' | 'idle' | 'checking' | 'available' | 'notAvailable' | 'downloaded' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  version: string | null;
  reasonKey: string | null;
}

// ── Модули main ───────────────────────────────────────────────────────────
export type ModuleName =
  | 'storage'
  | 'settings'
  | 'timer'
  | 'widget'
  | 'blocker'
  | 'audio'
  | 'tasks'
  | 'analytics'
  | 'hotkeys'
  | 'notify'
  | 'tray'
  | 'updater'
  | 'app';

export type ModuleState = 'ok' | 'error';

export interface ModuleStatus {
  name: ModuleName;
  state: ModuleState;
  error: string | null;
}
