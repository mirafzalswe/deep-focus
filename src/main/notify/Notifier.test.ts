import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { Achievement, AppSettings, SessionRecord, TimerSnapshot } from '../../shared/types';
import { TypedEmitter } from '../events';
import { Notifier, type Toast } from './Notifier';

type Notifications = AppSettings['notifications'];

class FakeTimer extends TypedEmitter<{
  sessionStarted: (s: TimerSnapshot) => void;
  intervalEnded: (r: SessionRecord) => void;
}> {
  started(s: Partial<TimerSnapshot>) {
    this.emit('sessionStarted', s as TimerSnapshot);
  }
  ended(r: Partial<SessionRecord>) {
    this.emit('intervalEnded', r as SessionRecord);
  }
}

function setup(over: Partial<Notifications> = {}, achievements: Achievement[] = []) {
  const shown: Toast[] = [];
  let settings: Notifications = { ...DEFAULT_SETTINGS.notifications, ...over };
  const list = [...achievements];
  const notifier = new Notifier({
    settings: () => settings,
    t: (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key),
    show: (toast) => shown.push(toast),
  });
  const timer = new FakeTimer();
  notifier.bindTimer(timer, () => list);
  return {
    notifier,
    timer,
    shown,
    list,
    set: (patch: Partial<Notifications>) => (settings = { ...settings, ...patch }),
  };
}

const daily = (id: string, valueMin = 240): Achievement => ({ id, kind: 'daily', period: id.slice(6), achievedAt: 1, valueMin });

describe('Notifier', () => {
  it('шесть событий: каждое отключается своим переключателем, остальные приходят', () => {
    const events = ['sessionStart', 'focusEnd', 'breakStart', 'breakEnd', 'dailyGoal', 'blockerError'] as const;
    for (const off of events) {
      const { notifier, shown } = setup({ [off]: false });
      for (const e of events) notifier.notify(e, { reasonKey: 'blocker.reason.serverDown', minutes: 25 });
      expect(shown.map((s) => s.event), off).toEqual(events.filter((e) => e !== off));
    }
  });

  it('общий выключатель гасит все уведомления', () => {
    const { notifier, shown } = setup({ enabled: false });
    expect(notifier.notify('focusEnd')).toBe(false);
    expect(notifier.notify('blockerError', { reasonKey: 'blocker.reason.serverDown' })).toBe(false);
    expect(shown).toEqual([]);
  });

  it('silent берётся из настроек в момент показа', () => {
    const { notifier, shown, set } = setup({ silent: true });
    notifier.notify('focusEnd');
    set({ silent: false });
    notifier.notify('focusEnd');
    expect(shown.map((s) => s.silent)).toEqual([true, false]);
  });

  it('ошибка блокировки: текст — причина из блокировщика', () => {
    const { notifier, shown } = setup();
    notifier.notify('blockerError', { reasonKey: 'blocker.reason.serverDown' });
    expect(shown[0]).toMatchObject({ event: 'blockerError', title: 'blocker.notify.errorTitle', body: 'blocker.reason.serverDown' });
  });

  it('события таймера: начало Focus и перерыва, конец — только завершённых интервалов', () => {
    const { timer, shown } = setup();
    timer.started({ kind: 'focus', plannedMs: 25 * 60_000 });
    timer.started({ kind: 'longBreak', plannedMs: 30 * 60_000 });
    timer.ended({ kind: 'focus', endReason: 'completed' });
    timer.ended({ kind: 'shortBreak', endReason: 'completed' });
    timer.ended({ kind: 'focus', endReason: 'stopped' });
    timer.ended({ kind: 'shortBreak', endReason: 'skipped' });
    expect(shown.map((s) => s.event)).toEqual(['sessionStart', 'breakStart', 'focusEnd', 'breakEnd']);
    expect(shown[0]!.body).toContain('"minutes":25');
  });

  it('дневная цель: уведомление один раз по новой записи достижения, старые и недельные — без уведомления', () => {
    const { timer, shown, list } = setup({}, [daily('daily:2026-10-26')]);
    timer.ended({ kind: 'focus', endReason: 'stopped' });
    expect(shown).toEqual([]);
    list.push(daily('daily:2026-10-27', 240), { id: 'weekly:2026-10-26', kind: 'weekly', period: '2026-10-26', achievedAt: 1, valueMin: 1200 });
    timer.ended({ kind: 'focus', endReason: 'completed' });
    timer.ended({ kind: 'shortBreak', endReason: 'completed' });
    expect(shown.map((s) => s.event)).toEqual(['focusEnd', 'dailyGoal', 'breakEnd']);
    expect(shown[1]!.body).toContain('"minutes":240');
  });
});
