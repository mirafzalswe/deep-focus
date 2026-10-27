// Модуль timer: TimerEngine + IPC + питание (сон/пробуждение) + восстановление при запуске.
import { app, powerMonitor } from 'electron';
import { BUILTIN_TIMER_PRESETS } from '../../shared/defaults';
import { IPC } from '../../shared/ipc';
import type { IntervalKind, SessionOutcome, TimerCommand } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isPlainObject, v } from '../validate';
import { deleteTimerPreset, saveTimerPreset } from './presets';
import { storageTimerStore, TimerEngine } from './TimerEngine';

declare module '../context' {
  interface Services {
    timer: TimerEngine;
  }
}

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

export function registerTimer(ctx: MainContext): void {
  const { storage, settings, logger } = ctx;

  const engine = new TimerEngine({
    clock: { now: () => Date.now() },
    store: storageTimerStore(storage),
    settings: () => settings.get().timer,
    onError: (message, err) => logger.error('timer', message, err),
  });
  ctx.services.timer = engine;

  // Снимки — всем окнам (главное, виджет); тики идут тем же каналом.
  engine.on('state', (snap) => ctx.broadcast(IPC.timer.state, snap));
  engine.on('tick', (snap) => ctx.broadcast(IPC.timer.state, snap));
  settings.on('change', (next, prev) => {
    if (JSON.stringify(next.timer) !== JSON.stringify(prev.timer)) engine.refresh();
  });

  handle<[TimerCommand]>(IPC.timer.command, [isTimerCommand], (cmd) => engine.command(cmd));
  handle<[]>(IPC.timer.snapshot, [], () => engine.snapshot());
  handle<[]>(IPC.timer.presets, [], () => storage.timerPresets.list());
  handle<[unknown]>(IPC.timer.savePreset, [isPlainObject], (p) => {
    const saved = saveTimerPreset(storage, p);
    engine.refresh();
    return saved;
  });
  handle<[string]>(IPC.timer.deletePreset, [v.id()], (id) => {
    const removed = deleteTimerPreset(storage, id);
    if (removed && settings.get().timer.activePresetId === id) {
      settings.patch({ timer: { activePresetId: BUILTIN_TIMER_PRESETS[0]!.id } });
    }
    engine.refresh();
    return removed;
  });
  handle<[string, SessionOutcome]>(IPC.timer.setOutcome, [v.id(), isOutcome], (sessionId, outcome) => {
    engine.setOutcome(sessionId, outcome);
  });

  powerMonitor.on('suspend', () => engine.onSuspend());
  powerMonitor.on('resume', () => engine.onResume());
  // Свежий heartbeat перед выходом: простой после него при следующем запуске уйдёт в suspendedMs.
  app.on('before-quit', () => engine.heartbeat());

  engine.recover(Date.now());
}
