// ЗАГЛУШКА Т01 → заполняет Т02 (TimerEngine: состояние, recovery, запись сессий).
// Каналы и проверки аргументов уже на месте; команды пока возвращают снимок idle.
import { IPC } from '../../shared/ipc';
import type { IntervalKind, SessionOutcome, TimerCommand, TimerPreset, TimerSnapshot } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isTimerPreset } from '../settings/schema';
import { isPlainObject, v } from '../validate';

const isKind = v.oneOf<IntervalKind>('focus', 'shortBreak', 'longBreak');
const isOutcome = v.oneOf<SessionOutcome>('done', 'partial', 'later', 'cancelled');

export const isTimerCommand = (x: unknown): x is TimerCommand => {
  if (!isPlainObject(x)) return false;
  switch (x.type) {
    case 'start':
      return v.object({
        type: v.any(),
        mode: v.oneOf('pomodoro', 'stopwatch', 'free'),
        kind: v.optional(isKind),
        presetId: v.optional(v.id()),
        plannedMin: v.optional(v.nullable(v.int(1, 480))),
        taskId: v.optional(v.nullable(v.id())),
      })(x);
    case 'pause':
    case 'resume':
    case 'stop':
    case 'reset':
    case 'skipBreak':
    case 'skipSession':
    case 'restartSession':
      return Object.keys(x).length === 1;
    case 'switchKind':
      return v.object({ type: v.any(), kind: isKind })(x);
    case 'extend':
      return v.object({ type: v.any(), min: v.int(1, 480) })(x);
    default:
      return false;
  }
};

function idleSnapshot(ctx: MainContext): TimerSnapshot {
  return {
    status: 'idle',
    mode: 'pomodoro',
    kind: 'focus',
    presetId: ctx.settings.get().timer.activePresetId,
    sessionId: null,
    plannedMs: null,
    startedAt: null,
    endAt: null,
    pausedAt: null,
    pausedMs: 0,
    suspendedMs: 0,
    elapsedMs: 0,
    remainingMs: null,
    activeMs: 0,
    completedFocusInCycle: 0,
    taskId: null,
    projectId: null,
    recovered: false,
    now: Date.now(),
  };
}

export function registerTimer(ctx: MainContext): void {
  const { storage } = ctx;
  handle<[TimerCommand]>(IPC.timer.command, [isTimerCommand], () => idleSnapshot(ctx));
  handle<[]>(IPC.timer.snapshot, [], () => idleSnapshot(ctx));
  handle<[]>(IPC.timer.presets, [], () => storage.timerPresets.list());
  handle<[TimerPreset]>(IPC.timer.savePreset, [isTimerPreset], (p) => {
    storage.timerPresets.upsert(p);
    return p;
  });
  handle<[string]>(IPC.timer.deletePreset, [v.id()], (id) => {
    if (storage.timerPresets.get(id)?.builtin) return false;
    storage.timerPresets.remove(id);
    return true;
  });
  handle<[string, SessionOutcome]>(IPC.timer.setOutcome, [v.id(), isOutcome], (sessionId, outcome) => {
    storage.sessions.update(sessionId, { outcome });
  });
}
