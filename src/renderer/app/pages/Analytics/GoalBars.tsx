// Прогресс целей: дневные минуты и сессии, недельная цель, недельные цели проектов. Нулевая цель — выключена.
import type { GoalProgress } from '@shared/types';
import { useT } from '../../../shared/settings';
import { ProgressBar } from './ProgressBar';

interface Row {
  key: string;
  label: string;
  done: number;
  goal: number;
}

export function goalRows(goals: GoalProgress, t: ReturnType<typeof useT>): Row[] {
  const rows: Row[] = [
    { key: 'dailyMinutes', label: t('analytics.goalDailyMinutes'), ...goals.dailyMinutes },
    { key: 'dailySessions', label: t('analytics.goalDailySessions'), ...goals.dailySessions },
    { key: 'weeklyMinutes', label: t('analytics.goalWeeklyMinutes'), ...goals.weeklyMinutes },
  ];
  const active = rows.filter((r) => r.goal > 0);
  for (const p of goals.projects) {
    active.push({ key: `project:${p.projectId}`, label: t('analytics.goalProject', { name: p.name }), done: p.doneMin, goal: p.goalMin });
  }
  return active;
}

export function GoalBars({ goals }: { goals: GoalProgress }) {
  const t = useT();
  const rows = goalRows(goals, t);
  if (rows.length === 0) return <p className="text-sm text-muted">{t('analytics.goalNone')}</p>;
  return (
    <ul className="flex flex-col gap-4" data-goals>
      {rows.map((r) => (
        <li key={r.key} data-goal={r.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3 text-sm">
            <span className="text-fg">{r.label}</span>
            <span className="tabular-nums text-muted">
              {t('analytics.goalOf', { done: r.done, goal: r.goal })}
              {r.done >= r.goal && <span className="ml-2 text-ok">{t('analytics.goalReached')}</span>}
            </span>
          </div>
          <ProgressBar done={r.done} goal={r.goal} label={r.label} />
        </li>
      ))}
    </ul>
  );
}
