// Решения жизненного цикла (§9.2, §9.3) без Electron: что делать с сессией при выходе, автозапуск.
import type { AppSettings, TimerStatus } from '../../shared/types';

/** Аргумент автозапуска: стартовать свёрнутым в трей, без главного окна. */
export const HIDDEN_ARG = '--hidden';

type QuitBehavior = AppSettings['general']['quitBehavior'];

/** 'ask' — показать диалог; 'stop' — остановить сессию и выйти; 'keep' — выйти, сессия продолжится при запуске. */
export type QuitPlan = 'ask' | 'stop' | 'keep';

export function quitPlan(status: TimerStatus, behavior: QuitBehavior): QuitPlan {
  if (status !== 'running' && status !== 'paused') return 'keep';
  return behavior;
}

/** Кнопки диалога выхода — в этом порядке. */
export const QUIT_BUTTONS = ['stop', 'keep', 'cancel'] as const;

export function quitChoice(
  response: number,
  remember: boolean,
): { plan: 'stop' | 'keep' | 'cancel'; remember: 'stop' | 'keep' | null } {
  const plan = QUIT_BUTTONS[response] ?? 'cancel';
  return { plan, remember: remember && plan !== 'cancel' ? plan : null };
}

export function loginItemSettings(enabled: boolean): { openAtLogin: boolean; args: string[] } {
  return { openAtLogin: enabled, args: [HIDDEN_ARG] };
}
