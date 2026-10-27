import { IPC } from '../../shared/ipc';
import type { Achievement, AnalyticsSummary, DateRange, GoalProgress, SessionRecord } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const analytics = {
  summary: (range: DateRange) => invoke<AnalyticsSummary>(IPC.analytics.summary, range),
  history: (range: DateRange) => invoke<SessionRecord[]>(IPC.analytics.history, range),
  goals: () => invoke<GoalProgress>(IPC.analytics.goals),
  achievements: () => invoke<Achievement[]>(IPC.analytics.achievements),
  onChanged: (cb: () => void) => subscribe<void>(IPC.analytics.changed, cb),
};
