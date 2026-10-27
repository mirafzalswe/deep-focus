// Чистые расчёты аналитики (без Electron и Storage). Время — только activeMs Focus-сессий.
import { addDays, dayKey, dayStart, weekStart } from '../../shared/periods';
import type {
  AnalyticsSummary,
  BreakdownEntry,
  DateRange,
  EndReason,
  SessionRecord,
} from '../../shared/types';

const COMPLETED: readonly EndReason[] = ['completed', 'recoveredCompleted'];
const INTERRUPTED: readonly EndReason[] = ['stopped', 'skipped', 'restarted', 'reset', 'appQuit'];

export const isCompleted = (r: EndReason): boolean => COMPLETED.includes(r);
export const isInterrupted = (r: EndReason): boolean => INTERRUPTED.includes(r);
export const focusOnly = (sessions: readonly SessionRecord[]): SessionRecord[] => sessions.filter((s) => s.kind === 'focus');

function breakdown(sessions: SessionRecord[], idOf: (s: SessionRecord) => string | null): BreakdownEntry[] {
  const map = new Map<string | null, BreakdownEntry>();
  for (const s of sessions) {
    const id = idOf(s);
    const entry = map.get(id) ?? { id, activeMs: 0, sessions: 0 };
    entry.activeMs += s.activeMs;
    entry.sessions += 1;
    map.set(id, entry);
  }
  return [...map.values()].sort((a, b) => b.activeMs - a.activeMs);
}

const bump = (arr: number[], i: number, by: number): void => {
  arr[i] = (arr[i] ?? 0) + by;
};

/** Раскладывает activeMs сессии по часам суток пропорционально времени стены в каждом часе. */
export function addToHours(hourly: number[], s: SessionRecord): void {
  const wall = s.endedAt - s.startedAt;
  if (wall <= 0 || s.activeMs <= 0) {
    bump(hourly, new Date(s.startedAt).getHours(), Math.max(0, s.activeMs));
    return;
  }
  let assigned = 0;
  let lastHour = new Date(s.startedAt).getHours();
  for (let t = s.startedAt; t < s.endedAt; ) {
    const d = new Date(t);
    const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
    const next = Math.min(hourEnd, s.endedAt);
    const share = Math.floor((s.activeMs * (next - t)) / wall);
    bump(hourly, d.getHours(), share);
    assigned += share;
    lastHour = d.getHours();
    t = next;
  }
  bump(hourly, lastHour, s.activeMs - assigned); // остаток от округления — в последний затронутый час
}

export function summarize(sessions: readonly SessionRecord[], range: DateRange): AnalyticsSummary {
  const focus = focusOnly(sessions);
  const completed = focus.filter((s) => isCompleted(s.endReason)).length;
  const interrupted = focus.filter((s) => isInterrupted(s.endReason)).length;
  const focusActiveMs = focus.reduce((sum, s) => sum + s.activeMs, 0);
  const hourlyMs = new Array<number>(24).fill(0);
  for (const s of focus) addToHours(hourlyMs, s);
  return {
    range,
    focusActiveMs,
    completedSessions: completed,
    interruptedSessions: interrupted,
    completionRate: completed + interrupted === 0 ? null : completed / (completed + interrupted),
    avgSessionMs: focus.length === 0 ? 0 : Math.round(focusActiveMs / focus.length),
    byProject: breakdown(focus, (s) => s.projectId),
    byTask: breakdown(focus, (s) => s.taskId),
    hourlyMs,
    accuracy: {
      plannedMs: focus.reduce((sum, s) => sum + (s.plannedMs ?? 0), 0),
      activeMs: focusActiveMs,
      pausedMs: focus.reduce((sum, s) => sum + s.pausedMs, 0),
      earlyCount: focus.filter((s) => isInterrupted(s.endReason) && s.plannedMs !== null && s.activeMs < s.plannedMs).length,
      recoveredCount: focus.filter((s) => s.recovered).length,
    },
  };
}

/** Активные мс Focus-сессий, начавшихся в [from, to). */
export function activeMsIn(sessions: readonly SessionRecord[], from: number, to: number): number {
  return focusOnly(sessions)
    .filter((s) => s.startedAt >= from && s.startedAt < to)
    .reduce((sum, s) => sum + s.activeMs, 0);
}

/**
 * Серия дней подряд с Focus-активностью. Сегодня без активности серию не обрывает (день ещё идёт),
 * пропущенный вчера — обрывает. Считается только для вывода числа, без «пропусков» в интерфейсе.
 */
export function streakDays(sessions: readonly SessionRecord[], now: number): number {
  const active = new Set(focusOnly(sessions).filter((s) => s.activeMs > 0).map((s) => dayKey(s.startedAt)));
  let day = dayStart(now);
  if (!active.has(dayKey(day))) day = addDays(day, -1);
  let count = 0;
  while (active.has(dayKey(day))) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}

export interface GoalSettings {
  dailyMinutes: number;
  dailySessions: number;
  weeklyMinutes: number;
}

export interface DueAchievement {
  id: string;
  kind: 'daily' | 'weekly' | 'project';
  period: string;
  valueMin: number;
}

/** Достижения, выполненные на момент now: дневная цель, недельная, недельные цели проектов. Идентификатор стабилен в периоде. */
export function dueAchievements(
  sessions: readonly SessionRecord[],
  goals: GoalSettings,
  projects: ReadonlyArray<{ id: string; weeklyGoalMin: number | null }>,
  now: number,
): DueAchievement[] {
  const focus = focusOnly(sessions);
  const dayFrom = dayStart(now);
  const dayTo = addDays(now, 1);
  const weekFrom = weekStart(now);
  const weekTo = addDays(weekFrom, 7);
  const out: DueAchievement[] = [];

  const dayFocus = focus.filter((s) => s.startedAt >= dayFrom && s.startedAt < dayTo);
  const dayMin = Math.floor(dayFocus.reduce((sum, s) => sum + s.activeMs, 0) / 60_000);
  const dayDone = dayFocus.filter((s) => isCompleted(s.endReason)).length;
  const minutesMet = goals.dailyMinutes > 0 && dayMin >= goals.dailyMinutes;
  const sessionsMet = goals.dailySessions > 0 && dayDone >= goals.dailySessions;
  if (minutesMet || sessionsMet) out.push({ id: `daily:${dayKey(dayFrom)}`, kind: 'daily', period: dayKey(dayFrom), valueMin: dayMin });

  const weekFocus = focus.filter((s) => s.startedAt >= weekFrom && s.startedAt < weekTo);
  const weekMin = Math.floor(weekFocus.reduce((sum, s) => sum + s.activeMs, 0) / 60_000);
  if (goals.weeklyMinutes > 0 && weekMin >= goals.weeklyMinutes) {
    out.push({ id: `weekly:${dayKey(weekFrom)}`, kind: 'weekly', period: dayKey(weekFrom), valueMin: weekMin });
  }
  for (const p of projects) {
    if (p.weeklyGoalMin === null) continue;
    const min = Math.floor(weekFocus.filter((s) => s.projectId === p.id).reduce((sum, s) => sum + s.activeMs, 0) / 60_000);
    if (min >= p.weeklyGoalMin) {
      out.push({ id: `project:${p.id}:${dayKey(weekFrom)}`, kind: 'project', period: dayKey(weekFrom), valueMin: min });
    }
  }
  return out;
}
