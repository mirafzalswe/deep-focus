// Модуль analytics: AnalyticsService + IPC. Пересчёт и запись достижений — по концу каждого интервала.
import { IPC } from '../../shared/ipc';
import type { Achievement, AnalyticsSummary, DateRange, GoalProgress } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';
import { AnalyticsService } from './AnalyticsService';

declare module '../context' {
  interface Services {
    analytics: AnalyticsService;
  }
}

export const isRange = v.object({ from: v.int(0), to: v.int(0) });

export function registerAnalytics(ctx: MainContext): void {
  const { storage, settings, logger } = ctx;
  const service = new AnalyticsService({ storage, goals: () => settings.get().goals });
  ctx.services.analytics = service;

  handle<[DateRange]>(IPC.analytics.summary, [isRange], (range): AnalyticsSummary => service.summary(range));
  handle<[DateRange]>(IPC.analytics.history, [isRange], (range) => service.history(range));
  handle<[]>(IPC.analytics.goals, [], (): GoalProgress => service.goalProgress(Date.now()));
  handle<[]>(IPC.analytics.achievements, [], (): Achievement[] => service.achievements());

  // Таймер поднимается раньше; если его нет — аналитика работает по записанным сессиям без обновлений «вживую».
  ctx.services.timer?.on('intervalEnded', () => {
    try {
      service.recordAchievements(Date.now());
    } catch (err) {
      logger.error('analytics', 'recording achievements failed', err);
    }
    ctx.broadcast(IPC.analytics.changed);
  });
  settings.on('change', (next, prev) => {
    if (JSON.stringify(next.goals) !== JSON.stringify(prev.goals)) ctx.broadcast(IPC.analytics.changed);
  });
}
