// ЗАГЛУШКА Т01 → заполняет Т06 (AnalyticsService: summary, goalProgress, streak, achievements).
import { IPC } from '../../shared/ipc';
import type { AnalyticsSummary, DateRange, GoalProgress } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';

export const isRange = v.object({ from: v.int(0), to: v.int(0) });

export function registerAnalytics(ctx: MainContext): void {
  const { storage, settings } = ctx;
  handle<[DateRange]>(
    IPC.analytics.summary,
    [isRange],
    (range): AnalyticsSummary => ({ range, focusActiveMs: 0, completedSessions: 0, interruptedSessions: 0 }),
  );
  handle<[DateRange]>(IPC.analytics.history, [isRange], (range) => storage.sessions.list(range));
  handle<[]>(IPC.analytics.goals, [], (): GoalProgress => {
    const goals = settings.get().goals;
    return {
      dailyMinutes: { done: 0, goal: goals.dailyMinutes },
      dailySessions: { done: 0, goal: goals.dailySessions },
      weeklyMinutes: { done: 0, goal: goals.weeklyMinutes },
      streakDays: goals.showStreak ? 0 : null,
    };
  });
}
