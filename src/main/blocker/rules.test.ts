import { describe, expect, it } from 'vitest';
import type { BlockContext, BlockRule } from '../../shared/types';
import { activeDomainsFor, activeRulesFor, isScheduleActive } from './rules';

const rule = (pattern: string, patch: Partial<BlockRule> = {}): BlockRule => ({
  id: `r:${pattern}`,
  pattern,
  category: 'custom',
  enabled: true,
  duringFocus: true,
  duringShortBreak: false,
  duringLongBreak: false,
  schedule: null,
  builtin: false,
  ...patch,
});

// 2026-10-26 — понедельник (day 1); локальное время
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
const MON_10 = at(26, 10);

const ctx = (patch: Partial<BlockContext> = {}): BlockContext => ({
  timerKind: 'focus',
  timerStatus: 'running',
  now: MON_10,
  scheduledEnabled: false,
  keepBlockingOnPause: true,
  ...patch,
});

describe('activeDomainsFor', () => {
  const rules = [
    rule('youtube.com'),
    rule('reddit.com', { duringShortBreak: true }),
    rule('vk.com', { duringLongBreak: true, duringFocus: false }),
    rule('ok.ru', { enabled: false }),
  ];

  it('Focus → правила с duringFocus; выключенные не действуют', () => {
    expect(activeDomainsFor(rules, ctx())).toEqual(['reddit.com', 'youtube.com']);
  });

  it('перерывы → свои флажки правила', () => {
    expect(activeDomainsFor(rules, ctx({ timerKind: 'shortBreak' }))).toEqual(['reddit.com']);
    expect(activeDomainsFor(rules, ctx({ timerKind: 'longBreak' }))).toEqual(['vk.com']);
  });

  it('без сессии (idle, awaiting) ничего не блокируется', () => {
    expect(activeDomainsFor(rules, ctx({ timerKind: null, timerStatus: 'idle' }))).toEqual([]);
    expect(activeDomainsFor(rules, ctx({ timerStatus: 'idle' }))).toEqual([]);
    expect(activeDomainsFor(rules, ctx({ timerStatus: 'awaiting' }))).toEqual([]);
  });

  it('пауза: блокировка остаётся или снимается по keepBlockingOnPause (§4.10)', () => {
    expect(activeDomainsFor(rules, ctx({ timerStatus: 'paused' }))).toEqual(['reddit.com', 'youtube.com']);
    expect(activeDomainsFor(rules, ctx({ timerStatus: 'paused', keepBlockingOnPause: false }))).toEqual([]);
  });

  it('Scheduled Mode: правило с расписанием работает без сессии, только если режим включён (§4.5)', () => {
    const scheduled = [rule('twitch.tv', { duringFocus: false, schedule: { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' } })];
    const idle = { timerKind: null, timerStatus: 'idle' as const };
    expect(activeDomainsFor(scheduled, ctx({ ...idle, scheduledEnabled: true }))).toEqual(['twitch.tv']);
    expect(activeDomainsFor(scheduled, ctx({ ...idle, scheduledEnabled: false }))).toEqual([]);
    // вне интервала и не в тот день
    expect(activeDomainsFor(scheduled, ctx({ ...idle, scheduledEnabled: true, now: at(26, 18) }))).toEqual([]);
    expect(activeDomainsFor(scheduled, ctx({ ...idle, scheduledEnabled: true, now: at(25, 10) }))).toEqual([]);
    // выключенное правило с расписанием не действует
    expect(
      activeDomainsFor([{ ...scheduled[0]!, enabled: false }], ctx({ ...idle, scheduledEnabled: true })),
    ).toEqual([]);
  });

  it('домены без дублей; ненормализованный pattern из базы/бэкапа не проходит', () => {
    const dirty = [
      rule('youtube.com'),
      rule('YouTube.com', { id: 'dup' }),
      rule('x"; return "DIRECT', { id: 'inj' }),
      rule('*', { id: 'star' }),
      rule('https://www.instagram.com/reels', { id: 'url' }),
      rule('localhost', { id: 'local' }),
      rule('microsoft.com', { id: 'ms' }),
    ];
    expect(activeDomainsFor(dirty, ctx())).toEqual(['instagram.com', 'youtube.com']);
    expect(activeRulesFor(dirty, ctx()).map((r) => r.id)).toEqual(['r:youtube.com', 'dup', 'url']);
  });
});

describe('isScheduleActive', () => {
  const weekdays = { days: [1, 2, 3, 4, 5], from: '09:00', to: '18:00' };
  it('дни и интервал [from, to)', () => {
    expect(isScheduleActive(weekdays, at(26, 9))).toBe(true);
    expect(isScheduleActive(weekdays, at(26, 17, 59))).toBe(true);
    expect(isScheduleActive(weekdays, at(26, 18))).toBe(false);
    expect(isScheduleActive(weekdays, at(26, 8, 59))).toBe(false);
    expect(isScheduleActive(weekdays, at(25, 12))).toBe(false); // воскресенье
  });

  it('интервал через полночь: хвост после полуночи относится к дню начала', () => {
    // пятница 22:00 → суббота 02:00
    const night = { days: [5], from: '22:00', to: '02:00' };
    expect(isScheduleActive(night, at(30, 23))).toBe(true); // пт 23:00
    expect(isScheduleActive(night, at(31, 1, 30))).toBe(true); // сб 01:30
    expect(isScheduleActive(night, at(31, 2))).toBe(false); // сб 02:00
    expect(isScheduleActive(night, at(31, 23))).toBe(false); // сб 23:00 — суббота не в списке
    expect(isScheduleActive(night, at(30, 1))).toBe(false); // пт 01:00 — хвост четверга, четверга нет
  });

  it('from == to — сутки целиком; пустые дни — никогда', () => {
    expect(isScheduleActive({ days: [1], from: '00:00', to: '00:00' }, at(26, 3))).toBe(true);
    expect(isScheduleActive({ days: [], from: '09:00', to: '18:00' }, at(26, 10))).toBe(false);
  });
});
