// Календарные границы в локальном времени. Неделя начинается с понедельника.
import type { DateRange } from './types';

export function dayStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Начало дня через n календарных дней (n может быть отрицательным); устойчиво к переходу на летнее время. */
export function addDays(ts: number, n: number): number {
  const d = new Date(dayStart(ts));
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function weekStart(ts: number): number {
  const sinceMonday = (new Date(ts).getDay() + 6) % 7;
  return addDays(ts, -sinceMonday);
}

export function monthStart(ts: number): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export const dayRange = (now: number): DateRange => ({ from: dayStart(now), to: addDays(now, 1) });
export const weekRange = (now: number): DateRange => ({ from: weekStart(now), to: addDays(weekStart(now), 7) });
export function monthRange(now: number): DateRange {
  const d = new Date(now);
  return { from: monthStart(now), to: new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime() };
}

/** 'YYYY-MM-DD' по локальной дате. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}
