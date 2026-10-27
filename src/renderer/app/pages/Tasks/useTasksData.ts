// Данные раздела Tasks: задачи, проекты, накопленное время. Источник правды — main; перезагрузка по событиям.
import { useCallback, useEffect, useState } from 'react';
import type { Project, Task, TimeTotals } from '@shared/types';

const EMPTY_TOTALS: TimeTotals = { byTask: {}, byProject: {} };

interface TasksData {
  tasks: Task[];
  projects: Project[];
  totals: TimeTotals;
}

function fetchAll(): Promise<TasksData> {
  const api = window.deepFocus;
  return Promise.all([api.tasks.list(), api.tasks.projects(), api.tasks.totals()]).then(([tasks, projects, totals]) => ({
    tasks,
    projects,
    totals,
  }));
}

export function useTasksData(): TasksData & { loaded: boolean; reload: () => Promise<void> } {
  const [data, setData] = useState<TasksData>({ tasks: [], projects: [], totals: EMPTY_TOTALS });
  const [loaded, setLoaded] = useState(false);

  const apply = useCallback((next: TasksData) => {
    setData(next);
    setLoaded(true);
  }, []);
  const reload = useCallback(() => fetchAll().then(apply), [apply]);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void fetchAll().then((next) => {
        if (alive) apply(next);
      });
    load();
    // конец интервала и отметка результата рассылают analytics:changed — время и статусы обновляются сами
    const off = window.deepFocus.analytics.onChanged(load);
    return () => {
      alive = false;
      off();
    };
  }, [apply]);

  return { ...data, loaded, reload };
}
