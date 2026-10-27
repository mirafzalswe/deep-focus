import { describe, expect, it } from 'vitest';
import { dayRange, monthRange, weekRange } from '../../shared/periods';
import type { SessionRecord } from '../../shared/types';
import { summarize } from './compute';

const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime(); // октябрь 2026
const MIN = 60_000;

function s(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'x', kind: 'focus', mode: 'pomodoro', presetId: 'classic', taskId: null, projectId: null,
    startedAt: at(27, 10), endedAt: at(27, 10, 25), plannedMs: 25 * MIN, activeMs: 25 * MIN, pausedMs: 0,
    suspendedMs: 0, endReason: 'completed', outcome: null, recovered: false, ...over,
  };
}

describe('периоды в локальном времени', () => {
  it('день, неделя (с понедельника) и месяц вокруг вторника 27.10.2026', () => {
    const now = at(27, 15);
    expect(dayRange(now)).toEqual({ from: at(27, 0), to: at(28, 0) });
    expect(weekRange(now)).toEqual({ from: at(26, 0), to: at(2 + 31, 0) }); // пн 26.10 — пн 2.11
    expect(monthRange(now)).toEqual({ from: at(1, 0), to: new Date(2026, 10, 1).getTime() });
  });
  it('воскресенье относится к неделе, начавшейся в понедельник', () => {
    expect(weekRange(at(25, 12)).from).toBe(at(19, 0));
  });
});

describe('summarize', () => {
  const range = dayRange(at(27, 12));

  it('считает только Focus и только activeMs', () => {
    const r = summarize(
      [s({ activeMs: 20 * MIN }), s({ kind: 'shortBreak', activeMs: 5 * MIN }), s({ activeMs: 10 * MIN, endReason: 'stopped' })],
      range,
    );
    expect(r.focusActiveMs).toBe(30 * MIN);
    expect(r.completedSessions).toBe(1);
    expect(r.interruptedSessions).toBe(1);
  });

  it('completed = completed|recoveredCompleted; прерванные — остальные пять причин', () => {
    const reasons = ['completed', 'recoveredCompleted', 'stopped', 'skipped', 'restarted', 'reset', 'appQuit'] as const;
    const r = summarize(reasons.map((endReason) => s({ endReason })), range);
    expect(r.completedSessions).toBe(2);
    expect(r.interruptedSessions).toBe(5);
    expect(r.completionRate).toBeCloseTo(2 / 7);
  });

  it('средняя длительность и доля; пустой период — null и 0', () => {
    const r = summarize([s({ activeMs: 20 * MIN }), s({ activeMs: 40 * MIN, endReason: 'stopped' })], range);
    expect(r.avgSessionMs).toBe(30 * MIN);
    expect(r.completionRate).toBe(0.5);
    const empty = summarize([], range);
    expect(empty.completionRate).toBeNull();
    expect(empty.avgSessionMs).toBe(0);
  });

  it('разбивка по проектам и задачам, по убыванию времени; без привязки — id null', () => {
    const r = summarize(
      [
        s({ projectId: 'a', taskId: 't1', activeMs: 10 * MIN }),
        s({ projectId: 'a', taskId: 't1', activeMs: 5 * MIN }),
        s({ projectId: 'b', taskId: 't2', activeMs: 30 * MIN }),
        s({ projectId: null, taskId: null, activeMs: 1 * MIN }),
      ],
      range,
    );
    expect(r.byProject).toEqual([
      { id: 'b', activeMs: 30 * MIN, sessions: 1 },
      { id: 'a', activeMs: 15 * MIN, sessions: 2 },
      { id: null, activeMs: 1 * MIN, sessions: 1 },
    ]);
    expect(r.byTask.map((e) => e.id)).toEqual(['t2', 't1', null]);
  });

  it('часы: сессия, перешедшая час, делится пропорционально; сумма сохраняется', () => {
    // 10:45–11:15, активных 24 мин из 30 мин стены → по 12 мин в 10-й и 11-й час
    const r = summarize([s({ startedAt: at(27, 10, 45), endedAt: at(27, 11, 15), activeMs: 24 * MIN })], range);
    expect(r.hourlyMs[10]).toBe(12 * MIN);
    expect(r.hourlyMs[11]).toBe(12 * MIN);
    expect(r.hourlyMs.reduce((a, b) => a + b, 0)).toBe(24 * MIN);
    expect(r.hourlyMs).toHaveLength(24);
  });

  it('часы: нулевая стена — всё в час старта', () => {
    const r = summarize([s({ startedAt: at(27, 9, 30), endedAt: at(27, 9, 30), activeMs: 7 })], range);
    expect(r.hourlyMs[9]).toBe(7);
  });

  it('точность учёта: план, активное, пауза, досрочные (прервана до плана), восстановленные', () => {
    const r = summarize(
      [
        s({ plannedMs: 25 * MIN, activeMs: 25 * MIN, pausedMs: 2 * MIN }),
        s({ plannedMs: 25 * MIN, activeMs: 10 * MIN, endReason: 'stopped' }),
        s({ plannedMs: null, activeMs: 40 * MIN, endReason: 'stopped', mode: 'stopwatch' }),
        s({ plannedMs: 25 * MIN, activeMs: 25 * MIN, endReason: 'recoveredCompleted', recovered: true }),
      ],
      range,
    );
    expect(r.accuracy).toEqual({
      plannedMs: 75 * MIN,
      activeMs: 100 * MIN,
      pausedMs: 2 * MIN,
      earlyCount: 1,
      recoveredCount: 1,
    });
  });
});
