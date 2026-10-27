// Модуль hotkeys: HotkeyManager на globalShortcut, пять действий, IPC (проверка, назначение, запись сочетания).
import { app, globalShortcut } from 'electron';
import { IPC } from '../../shared/ipc';
import type { AppSettings, HotkeyAction, HotkeyCheck, HotkeyResult } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';
import { disposeWidgetHotkeys } from '../widget';
import { soundToggle, startPauseCommand } from './actions';
import { HotkeyManager } from './HotkeyManager';

declare module '../context' {
  interface Services {
    hotkeys: HotkeyManager;
  }
}

const isAction = v.oneOf<HotkeyAction>('startPause', 'toggleWidget', 'toggleClickThrough', 'endSession', 'toggleSound');
const isAccelerator = v.str({ max: 100 });

/** Запись сочетания не должна оставить приложение без горячих клавиш, если окно так и не сообщило о конце. */
const RECORDING_LIMIT_MS = 60_000;

export function registerHotkeys(ctx: MainContext): void {
  const { settings, logger } = ctx;
  const log = (message: string, err?: unknown) => logger.warn('hotkeys', message, err);

  const actions: Record<HotkeyAction, () => void> = {
    startPause: () => {
      const timer = ctx.services.timer;
      if (timer) timer.command(startPauseCommand(timer.snapshot(), settings.get().timer.freeExtendMin));
    },
    toggleWidget: () => ctx.services.widget?.toggle(),
    toggleClickThrough: () => ctx.services.widget?.toggleClickThrough(),
    endSession: () => ctx.services.timer?.stop(),
    toggleSound: () => {
      const audio = ctx.services.audio;
      if (!audio) return;
      const plan = soundToggle(audio.status(), settings.get().sound.workPresetId);
      if (plan.type === 'stop') audio.stop();
      else audio.play(plan.target);
    },
  };

  // Временные регистрации Т03 (Ctrl+Alt+I/W) переезжают сюда.
  disposeWidgetHotkeys();

  const manager = new HotkeyManager({
    host: {
      register: (accel, fn) => globalShortcut.register(accel, fn),
      unregister: (accel) => globalShortcut.unregister(accel),
    },
    actions,
    onError: log,
  });
  ctx.services.hotkeys = manager;

  const publish = (results: HotkeyResult[]) => {
    for (const r of results) if (!r.registered && r.reasonKey) log(`${r.action} "${r.accelerator}" not registered: ${r.reasonKey}`);
    ctx.broadcast(IPC.hotkeys.resultsChanged, results);
  };

  let recordingTimer: NodeJS.Timeout | null = null;
  const stopRecording = () => {
    if (recordingTimer === null) return;
    clearTimeout(recordingTimer);
    recordingTimer = null;
    publish(manager.applyAll(settings.get().hotkeys));
  };

  publish(manager.applyAll(settings.get().hotkeys));
  settings.on('change', (next, prev) => {
    if (recordingTimer !== null) return; // применится по окончании записи
    if (JSON.stringify(next.hotkeys) !== JSON.stringify(prev.hotkeys)) publish(manager.applyAll(next.hotkeys));
  });
  app.on('will-quit', () => {
    if (recordingTimer) clearTimeout(recordingTimer);
    manager.dispose();
  });

  handle<[string, HotkeyAction]>(
    IPC.hotkeys.validate,
    [isAccelerator, isAction],
    (accel, action): HotkeyCheck => manager.validate(accel, action, settings.get().hotkeys),
  );
  handle<[]>(IPC.hotkeys.results, [], () => manager.results());
  handle<[HotkeyAction, string]>(IPC.hotkeys.assign, [isAction, isAccelerator], (action, accel): HotkeyResult => {
    stopRecording();
    const result = manager.assign(action, accel, settings.get().hotkeys);
    if (result.reasonKey === null) {
      const patch: Partial<AppSettings['hotkeys']> = { [action]: result.accelerator };
      settings.patch({ hotkeys: patch });
    }
    publish(manager.results());
    return result;
  });
  handle<[boolean]>(IPC.hotkeys.setRecording, [v.bool()], (on) => {
    if (!on) return stopRecording();
    if (recordingTimer !== null) clearTimeout(recordingTimer);
    else manager.suspend();
    recordingTimer = setTimeout(stopRecording, RECORDING_LIMIT_MS);
  });
}
