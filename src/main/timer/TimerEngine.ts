// TimerEngine — единственный источник правды о таймере (§2). Без Electron: часы и хранилище внедряются.
// Остаток всегда считается от абсолютного endAt; setInterval нужен только для тиков отображения,
// обнаружения конца интервала и heartbeat строки recovery.
import { randomUUID } from 'node:crypto';
import { BUILTIN_TIMER_PRESETS } from '../../shared/defaults';
import type {
  AppSettings,
  EndReason,
  IntervalKind,
  SessionOutcome,
  SessionRecord,
  TimerCommand,
  TimerMode,
  TimerPreset,
  TimerSnapshot,
  TimerStatus,
} from '../../shared/types';
import type { Storage } from '../db';
import { TypedEmitter } from '../events';
import { isPlainObject, v } from '../validate';

export interface Clock {
  now(): number;
}

/** Обёртка над Storage: всё, что движку нужно от базы. */
export interface TimerStore {
  preset(id: string): TimerPreset | null;
  taskProjectId(taskId: string): string | null;
  insertSession(record: SessionRecord): void;
  updateOutcome(sessionId: string, outcome: SessionOutcome): void;
  loadRecovery(): { value: unknown; updatedAt: number } | null;
  saveRecovery(value: unknown, updatedAt: number): void;
}

export function storageTimerStore(storage: Storage): TimerStore {
  return {
    preset: (id) => storage.timerPresets.get(id),
    taskProjectId: (taskId) => storage.tasks.get(taskId)?.projectId ?? null,
    insertSession: (record) => storage.sessions.insert(record),
    updateOutcome: (sessionId, outcome) => storage.sessions.update(sessionId, { outcome }),
    loadRecovery: () => storage.recovery.get(),
    saveRecovery: (value, updatedAt) => storage.recovery.put(value, updatedAt),
  };
}

export type TimerSettings = AppSettings['timer'];

export interface TimerEngineDeps {
  clock: Clock;
  store: TimerStore;
  settings: () => TimerSettings;
  newId?: () => string;
  onError?: (message: string, err: unknown) => void;
}

export type TimerEvents = {
  /** Раз в секунду, пока интервал идёт. */
  tick: (snap: TimerSnapshot) => void;
  /** На каждом переходе (команда, конец интервала, восстановление, смена настроек). */
  state: (snap: TimerSnapshot) => void;
  /** Записан SessionRecord (любая причина завершения). */
  intervalEnded: (record: SessionRecord) => void;
  /** Начался новый интервал (Focus или перерыв). Продолжение после восстановления — не новый. */
  sessionStarted: (snap: TimerSnapshot) => void;
};

const MIN_MS = 60_000;
export const TICK_MS = 1000;
export const HEARTBEAT_MS = 15_000;
/** Пропуск тиков дольше этого — компьютер спал без событий питания. */
const GAP_MS = 60_000;
/** Конец интервала замечен позже этого — автопереключение не запускает следующий интервал. */
const AUTO_LAG_MS = 5000;
/** reset при меньшем активном времени не пишет сессию. */
const RESET_RECORD_MIN_MS = 60_000;

interface ActiveInterval {
  sessionId: string;
  plannedMs: number | null;
  startedAt: number;
  endAt: number | null;
  pausedAt: number | null;
  pausedMs: number;
  suspendedMs: number;
  recovered: boolean;
}

/** Длина, заданная вручную («свой интервал», свободный режим) для интервала данного вида. */
interface LengthOverride {
  kind: IntervalKind;
  ms: number | null;
}

interface EngineState {
  status: TimerStatus;
  mode: TimerMode;
  /** Идущий интервал (running/paused) или предложенный следующий (idle/awaiting). */
  kind: IntervalKind;
  presetId: string;
  override: LengthOverride | null;
  taskId: string | null;
  projectId: string | null;
  completedFocusInCycle: number;
  active: ActiveInterval | null;
  suspendStartedAt: number | null;
}

const RECOVERY_VERSION = 1;

const isKind = v.oneOf<IntervalKind>('focus', 'shortBreak', 'longBreak');
const num = v.num(0);
const nullableNum = v.nullable(num);
const isRecovery = v.object({
  version: v.oneOf(RECOVERY_VERSION),
  status: v.oneOf<TimerStatus>('idle', 'running', 'paused', 'awaiting'),
  mode: v.oneOf<TimerMode>('pomodoro', 'stopwatch', 'free'),
  kind: isKind,
  presetId: v.id(),
  override: v.nullable(v.object({ kind: isKind, ms: nullableNum })),
  taskId: v.nullable(v.id()),
  projectId: v.nullable(v.id()),
  completedFocusInCycle: v.int(0, 1000),
  active: v.nullable(
    v.object({
      sessionId: v.id(),
      plannedMs: nullableNum,
      startedAt: num,
      endAt: nullableNum,
      pausedAt: nullableNum,
      pausedMs: num,
      suspendedMs: num,
      recovered: v.bool(),
    }),
  ),
  suspendStartedAt: nullableNum,
});

function parseRecovery(value: unknown): EngineState | null {
  if (!isRecovery(value) || !isPlainObject(value)) return null;
  const { version: _version, ...state } = value as unknown as EngineState & { version: number };
  const needsActive = state.status === 'running' || state.status === 'paused';
  if (needsActive !== (state.active !== null)) return null;
  if (state.status === 'paused' && state.active?.pausedAt === null) return null;
  return state;
}

export class TimerEngine extends TypedEmitter<TimerEvents> {
  private state: EngineState;
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTickAt: number | null = null;
  private lastPersistAt = 0;
  private pending: Array<() => void> = [];
  private readonly newId: () => string;

  constructor(private readonly deps: TimerEngineDeps) {
    super();
    this.newId = deps.newId ?? randomUUID;
    this.state = this.idleState();
  }

  // ── Публичный интерфейс ─────────────────────────────────────────────────
  command(cmd: TimerCommand): TimerSnapshot {
    switch (cmd.type) {
      case 'start':
        return this.start(cmd);
      case 'pause':
        return this.pause();
      case 'resume':
        return this.resume();
      case 'stop':
        return this.stop();
      case 'reset':
        return this.reset();
      case 'skipBreak':
        return this.skipBreak();
      case 'skipSession':
        return this.skipSession();
      case 'restartSession':
        return this.restartSession();
      case 'switchKind':
        return this.switchKind(cmd.kind);
      case 'extend':
        return this.extend(cmd.min);
    }
  }

  start(opts: Omit<Extract<TimerCommand, { type: 'start' }>, 'type'>): TimerSnapshot {
    const s = this.state;
    // Защита от двойного запуска: идущий или приостановленный интервал не заменяется.
    if (s.status === 'running' || s.status === 'paused') return this.snapshot();
    return this.transition((now) => {
      const mode = opts.mode;
      const kind: IntervalKind = mode === 'pomodoro' ? (opts.kind ?? (s.mode === 'pomodoro' ? s.kind : 'focus')) : 'focus';
      if (mode !== s.mode) s.completedFocusInCycle = 0;
      s.mode = mode;
      s.presetId = opts.presetId ?? this.deps.settings().activePresetId;
      if (opts.plannedMin !== undefined && !(mode === 'pomodoro' && opts.plannedMin === null)) {
        s.override = { kind, ms: opts.plannedMin === null ? null : opts.plannedMin * MIN_MS };
      } else if (s.override?.kind !== kind) {
        s.override = null;
      }
      if (opts.taskId !== undefined) {
        s.taskId = opts.taskId;
        s.projectId = opts.taskId ? this.safe(() => this.deps.store.taskProjectId(opts.taskId!), null) : null;
      }
      this.begin(kind, now);
    });
  }

  pause(): TimerSnapshot {
    if (this.state.status !== 'running') return this.snapshot();
    return this.transition((now) => {
      this.closeSuspension(now);
      this.active().pausedAt = now;
      this.state.status = 'paused';
    });
  }

  resume(): TimerSnapshot {
    if (this.state.status !== 'paused') return this.snapshot();
    return this.transition((now) => {
      const a = this.active();
      const paused = Math.max(0, now - (a.pausedAt ?? now));
      a.pausedMs += paused;
      if (a.endAt !== null) a.endAt += paused;
      a.pausedAt = null;
      this.state.status = 'running';
      this.lastTickAt = now;
    });
  }

  stop(): TimerSnapshot {
    const s = this.state;
    if (s.status === 'idle') return this.snapshot();
    return this.transition((now) => {
      if (s.active) this.finish(now, 'stopped');
      this.toIdle({ kind: 'focus', keepCycle: false });
    });
  }

  reset(): TimerSnapshot {
    const s = this.state;
    if (s.status !== 'running' && s.status !== 'paused') return this.snapshot();
    return this.transition((now) => {
      const { activeMs } = this.measure(this.active(), now);
      if (activeMs >= RESET_RECORD_MIN_MS) this.finish(now, 'reset');
      else s.active = null;
      this.toIdle({ kind: s.kind, keepCycle: true });
    });
  }

  skipSession(): TimerSnapshot {
    const s = this.state;
    if ((s.status !== 'running' && s.status !== 'paused') || s.kind !== 'focus' || s.mode !== 'pomodoro') {
      return this.snapshot();
    }
    return this.transition((now) => {
      this.finish(now, 'skipped');
      s.override = null;
      this.begin(this.breakKind(s.completedFocusInCycle), now);
    });
  }

  skipBreak(): TimerSnapshot {
    const s = this.state;
    const inBreak = s.kind !== 'focus';
    const allowed = inBreak && (s.status === 'running' || s.status === 'paused' || s.status === 'awaiting');
    if (!allowed) return this.snapshot();
    return this.transition((now) => {
      if (s.active) this.finish(now, 'skipped');
      if (s.kind === 'longBreak') s.completedFocusInCycle = 0;
      s.override = null;
      this.begin('focus', now);
    });
  }

  restartSession(): TimerSnapshot {
    const s = this.state;
    if (s.status !== 'running' && s.status !== 'paused') return this.snapshot();
    return this.transition((now) => {
      this.finish(now, 'restarted');
      this.begin(s.kind, now);
    });
  }

  switchKind(kind: IntervalKind): TimerSnapshot {
    const s = this.state;
    if (kind === s.kind && s.status !== 'awaiting') return this.snapshot();
    return this.transition((now) => {
      if (kind !== s.kind) s.override = null;
      if (kind !== 'focus') s.mode = 'pomodoro';
      if (s.active) {
        this.finish(now, 'stopped');
        this.begin(kind, now);
      } else {
        s.kind = kind;
      }
    });
  }

  extend(min: number): TimerSnapshot {
    const s = this.state;
    const ms = min * MIN_MS;
    if ((s.status === 'running' || s.status === 'paused') && s.active?.endAt != null) {
      return this.transition(() => {
        const a = this.active();
        a.endAt = (a.endAt ?? 0) + ms;
        a.plannedMs = (a.plannedMs ?? 0) + ms;
      });
    }
    if (s.status === 'awaiting' && s.mode === 'free') {
      return this.transition((now) => {
        s.override = { kind: 'focus', ms };
        this.begin('focus', now);
      });
    }
    return this.snapshot();
  }

  setOutcome(sessionId: string, outcome: SessionOutcome): void {
    this.safe(() => this.deps.store.updateOutcome(sessionId, outcome), undefined);
  }

  snapshot(): TimerSnapshot {
    const now = this.deps.clock.now();
    const s = this.state;
    const presetId = s.status === 'idle' ? this.deps.settings().activePresetId : s.presetId;
    const base = {
      status: s.status,
      mode: s.mode,
      kind: s.kind,
      presetId,
      completedFocusInCycle: s.completedFocusInCycle,
      taskId: s.taskId,
      projectId: s.projectId,
      now,
    };
    const a = s.active;
    if (!a) {
      const plannedMs = this.plannedMsFor(s.kind, s.mode, presetId);
      return {
        ...base,
        sessionId: null,
        plannedMs,
        startedAt: null,
        endAt: null,
        pausedAt: null,
        pausedMs: 0,
        suspendedMs: 0,
        elapsedMs: 0,
        remainingMs: plannedMs,
        activeMs: 0,
        recovered: false,
      };
    }
    const m = this.measure(a, now);
    const reference = a.pausedAt ?? now;
    return {
      ...base,
      sessionId: a.sessionId,
      plannedMs: a.plannedMs,
      startedAt: a.startedAt,
      endAt: a.endAt,
      pausedAt: a.pausedAt,
      pausedMs: m.pausedMs,
      suspendedMs: m.suspendedMs,
      elapsedMs: m.elapsedMs,
      remainingMs: a.endAt === null ? null : Math.max(0, a.endAt - reference),
      activeMs: m.activeMs,
      recovered: a.recovered,
    };
  }

  /** При запуске приложения: продолжает интервал из строки recovery или закрывает истёкший. */
  recover(now: number): TimerSnapshot {
    const row = this.safe(() => this.deps.store.loadRecovery(), null);
    const restored = row ? parseRecovery(row.value) : null;
    if (row && !restored) this.deps.onError?.('recovery row is invalid, starting idle', null);
    this.state = restored ?? this.idleState();
    const s = this.state;
    const a = s.active;
    if (a && row) {
      a.recovered = true;
      if (s.status === 'running') {
        // Приложение не работало с последнего heartbeat (или с начала сна) — это не активное время.
        const downFrom = Math.min(row.updatedAt, s.suspendStartedAt ?? Infinity);
        s.suspendStartedAt = null;
        if (a.endAt !== null && a.endAt <= now) {
          a.suspendedMs += Math.max(0, a.endAt - downFrom);
          this.finish(a.endAt, 'recoveredCompleted');
          this.afterCompletion(false);
        } else {
          a.suspendedMs += Math.max(0, now - downFrom);
        }
      }
    }
    s.suspendStartedAt = null;
    this.lastTickAt = now;
    this.persist(now);
    this.syncLoop();
    this.flush();
    return this.snapshot();
  }

  onSuspend(): void {
    const s = this.state;
    if (s.status !== 'running' || s.suspendStartedAt !== null) return;
    const now = this.deps.clock.now();
    s.suspendStartedAt = now;
    this.persist(now);
  }

  onResume(): void {
    this.closeSuspension(this.deps.clock.now());
    this.tick();
  }

  /** Переслать текущий снимок подписчикам (сменились настройки или пресет). */
  refresh(): void {
    this.emit('state', this.snapshot());
  }

  /** Последняя запись строки recovery (перед выходом). */
  heartbeat(): void {
    if (this.state.status !== 'idle') this.persist(this.deps.clock.now());
  }

  dispose(): void {
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
  }

  // ── Внутреннее ──────────────────────────────────────────────────────────
  private tick(): void {
    const now = this.deps.clock.now();
    const s = this.state;
    if (s.status === 'running' && s.active) {
      const a = s.active;
      if (s.suspendStartedAt !== null) {
        this.closeSuspension(now);
      } else if (this.lastTickAt !== null && now - this.lastTickAt > GAP_MS) {
        const until = a.endAt === null ? now : Math.min(now, a.endAt);
        a.suspendedMs += Math.max(0, until - this.lastTickAt - TICK_MS);
      }
      this.lastTickAt = now;
      if (a.endAt !== null && now >= a.endAt) {
        const lag = now - a.endAt;
        this.transition(() => {
          const endedAt = a.endAt ?? now;
          this.finish(endedAt, 'completed');
          this.afterCompletion(lag <= AUTO_LAG_MS, endedAt);
        });
        return;
      }
      this.emit('tick', this.snapshot());
    }
    if (s.status !== 'idle' && now - this.lastPersistAt >= HEARTBEAT_MS) this.persist(now);
  }

  /** Решение после конца интервала: ждать пользователя (awaiting) или запустить следующий. */
  private afterCompletion(allowAuto: boolean, endedAt?: number): void {
    const s = this.state;
    const finished = s.kind;
    if (s.mode !== 'pomodoro') {
      s.status = 'awaiting';
      s.kind = 'focus';
      return;
    }
    let next: IntervalKind;
    if (finished === 'focus') {
      s.completedFocusInCycle += 1;
      next = this.breakKind(s.completedFocusInCycle);
    } else {
      next = 'focus';
      if (finished === 'longBreak') s.completedFocusInCycle = 0;
    }
    s.override = null;
    const settings = this.deps.settings();
    const auto = allowAuto && settings.autoSwitch && !(finished === 'longBreak' && !settings.autoStartNextCycle);
    if (auto && endedAt !== undefined) {
      this.begin(next, endedAt);
    } else {
      s.status = 'awaiting';
      s.kind = next;
    }
  }

  private breakKind(completedFocus: number): IntervalKind {
    return completedFocus >= this.preset(this.state.presetId).cyclesBeforeLong ? 'longBreak' : 'shortBreak';
  }

  private begin(kind: IntervalKind, at: number): void {
    const s = this.state;
    s.kind = kind;
    s.status = 'running';
    s.suspendStartedAt = null;
    const plannedMs = this.plannedMsFor(kind, s.mode, s.presetId);
    s.active = {
      sessionId: this.newId(),
      plannedMs,
      startedAt: at,
      endAt: plannedMs === null ? null : at + plannedMs,
      pausedAt: null,
      pausedMs: 0,
      suspendedMs: 0,
      recovered: false,
    };
    this.lastTickAt = this.deps.clock.now();
    this.pending.push(() => this.emit('sessionStarted', this.snapshot()));
  }

  private finish(endedAt: number, endReason: EndReason): SessionRecord {
    const s = this.state;
    const a = this.active();
    this.closeSuspension(endedAt);
    const m = this.measure(a, endedAt);
    const record: SessionRecord = {
      id: a.sessionId,
      kind: s.kind,
      mode: s.mode,
      presetId: s.presetId,
      taskId: s.taskId,
      projectId: s.projectId,
      startedAt: a.startedAt,
      endedAt,
      plannedMs: a.plannedMs,
      activeMs: m.activeMs,
      pausedMs: m.pausedMs,
      suspendedMs: m.suspendedMs,
      endReason,
      outcome: null,
      recovered: a.recovered,
    };
    s.active = null;
    this.safe(() => this.deps.store.insertSession(record), undefined);
    this.pending.push(() => this.emit('intervalEnded', record));
    return record;
  }

  private toIdle({ kind, keepCycle }: { kind: IntervalKind; keepCycle: boolean }): void {
    const s = this.state;
    s.status = 'idle';
    s.active = null;
    s.suspendStartedAt = null;
    if (kind !== s.kind) s.override = null;
    s.kind = kind;
    if (!keepCycle) {
      s.completedFocusInCycle = 0;
      s.override = null;
    }
  }

  /** activeMs = elapsed − paused − suspended на момент at (текущая пауза и сон учтены). */
  private measure(a: ActiveInterval, at: number) {
    const elapsedMs = Math.max(0, at - a.startedAt);
    const pausedMs = a.pausedMs + (a.pausedAt !== null ? Math.max(0, at - a.pausedAt) : 0);
    const suspendStartedAt = this.state.suspendStartedAt;
    const suspendedMs = a.suspendedMs + (suspendStartedAt !== null ? Math.max(0, at - suspendStartedAt) : 0);
    return { elapsedMs, pausedMs, suspendedMs, activeMs: Math.max(0, elapsedMs - pausedMs - suspendedMs) };
  }

  /** Время сна до now (но не дальше endAt) уходит в suspendedMs. */
  private closeSuspension(now: number): void {
    const s = this.state;
    if (s.suspendStartedAt === null) return;
    const a = s.active;
    if (a && s.status === 'running') {
      const until = a.endAt === null ? now : Math.min(now, a.endAt);
      a.suspendedMs += Math.max(0, until - s.suspendStartedAt);
    }
    s.suspendStartedAt = null;
    this.lastTickAt = now;
  }

  private transition(fn: (now: number) => void): TimerSnapshot {
    const now = this.deps.clock.now();
    fn(now);
    this.persist(now);
    this.syncLoop();
    this.flush();
    return this.snapshot();
  }

  private flush(): void {
    const events = this.pending;
    this.pending = [];
    for (const emit of events) emit();
    this.emit('state', this.snapshot());
  }

  private persist(now: number): void {
    this.lastPersistAt = now;
    this.safe(() => this.deps.store.saveRecovery({ version: RECOVERY_VERSION, ...this.state }, now), undefined);
  }

  private syncLoop(): void {
    const needed = this.state.status !== 'idle';
    if (needed && !this.loop) this.loop = setInterval(() => this.tick(), TICK_MS);
    if (!needed && this.loop) this.dispose();
  }

  private active(): ActiveInterval {
    if (!this.state.active) throw new Error('TimerEngine: no active interval');
    return this.state.active;
  }

  private preset(id: string): TimerPreset {
    const fallback = BUILTIN_TIMER_PRESETS[0]!;
    return this.safe(() => this.deps.store.preset(id), null) ?? this.safe(() => this.deps.store.preset(fallback.id), null) ?? fallback;
  }

  private plannedMsFor(kind: IntervalKind, mode: TimerMode, presetId: string): number | null {
    if (mode === 'stopwatch') return null;
    const o = this.state.override;
    if (o && o.kind === kind) return o.ms;
    const p = this.preset(presetId);
    const min = kind === 'focus' ? p.focusMin : kind === 'shortBreak' ? p.shortBreakMin : p.longBreakMin;
    return min * MIN_MS;
  }

  private idleState(): EngineState {
    return {
      status: 'idle',
      mode: 'pomodoro',
      kind: 'focus',
      presetId: this.deps.settings().activePresetId,
      override: null,
      taskId: null,
      projectId: null,
      completedFocusInCycle: 0,
      active: null,
      suspendStartedAt: null,
    };
  }

  private safe<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch (err) {
      this.deps.onError?.('timer storage call failed', err);
      return fallback;
    }
  }

  protected override onListenerError(err: unknown): void {
    this.deps.onError?.('timer listener failed', err);
  }
}
