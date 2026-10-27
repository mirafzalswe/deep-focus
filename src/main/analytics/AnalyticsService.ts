// AnalyticsService: считает из sessions; хранит только журнал достижений (через Storage).
import { addDays, dayStart, weekStart } from '../../shared/periods';
import type { Achievement, AnalyticsSummary, AppSettings, DateRange, GoalProgress, SessionRecord } from '../../shared/types';
import type { Storage } from '../db';
import { activeMsIn, dueAchievements, focusOnly, isCompleted, streakDays, summarize } from './compute';

export interface AnalyticsDeps {
  storage: Pick<Storage, 'sessions' | 'projects' | 'achievements'>;
  goals: () => AppSettings['goals'];
}

const MIN = 60_000;
const STREAK_LOOKBACK_DAYS = 400;

export class AnalyticsService {
  constructor(private readonly deps: AnalyticsDeps) {}

  summary(range: DateRange): AnalyticsSummary {
    return summarize(this.deps.storage.sessions.list(range), range);
  }

  history(range: DateRange): SessionRecord[] {
    return this.deps.storage.sessions.list(range);
  }

  achievements(): Achievement[] {
    return this.deps.storage.achievements.list();
  }

  streak(now: number): number {
    const from = addDays(now, -STREAK_LOOKBACK_DAYS);
    return streakDays(this.deps.storage.sessions.list({ from, to: addDays(now, 1) }), now);
  }

  goalProgress(now: number): GoalProgress {
    const goals = this.deps.goals();
    const weekFrom = weekStart(now);
    const weekTo = addDays(weekFrom, 7);
    const dayFrom = dayStart(now);
    const dayTo = addDays(now, 1);
    const week = focusOnly(this.deps.storage.sessions.list({ from: weekFrom, to: weekTo }));
    const day = week.filter((s) => s.startedAt >= dayFrom && s.startedAt < dayTo);
    const projects = this.deps.storage.projects
      .list()
      .filter((p) => p.weeklyGoalMin !== null && !p.archived)
      .map((p) => ({
        projectId: p.id,
        name: p.name,
        doneMin: Math.floor(activeMsIn(week.filter((s) => s.projectId === p.id), weekFrom, weekTo) / MIN),
        goalMin: p.weeklyGoalMin as number,
      }));
    return {
      dailyMinutes: { done: Math.floor(activeMsIn(day, dayFrom, dayTo) / MIN), goal: goals.dailyMinutes },
      dailySessions: { done: day.filter((s) => isCompleted(s.endReason)).length, goal: goals.dailySessions },
      weeklyMinutes: { done: Math.floor(activeMsIn(week, weekFrom, weekTo) / MIN), goal: goals.weeklyMinutes },
      projects,
      streakDays: goals.showStreak ? this.streak(now) : null,
    };
  }

  /** Записывает достигнутые цели текущих периодов; запись одна на период. Возвращает только новые. */
  recordAchievements(now: number): Achievement[] {
    const { storage } = this.deps;
    const weekFrom = weekStart(now);
    const sessions = storage.sessions.list({ from: weekFrom, to: addDays(weekFrom, 7) });
    const known = new Set(storage.achievements.list().map((a) => a.id));
    const created: Achievement[] = [];
    for (const due of dueAchievements(sessions, this.deps.goals(), storage.projects.list(), now)) {
      if (known.has(due.id)) continue;
      const record: Achievement = { ...due, achievedAt: now };
      storage.achievements.insert(record);
      created.push(record);
    }
    return created;
  }
}

