import { describe, expect, it } from 'vitest';
import type { TimerSnapshot } from '../../shared/types';
import { trayIconTone, trayMenuModel, trayTooltip, type TrayItem } from './trayModel';

const snap = (over: Partial<TimerSnapshot>): TimerSnapshot =>
  ({ status: 'idle', mode: 'pomodoro', kind: 'focus', remainingMs: null, activeMs: 0, ...over }) as TimerSnapshot;

const t = (key: string, params?: Record<string, string | number>) => (params ? `${key} ${JSON.stringify(params)}` : key);

const ids = (items: TrayItem[]) => items.map((i) => ('id' in i ? i.id : '—'));
const item = (items: TrayItem[], id: string) => items.find((i) => 'id' in i && i.id === id) as Extract<TrayItem, { id: string }>;

const base = { widgetAvailable: true, widgetVisible: false, clickThrough: false, alwaysOnTop: true };

describe('trayMenuModel', () => {
  it('пункты: открыть, старт/пауза, показать таймер, интерактивность, поверх окон, выход', () => {
    expect(ids(trayMenuModel({ ...base, timer: snap({}) }))).toEqual(['open', 'startPause', 'showTimer', 'interactive', 'alwaysOnTop', '—', 'quit']);
  });

  it('подпись «старт/пауза» по состоянию таймера', () => {
    const label = (status: TimerSnapshot['status']) => item(trayMenuModel({ ...base, timer: snap({ status }) }), 'startPause').labelKey;
    expect(label('idle')).toBe('system.tray.start');
    expect(label('running')).toBe('system.tray.pause');
    expect(label('paused')).toBe('system.tray.resume');
    expect(label('awaiting')).toBe('system.tray.start');
  });

  it('флажки отражают виджет: виден, интерактивен (не click-through), поверх окон', () => {
    const m = trayMenuModel({ ...base, timer: snap({}), widgetVisible: true, clickThrough: true, alwaysOnTop: false });
    expect(item(m, 'showTimer').checked).toBe(true);
    expect(item(m, 'interactive').checked).toBe(false);
    expect(item(m, 'alwaysOnTop').checked).toBe(false);
  });

  it('без модуля таймера или виджета их пункты недоступны, «Открыть» и «Выход» — всегда', () => {
    const m = trayMenuModel({ ...base, timer: null, widgetAvailable: false });
    expect(item(m, 'startPause').enabled).toBe(false);
    expect(item(m, 'showTimer').enabled).toBe(false);
    expect(item(m, 'open').enabled).toBe(true);
    expect(item(m, 'quit').enabled).toBe(true);
  });
});

describe('trayTooltip', () => {
  it('idle — название приложения', () => {
    expect(trayTooltip(snap({}), t)).toBe('system.tray.tooltipIdle');
    expect(trayTooltip(null, t)).toBe('system.tray.tooltipIdle');
  });

  it('обратный отсчёт — остаток; секундомер — прошедшее активное время; пауза и ожидание', () => {
    expect(trayTooltip(snap({ status: 'running', remainingMs: 12 * 60_000 + 34_500 }), t)).toBe(
      'system.tray.tooltipLeft {"kind":"system.tray.kind.focus","time":"12:35"}',
    );
    expect(trayTooltip(snap({ status: 'running', mode: 'stopwatch', activeMs: 3_725_000 }), t)).toBe(
      'system.tray.tooltipElapsed {"kind":"system.tray.kind.focus","time":"1:02:05"}',
    );
    expect(trayTooltip(snap({ status: 'paused', kind: 'shortBreak', remainingMs: 61_000 }), t)).toBe(
      'system.tray.tooltipPaused {"kind":"system.tray.kind.shortBreak","time":"01:01"}',
    );
    expect(trayTooltip(snap({ status: 'awaiting' }), t)).toBe('system.tray.tooltipAwaiting');
  });
});

describe('trayIconTone', () => {
  it('цвет значка: покой, фокус, перерыв, пауза', () => {
    expect(trayIconTone(snap({}))).toBe('idle');
    expect(trayIconTone(snap({ status: 'running' }))).toBe('focus');
    expect(trayIconTone(snap({ status: 'running', kind: 'longBreak' }))).toBe('break');
    expect(trayIconTone(snap({ status: 'paused' }))).toBe('paused');
  });
});
