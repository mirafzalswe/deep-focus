// TimerEngine на фиктивных часах: vi.useFakeTimers двигает и Date (Clock), и setInterval движка.
// Каждая строка таблицы переходов §2 — отдельный тест.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings, SessionRecord, TimerSnapshot } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { storageTimerStore, TimerEngine, TimerLockedError, type TimerChange } from './TimerEngine';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 27, 9, 0, 0);

let storage: Storage;
let settings: AppSettings['timer'];
let engine: TimerEngine;
let started: TimerSnapshot[];
let ended: SessionRecord[];
let ids = 0;

function makeEngine(): TimerEngine {
  const e = new TimerEngine({
    clock: { now: () => Date.now() },
    store: storageTimerStore(storage),
    settings: () => settings,
    newId: () => `s${++ids}`,
  });
  e.on('sessionStarted', (s) => started.push(s));
  e.on('intervalEnded', (r) => ended.push(r));
  return e;
}

beforeEach(() => {
  vi.useFakeTimers({ now: T0 });
  storage = openStorage(':memory:');
  settings = { ...DEFAULT_SETTINGS.timer };
  started = [];
  ended = [];
  engine = makeEngine();
  engine.recover(Date.now());
});

afterEach(() => {
  engine.dispose();
  storage.close();
  vi.useRealTimers();
});

const advance = (ms: number) => vi.advanceTimersByTime(ms);
const sessions = () => storage.sessions.list({ from: 0, to: Number.MAX_SAFE_INTEGER });
const focus = () => engine.command({ type: 'start', mode: 'pomodoro' });

describe('переходы', () => {
  it('idle —start→ running: Focus 25 мин из пресета, endAt абсолютный', () => {
    expect(engine.snapshot().status).toBe('idle');
    const s = focus();
    expect(s).toMatchObject({ status: 'running', mode: 'pomodoro', kind: 'focus', presetId: 'classic' });
    expect(s.plannedMs).toBe(25 * MIN);
    expect(s.startedAt).toBe(T0);
    expect(s.endAt).toBe(T0 + 25 * MIN);
    expect(s.remainingMs).toBe(25 * MIN);
    expect(s.sessionId).not.toBeNull();
    expect(started).toHaveLength(1);
    advance(10 * MIN);
    expect(engine.snapshot().remainingMs).toBe(15 * MIN);
  });

  it('повторный start при running ничего не создаёт', () => {
    const first = focus();
    advance(MIN);
    const second = engine.command({ type: 'start', mode: 'stopwatch' });
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.mode).toBe('pomodoro');
    expect(started).toHaveLength(1);
    engine.command({ type: 'stop' });
    expect(sessions()).toHaveLength(1);
  });

  it('running —pause→ paused —resume→ running: пауза сдвигает endAt и не попадает в activeMs', () => {
    focus();
    advance(5 * MIN);
    const p = engine.command({ type: 'pause' });
    expect(p.status).toBe('paused');
    expect(p.remainingMs).toBe(20 * MIN);
    advance(10 * MIN);
    expect(engine.snapshot()).toMatchObject({ remainingMs: 20 * MIN, activeMs: 5 * MIN, pausedMs: 10 * MIN });
    const r = engine.command({ type: 'resume' });
    expect(r.status).toBe('running');
    expect(r.endAt).toBe(T0 + 35 * MIN);
    advance(20 * MIN);
    expect(sessions()).toEqual([
      expect.objectContaining({ endReason: 'completed', activeMs: 25 * MIN, pausedMs: 10 * MIN, endedAt: T0 + 35 * MIN }),
    ]);
  });

  it('running|paused —stop→ idle с записью stopped и фактическим временем', () => {
    focus();
    advance(7 * MIN);
    engine.command({ type: 'pause' });
    advance(2 * MIN);
    const s = engine.command({ type: 'stop' });
    expect(s.status).toBe('idle');
    expect(s.sessionId).toBeNull();
    expect(sessions()).toEqual([
      expect.objectContaining({
        kind: 'focus',
        mode: 'pomodoro',
        endReason: 'stopped',
        activeMs: 7 * MIN,
        pausedMs: 2 * MIN,
        plannedMs: 25 * MIN,
        startedAt: T0,
        endedAt: T0 + 9 * MIN,
      }),
    ]);
    expect(ended).toHaveLength(1);
  });

  it('reset: < 60 с активного времени — без записи, иначе запись reset; тот же интервал заново', () => {
    focus();
    advance(30_000);
    let s = engine.command({ type: 'reset' });
    expect(s).toMatchObject({ status: 'idle', kind: 'focus', plannedMs: 25 * MIN, remainingMs: 25 * MIN });
    expect(sessions()).toHaveLength(0);

    engine.command({ type: 'switchKind', kind: 'longBreak' });
    engine.command({ type: 'start', mode: 'pomodoro' });
    advance(2 * MIN);
    s = engine.command({ type: 'reset' });
    expect(s).toMatchObject({ status: 'idle', kind: 'longBreak', remainingMs: 30 * MIN });
    expect(sessions()).toEqual([expect.objectContaining({ kind: 'longBreak', endReason: 'reset', activeMs: 2 * MIN })]);
  });

  it('skipSession во Focus → запись skipped, переход к перерыву', () => {
    focus();
    advance(3 * MIN);
    const s = engine.command({ type: 'skipSession' });
    expect(s).toMatchObject({ status: 'running', kind: 'shortBreak', plannedMs: 5 * MIN, startedAt: T0 + 3 * MIN });
    expect(sessions()).toEqual([expect.objectContaining({ kind: 'focus', endReason: 'skipped', activeMs: 3 * MIN })]);
  });

  it('skipBreak → запись перерыва skipped, переход к Focus', () => {
    engine.command({ type: 'start', mode: 'pomodoro', kind: 'shortBreak' });
    advance(MIN);
    const s = engine.command({ type: 'skipBreak' });
    expect(s).toMatchObject({ status: 'running', kind: 'focus', plannedMs: 25 * MIN });
    expect(sessions()).toEqual([expect.objectContaining({ kind: 'shortBreak', endReason: 'skipped', activeMs: MIN })]);
  });

  it('restartSession → запись restarted, тот же интервал с полной длиной', () => {
    const first = focus();
    advance(4 * MIN);
    const s = engine.command({ type: 'restartSession' });
    expect(s).toMatchObject({ status: 'running', kind: 'focus', startedAt: T0 + 4 * MIN, remainingMs: 25 * MIN });
    expect(s.sessionId).not.toBe(first.sessionId);
    expect(sessions()).toEqual([expect.objectContaining({ endReason: 'restarted', activeMs: 4 * MIN })]);
  });

  it('конец отсчёта, ручной режим → запись completed и awaiting; «Отдохнуть» и «Продолжить работу»', () => {
    focus();
    advance(25 * MIN + 1000);
    let s = engine.snapshot();
    expect(s).toMatchObject({ status: 'awaiting', kind: 'shortBreak', completedFocusInCycle: 1, plannedMs: 5 * MIN });
    expect(ended).toEqual([expect.objectContaining({ endReason: 'completed', activeMs: 25 * MIN, endedAt: T0 + 25 * MIN })]);
    advance(10 * MIN);
    expect(engine.snapshot().status).toBe('awaiting');

    // «Продолжить работу» — перерыв пропущен, не начавшись: записи нет
    s = engine.command({ type: 'skipBreak' });
    expect(s).toMatchObject({ status: 'running', kind: 'focus' });
    expect(sessions()).toHaveLength(1);

    // следующий конец → «Отдохнуть» = start перерыва, предложенного снимком
    advance(25 * MIN);
    s = engine.command({ type: 'start', mode: 'pomodoro' });
    expect(s).toMatchObject({ status: 'running', kind: 'shortBreak', plannedMs: 5 * MIN });
  });

  it('switchKind в idle меняет интервал без записи', () => {
    const s = engine.command({ type: 'switchKind', kind: 'longBreak' });
    expect(s).toMatchObject({ status: 'idle', kind: 'longBreak', plannedMs: 30 * MIN });
    expect(sessions()).toHaveLength(0);
  });

  it('extend добавляет минуты к идущему интервалу', () => {
    focus();
    const s = engine.command({ type: 'extend', min: 10 });
    expect(s).toMatchObject({ plannedMs: 35 * MIN, endAt: T0 + 35 * MIN });
  });
});

describe('циклы и автопереключение', () => {
  const kindsUntilIdle = (count: number) => {
    const kinds: string[] = [];
    for (let i = 0; i < count; i++) {
      const s = engine.snapshot();
      kinds.push(s.kind);
      advance((s.remainingMs ?? 0) + 1000);
    }
    return kinds;
  };

  it('N=4: после 4-го Focus — длинный перерыв; без autoStartNextCycle новый цикл ждёт', () => {
    settings.autoSwitch = true;
    focus();
    expect(kindsUntilIdle(8)).toEqual(['focus', 'shortBreak', 'focus', 'shortBreak', 'focus', 'shortBreak', 'focus', 'longBreak']);
    expect(engine.snapshot()).toMatchObject({ status: 'awaiting', kind: 'focus', completedFocusInCycle: 0 });
    expect(sessions().map((r) => r.endReason)).toEqual(Array(8).fill('completed'));
    // интервалы стыкуются без зазора
    const list = sessions();
    for (let i = 1; i < list.length; i++) expect(list[i]!.startedAt).toBe(list[i - 1]!.endedAt);
  });

  it('N=2 и autoStartNextCycle: F S F L F — новый цикл стартует сам', () => {
    storage.timerPresets.upsert({ id: 'two', name: 'Two', builtin: false, focusMin: 10, shortBreakMin: 2, longBreakMin: 15, cyclesBeforeLong: 2 });
    settings = { ...settings, activePresetId: 'two', autoSwitch: true, autoStartNextCycle: true };
    focus();
    expect(kindsUntilIdle(5)).toEqual(['focus', 'shortBreak', 'focus', 'longBreak', 'focus']);
    expect(engine.snapshot()).toMatchObject({ status: 'running', kind: 'shortBreak' });
    expect(sessions().map((r) => r.plannedMs)).toEqual([10, 2, 10, 15, 10].map((m) => m * MIN));
  });

  it('правка пресета меняет следующий интервал', () => {
    focus();
    storage.timerPresets.upsert({ ...storage.timerPresets.get('classic')!, shortBreakMin: 7 });
    advance(25 * MIN);
    expect(engine.snapshot()).toMatchObject({ status: 'awaiting', kind: 'shortBreak', plannedMs: 7 * MIN });
  });
});

describe('режимы', () => {
  it('Stopwatch считает вверх без лимита; запись kind=focus, plannedMs=null', () => {
    const s = engine.command({ type: 'start', mode: 'stopwatch' });
    expect(s).toMatchObject({ status: 'running', kind: 'focus', plannedMs: null, endAt: null, remainingMs: null });
    advance(5 * 60 * MIN);
    expect(engine.snapshot()).toMatchObject({ status: 'running', elapsedMs: 5 * 60 * MIN, activeMs: 5 * 60 * MIN });
    engine.command({ type: 'stop' });
    expect(sessions()).toEqual([
      expect.objectContaining({ mode: 'stopwatch', kind: 'focus', plannedMs: null, activeMs: 5 * 60 * MIN }),
    ]);
  });

  it('свободный Deep Work: перерыв сам не начинается, «+N мин» и «Завершить»', () => {
    settings.autoSwitch = true;
    engine.command({ type: 'start', mode: 'free', plannedMin: 90 });
    advance(90 * MIN + 1000);
    expect(engine.snapshot()).toMatchObject({ status: 'awaiting', mode: 'free', kind: 'focus' });
    expect(sessions()).toEqual([expect.objectContaining({ mode: 'free', endReason: 'completed', activeMs: 90 * MIN })]);

    const s = engine.command({ type: 'extend', min: settings.freeExtendMin });
    expect(s).toMatchObject({ status: 'running', mode: 'free', kind: 'focus', plannedMs: 15 * MIN });
    advance(15 * MIN + 1000);
    expect(engine.snapshot().status).toBe('awaiting');
    expect(engine.command({ type: 'stop' }).status).toBe('idle');
    expect(sessions()).toHaveLength(2);
  });

  it('свободный Deep Work без лимита и свой интервал', () => {
    expect(engine.command({ type: 'start', mode: 'free', plannedMin: null })).toMatchObject({ plannedMs: null, remainingMs: null });
    engine.command({ type: 'stop' });
    expect(engine.command({ type: 'start', mode: 'pomodoro', plannedMin: 10 })).toMatchObject({ plannedMs: 10 * MIN });
  });
});

describe('сон компьютера', () => {
  it('suspend/resume: остаток = endAt − now, время сна в suspendedMs', () => {
    focus();
    advance(5 * MIN);
    engine.onSuspend();
    vi.setSystemTime(T0 + 15 * MIN);
    engine.onResume();
    expect(engine.snapshot()).toMatchObject({ status: 'running', remainingMs: 10 * MIN, suspendedMs: 10 * MIN, activeMs: 5 * MIN });
    advance(10 * MIN + 1000);
    expect(sessions()).toEqual([expect.objectContaining({ endReason: 'completed', activeMs: 15 * MIN, suspendedMs: 10 * MIN })]);
  });

  it('интервал, кончившийся во сне, закрывается моментом endAt; автопереключение не стартует во сне', () => {
    settings.autoSwitch = true;
    focus();
    advance(20 * MIN);
    engine.onSuspend();
    vi.setSystemTime(T0 + 60 * MIN);
    engine.onResume();
    expect(sessions()).toEqual([
      expect.objectContaining({ endReason: 'completed', endedAt: T0 + 25 * MIN, activeMs: 20 * MIN, suspendedMs: 5 * MIN }),
    ]);
    expect(engine.snapshot()).toMatchObject({ status: 'awaiting', kind: 'shortBreak' });
  });

  it('без событий питания скачок часов тоже уходит в suspendedMs', () => {
    focus();
    advance(5 * MIN);
    vi.setSystemTime(T0 + 15 * MIN);
    advance(1000);
    expect(engine.snapshot()).toMatchObject({ status: 'running', suspendedMs: 10 * MIN });
    expect(engine.snapshot().activeMs).toBeLessThanOrEqual(5 * MIN + 1000);
  });
});

describe('восстановление', () => {
  it('строка recovery пишется на переходе и heartbeat раз в 15 с', () => {
    focus();
    expect(storage.recovery.get()?.updatedAt).toBe(T0);
    advance(14_000);
    expect(storage.recovery.get()?.updatedAt).toBe(T0);
    advance(1000);
    expect(storage.recovery.get()?.updatedAt).toBe(T0 + 15_000);
    advance(15_000);
    expect(storage.recovery.get()?.updatedAt).toBe(T0 + 30_000);
    engine.command({ type: 'pause' });
    expect(storage.recovery.get()?.updatedAt).toBe(T0 + 30_000);
  });

  it('после перезапуска идущий интервал продолжается с той же задачей и режимом; простой — в suspendedMs', () => {
    storage.tasks.insert({
      id: 't1', title: 'Отчёт', description: '', projectId: 'seed-work', priority: 'medium',
      plannedMin: null, status: 'open', createdAt: T0, updatedAt: T0,
    });
    const before = engine.command({ type: 'start', mode: 'pomodoro', taskId: 't1' });
    expect(before.projectId).toBe('seed-work');
    advance(5 * MIN); // последний heartbeat — T0+5мин
    engine.dispose(); // «сбой»

    vi.setSystemTime(T0 + 8 * MIN);
    engine = makeEngine();
    const s = engine.recover(Date.now());
    expect(s).toMatchObject({
      status: 'running', recovered: true, mode: 'pomodoro', kind: 'focus', taskId: 't1', projectId: 'seed-work',
      sessionId: before.sessionId, endAt: T0 + 25 * MIN, remainingMs: 17 * MIN, suspendedMs: 3 * MIN,
    });
    advance(17 * MIN + 1000);
    expect(sessions()).toEqual([
      expect.objectContaining({ recovered: true, taskId: 't1', endReason: 'completed', activeMs: 22 * MIN, suspendedMs: 3 * MIN }),
    ]);
  });

  it('интервал, истёкший пока приложение было выключено, пишется recoveredCompleted и ждёт решения', () => {
    settings.autoSwitch = true;
    focus();
    advance(5 * MIN);
    engine.dispose();

    vi.setSystemTime(T0 + 40 * MIN);
    engine = makeEngine();
    const s = engine.recover(Date.now());
    expect(sessions()).toEqual([
      expect.objectContaining({
        endReason: 'recoveredCompleted', recovered: true, endedAt: T0 + 25 * MIN, activeMs: 5 * MIN, suspendedMs: 20 * MIN,
      }),
    ]);
    expect(s).toMatchObject({ status: 'awaiting', kind: 'shortBreak', completedFocusInCycle: 1 });
  });

  it('пауза и цикл переживают перезапуск', () => {
    focus();
    advance(25 * MIN + 1000);
    engine.command({ type: 'start', mode: 'pomodoro' });
    advance(MIN);
    engine.command({ type: 'pause' });
    engine.dispose();
    vi.setSystemTime(T0 + 60 * MIN);
    engine = makeEngine();
    expect(engine.recover(Date.now())).toMatchObject({
      status: 'paused', kind: 'shortBreak', completedFocusInCycle: 1, remainingMs: 4 * MIN, recovered: true,
    });
  });

  it('битая строка recovery → idle, без исключения', () => {
    engine.dispose();
    storage.recovery.put({ status: 'running', garbage: true }, T0);
    engine = makeEngine();
    expect(engine.recover(Date.now()).status).toBe('idle');
  });
});

describe('проверка команд (setGuard, Strict §4.7)', () => {
  it('видит, куда команда переведёт сессию; отказ — TimerLockedError без изменений; конец интервала по времени не проверяется', () => {
    const seen: TimerChange[] = [];
    let refuse = true;
    engine.setGuard((change) => {
      seen.push(change);
      return refuse && change.type !== 'pause' && change.type !== 'restartSession' ? 'timer.strict.refused' : null;
    });
    focus();
    expect(seen).toEqual([]); // старт новой сессии не проверяется
    expect(() => engine.command({ type: 'stop' })).toThrow(TimerLockedError);
    expect(() => engine.command({ type: 'reset' })).toThrow('timer.strict.refused');
    expect(() => engine.command({ type: 'skipSession' })).toThrow(TimerLockedError);
    expect(() => engine.command({ type: 'switchKind', kind: 'longBreak' })).toThrow(TimerLockedError);
    engine.command({ type: 'pause' });
    engine.command({ type: 'resume' });
    engine.command({ type: 'restartSession' });
    expect(seen).toEqual([
      { type: 'stop', kind: null, status: 'idle' },
      { type: 'reset', kind: null, status: 'idle' },
      { type: 'skipSession', kind: 'shortBreak', status: 'running' },
      { type: 'switchKind', kind: 'longBreak', status: 'running' },
      { type: 'pause', kind: 'focus', status: 'paused' },
      { type: 'restartSession', kind: 'focus', status: 'running' },
    ]);
    expect(engine.snapshot()).toMatchObject({ status: 'running', kind: 'focus' });
    expect(ended.map((r) => r.endReason)).toEqual(['restarted']);

    settings.autoSwitch = true;
    advance(25 * MIN + 1000);
    expect(engine.snapshot()).toMatchObject({ status: 'running', kind: 'shortBreak' });
    refuse = false;
    expect(engine.command({ type: 'stop' }).status).toBe('idle');
  });
});
