// Содержимое трея (§9.1): пункты меню, подсказка с остатком, цвет значка. Чистые функции.
import type { MessageKey, TranslateParams } from '../../shared/i18n';
import type { TimerSnapshot } from '../../shared/types';

export type TrayItemId = 'open' | 'startPause' | 'showTimer' | 'interactive' | 'alwaysOnTop' | 'quit';

export type TrayItem =
  | { type: 'separator' }
  | { id: TrayItemId; labelKey: MessageKey; enabled: boolean; checked?: boolean };

export interface TrayState {
  timer: TimerSnapshot | null;
  widgetAvailable: boolean;
  widgetVisible: boolean;
  clickThrough: boolean;
  alwaysOnTop: boolean;
}

export function trayMenuModel(s: TrayState): TrayItem[] {
  const status = s.timer?.status ?? 'idle';
  const startPause: MessageKey =
    status === 'running' ? 'system.tray.pause' : status === 'paused' ? 'system.tray.resume' : 'system.tray.start';
  return [
    { id: 'open', labelKey: 'system.tray.open', enabled: true },
    { id: 'startPause', labelKey: startPause, enabled: s.timer !== null },
    { id: 'showTimer', labelKey: 'system.tray.showTimer', enabled: s.widgetAvailable, checked: s.widgetVisible },
    { id: 'interactive', labelKey: 'system.tray.interactive', enabled: s.widgetAvailable, checked: !s.clickThrough },
    { id: 'alwaysOnTop', labelKey: 'system.tray.alwaysOnTop', enabled: s.widgetAvailable, checked: s.alwaysOnTop },
    { type: 'separator' },
    { id: 'quit', labelKey: 'system.tray.quit', enabled: true },
  ];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 754000 → '12:34'; 3725000 → '1:02:05'. */
export function formatTrayClock(totalSec: number): string {
  const sec = Math.max(0, totalSec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type Translate = (key: MessageKey, params?: TranslateParams) => string;

/** Подсказка значка: остаток (обратный отсчёт) или прошедшее активное время (секундомер). */
export function trayTooltip(snap: TimerSnapshot | null, t: Translate): string {
  if (!snap || snap.status === 'idle') return t('system.tray.tooltipIdle');
  if (snap.status === 'awaiting') return t('system.tray.tooltipAwaiting');
  const kind = t(`system.tray.kind.${snap.kind}`);
  const countdown = snap.remainingMs !== null;
  const time = formatTrayClock(countdown ? Math.ceil((snap.remainingMs ?? 0) / 1000) : Math.floor(snap.activeMs / 1000));
  if (snap.status === 'paused') return t('system.tray.tooltipPaused', { kind, time });
  return t(countdown ? 'system.tray.tooltipLeft' : 'system.tray.tooltipElapsed', { kind, time });
}

export type TrayTone = 'idle' | 'focus' | 'break' | 'paused';

export function trayIconTone(snap: TimerSnapshot | null): TrayTone {
  if (!snap || snap.status === 'idle' || snap.status === 'awaiting') return 'idle';
  if (snap.status === 'paused') return 'paused';
  return snap.kind === 'focus' ? 'focus' : 'break';
}
