// Сводка дня на Home (§10.2): Deep Work сегодня, завершённые сессии, прогресс целей.
// Обновляется по analytics:changed (конец интервала, смена целей).
import { useEffect, useState } from 'react';
import { dayRange } from '@shared/periods';
import type { AnalyticsSummary, GoalProgress } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Card } from '../../../shared/ui';
import { formatDuration } from '../Analytics/format';
import { GoalBars } from '../Analytics/GoalBars';

export function GoalProgressCard() {
  const t = useT();
  const [goals, setGoals] = useState<GoalProgress | null>(null);
  const [today, setToday] = useState<AnalyticsSummary | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void window.deepFocus.analytics.goals().then((g) => alive && setGoals(g));
      void window.deepFocus.analytics.summary(dayRange(Date.now())).then((s) => alive && setToday(s));
    };
    load();
    const off = window.deepFocus.analytics.onChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!goals) return null;
  return (
    <Card title={t('system.home.today')} className="w-full">
      {today && (
        <div className="mb-4 flex flex-wrap gap-x-10 gap-y-2" data-home-today>
          <div>
            <div className="text-xs text-muted">{t('system.home.deepWork')}</div>
            <div className="text-xl font-semibold text-fg tabular-nums" data-today="deepWork">
              {formatDuration(today.focusActiveMs, t)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted">{t('system.home.sessions')}</div>
            <div className="text-xl font-semibold text-fg tabular-nums" data-today="sessions">
              {today.completedSessions}
            </div>
          </div>
        </div>
      )}
      <div data-home-goals>
        <GoalBars goals={goals} />
      </div>
    </Card>
  );
}
