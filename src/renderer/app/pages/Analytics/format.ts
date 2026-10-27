// Форматирование длительностей и дат для Tasks/Analytics/Home. Чистые функции.
import type { MessageKey } from '@shared/i18n';

type Translate = (key: MessageKey) => string;

/** 5400000 → «1 ч 30 мин»; меньше минуты — секунды; ноль — «0 мин». */
export function formatDuration(ms: number, t: Translate): string {
  const totalMin = Math.round(ms / 60_000);
  if (ms > 0 && totalMin === 0) return `${Math.max(1, Math.round(ms / 1000))} ${t('analytics.units.s')}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m} ${t('analytics.units.m')}`;
  return m === 0 ? `${h} ${t('analytics.units.h')}` : `${h} ${t('analytics.units.h')} ${m} ${t('analytics.units.m')}`;
}

export function formatDateTime(ts: number, language: string): string {
  return new Date(ts).toLocaleString(language, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function formatDay(key: string, language: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).toLocaleDateString(language, { day: 'numeric', month: 'long', year: 'numeric' });
}
