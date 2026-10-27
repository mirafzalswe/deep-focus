// Прогресс целей на Home: дневные минуты и сессии, недельная цель. Обновляется по analytics:changed.
import { useEffect, useState } from 'react';
import type { GoalProgress } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Card } from '../../../shared/ui';
import { GoalBars } from '../Analytics/GoalBars';

export function GoalProgressCard() {
  const t = useT();
  const [goals, setGoals] = useState<GoalProgress | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void window.deepFocus.analytics.goals().then((g) => {
        if (alive) setGoals(g);
      });
    load();
    const off = window.deepFocus.analytics.onChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, []);

  if (!goals) return null;
  return (
    <Card title={t('analytics.homeGoals')} className="mx-auto w-full max-w-xl" >
      <div data-home-goals>
        <GoalBars goals={goals} />
      </div>
    </Card>
  );
}
