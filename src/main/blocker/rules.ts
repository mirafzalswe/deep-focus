// Какие правила и домены блокируются в данный момент. Чистые функции (без Electron и часов).
import type { BlockContext, BlockRule, Schedule } from '../../shared/types';
import { normalizeDomain } from './domain';

const minutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Расписание действует в момент now (локальное время): день из days и время в [from, to).
 * Интервал через полночь (from > to) принадлежит дню начала: «пт 22:00–02:00» действует до 02:00 субботы.
 * from == to — сутки целиком.
 */
export function isScheduleActive(schedule: Schedule, now: number): boolean {
  const d = new Date(now);
  const day = d.getDay();
  const t = d.getHours() * 60 + d.getMinutes();
  const from = minutes(schedule.from);
  const to = minutes(schedule.to);
  const has = (x: number) => schedule.days.includes(((x % 7) + 7) % 7);
  if (from === to) return has(day);
  if (from < to) return has(day) && t >= from && t < to;
  // через полночь
  return (has(day) && t >= from) || (has(day - 1) && t < to);
}

/** Правило участвует в текущем интервале сессии (по флажкам Focus/перерывов). */
function bySession(rule: BlockRule, ctx: BlockContext): boolean {
  if (ctx.timerKind === null) return false;
  const inSession = ctx.timerStatus === 'running' || (ctx.timerStatus === 'paused' && ctx.keepBlockingOnPause);
  if (!inSession) return false;
  switch (ctx.timerKind) {
    case 'focus':
      return rule.duringFocus;
    case 'shortBreak':
      return rule.duringShortBreak;
    case 'longBreak':
      return rule.duringLongBreak;
  }
}

function bySchedule(rule: BlockRule, ctx: BlockContext): boolean {
  return ctx.scheduledEnabled && rule.schedule !== null && isScheduleActive(rule.schedule, ctx.now);
}

/**
 * Правила, которые действуют сейчас: включено, pattern проходит normalizeDomain,
 * и подходит интервал сессии или (в Scheduled Mode) расписание.
 */
export function activeRulesFor(rules: readonly BlockRule[], ctx: BlockContext): BlockRule[] {
  return rules.filter((r) => r.enabled && normalizeDomain(r.pattern).ok && (bySession(r, ctx) || bySchedule(r, ctx)));
}

/** Нормализованные домены действующих правил: без дублей, по алфавиту. */
export function activeDomainsFor(rules: readonly BlockRule[], ctx: BlockContext): string[] {
  const domains = new Set<string>();
  for (const r of activeRulesFor(rules, ctx)) {
    const n = normalizeDomain(r.pattern);
    if (n.ok) domains.add(n.domain);
  }
  return [...domains].sort();
}
