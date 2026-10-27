import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSettings, SessionRecord } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { AnalyticsService } from './AnalyticsService';

const MIN = 60_000;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime(); // вт 27.10.2026

let storage: Storage;
let goals: AppSettings['goals'];
let n = 0;
const svc = () => new AnalyticsService({ storage, goals: () => goals });

function add(over: Partial<SessionRecord>): SessionRecord {
  const rec: SessionRecord = {
    id: `s${++n}`, kind: 'focus', mode: 'pomodoro', presetId: 'classic', taskId: null, projectId: null,
    startedAt: at(27, 10), endedAt: at(27, 10, 25), plannedMs: 25 * MIN, activeMs: 25 * MIN, pausedMs: 0,
    suspendedMs: 0, endReason: 'completed', outcome: null, recovered: false, ...over,
  };
  storage.sessions.insert(rec);
  return rec;
}

beforeEach(() => {
  storage = openStorage(':memory:');
  goals = { dailyMinutes: 50, dailySessions: 0, weeklyMinutes: 120, showStreak: true };
});
afterEach(() => storage.close());

describe('goalProgress', () => {
  it('день, неделя и недельная цель проекта; вчера не попадает в день, но попадает в неделю', () => {
    storage.projects.upsert({ id: 'p1', name: 'P', color: '#112233', weeklyGoalMin: 60, archived: false });
    add({ startedAt: at(27, 9), endedAt: at(27, 9, 25), projectId: 'p1' });
    add({ startedAt: at(26, 9), endedAt: at(26, 9, 25), activeMs: 30 * MIN, projectId: 'p1' });
    add({ startedAt: at(25, 9), endedAt: at(25, 9, 25) }); // воскресенье — прошлая неделя
    const p = svc().goalProgress(at(27, 12));
    expect(p.dailyMinutes).toEqual({ done: 25, goal: 50 });
    expect(p.dailySessions.done).toBe(1);
    expect(p.weeklyMinutes).toEqual({ done: 55, goal: 120 });
    expect(p.projects).toEqual([{ projectId: 'p1', name: 'P', doneMin: 55, goalMin: 60 }]);
  });

  it('серия: null, если выключена; сегодня без работы вчерашнюю серию не обрывает', () => {
    add({ startedAt: at(26, 9), endedAt: at(26, 9, 25) });
    add({ startedAt: at(25, 9), endedAt: at(25, 9, 25) });
    add({ startedAt: at(23, 9), endedAt: at(23, 9, 25) }); // 24-го пропуск
    expect(svc().goalProgress(at(27, 8)).streakDays).toBe(2);
    expect(svc().streak(at(27, 8))).toBe(2);
    goals = { ...goals, showStreak: false };
    expect(svc().goalProgress(at(27, 8)).streakDays).toBeNull();
  });
});

describe('recordAchievements', () => {
  it('записывает дневную цель один раз за период, повторный вызов ничего не добавляет', () => {
    add({ activeMs: 30 * MIN });
    add({ activeMs: 30 * MIN });
    const first = svc().recordAchievements(at(27, 18));
    expect(first.map((a) => a.id)).toEqual(['daily:2026-10-27']);
    expect(first[0]).toMatchObject({ kind: 'daily', period: '2026-10-27', valueMin: 60, achievedAt: at(27, 18) });
    expect(svc().recordAchievements(at(27, 19))).toEqual([]);
    expect(storage.achievements.list()).toHaveLength(1);
  });

  it('следующий день — новая запись; цель не достигнута — записи нет', () => {
    add({ activeMs: 30 * MIN });
    expect(svc().recordAchievements(at(27, 12))).toEqual([]);
    add({ activeMs: 30 * MIN });
    svc().recordAchievements(at(27, 18));
    add({ startedAt: at(28, 10), endedAt: at(28, 11), activeMs: 55 * MIN });
    expect(svc().recordAchievements(at(28, 12)).map((a) => a.id)).toEqual(['daily:2026-10-28']);
  });

  it('недельная цель и цель проекта пишутся с началом недели в периоде', () => {
    storage.projects.upsert({ id: 'p1', name: 'P', color: '#112233', weeklyGoalMin: 40, archived: false });
    add({ startedAt: at(26, 9), endedAt: at(26, 11), activeMs: 60 * MIN, projectId: 'p1' });
    add({ startedAt: at(27, 9), endedAt: at(27, 11), activeMs: 60 * MIN });
    const ids = svc().recordAchievements(at(27, 18)).map((a) => a.id).sort();
    expect(ids).toEqual(['daily:2026-10-27', 'project:p1:2026-10-26', 'weekly:2026-10-26']);
  });

  it('цель 0 — выключена', () => {
    goals = { dailyMinutes: 0, dailySessions: 0, weeklyMinutes: 0, showStreak: false };
    add({ activeMs: 600 * MIN });
    expect(svc().recordAchievements(at(27, 18))).toEqual([]);
  });
});

describe('summary', () => {
  it('берёт сессии по диапазону', () => {
    add({ startedAt: at(27, 9), endedAt: at(27, 9, 25) });
    add({ startedAt: at(20, 9), endedAt: at(20, 9, 25) });
    const r = svc().summary({ from: at(27, 0), to: at(28, 0) });
    expect(r.completedSessions).toBe(1);
    expect(r.focusActiveMs).toBe(25 * MIN);
  });
});

