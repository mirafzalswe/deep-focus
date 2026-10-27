// ВРЕМЕННО (Т03): глобальные клавиши виджета — click-through (Ctrl+Alt+I) и показ/скрытие (Ctrl+Alt+W).
// Т07 переносит их в HotkeyManager: вызвать disposeWidgetHotkeys() и регистрировать там.
import { app, globalShortcut } from 'electron';
import type { AppSettings, Unsubscribe } from '../../shared/types';
import type { MainContext } from '../context';
import type { WidgetManager } from './WidgetManager';

type WidgetHotkey = Extract<keyof AppSettings['hotkeys'], 'toggleClickThrough' | 'toggleWidget'>;

let dispose: (() => void) | null = null;

export function registerWidgetHotkeys(ctx: MainContext, manager: WidgetManager): void {
  const actions: Record<WidgetHotkey, () => void> = {
    toggleClickThrough: () => manager.toggleClickThrough(),
    toggleWidget: () => manager.toggle(),
  };
  let registered: string[] = [];

  const unregisterAll = () => {
    for (const accel of registered) globalShortcut.unregister(accel);
    registered = [];
  };

  const apply = (hotkeys: AppSettings['hotkeys']) => {
    unregisterAll();
    for (const action of Object.keys(actions) as WidgetHotkey[]) {
      const accel = hotkeys[action];
      if (!accel) continue;
      let ok = false;
      try {
        ok = globalShortcut.register(accel, actions[action]);
      } catch (err) {
        ctx.logger.warn('widget', `hotkey ${action} "${accel}" is invalid`, err);
      }
      if (ok) registered.push(accel);
      else ctx.logger.warn('widget', `hotkey ${action} "${accel}" is taken by another program`);
    }
  };

  apply(ctx.settings.get().hotkeys);
  const off: Unsubscribe = ctx.settings.on('change', (next, prev) => {
    if (
      next.hotkeys.toggleClickThrough !== prev.hotkeys.toggleClickThrough ||
      next.hotkeys.toggleWidget !== prev.hotkeys.toggleWidget
    )
      apply(next.hotkeys);
  });
  app.once('will-quit', unregisterAll);
  dispose = () => {
    off();
    unregisterAll();
  };
}

/** Для Т07: снять временные регистрации, когда клавиши переедут в HotkeyManager. */
export function disposeWidgetHotkeys(): void {
  dispose?.();
  dispose = null;
}
