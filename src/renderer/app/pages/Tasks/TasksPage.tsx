// Раздел «Задачи»: форма, список с ▶ и временем, фильтры, проекты. Задачи необязательны (§6.6, §6.7).
import { useMemo, useState } from 'react';
import type { TaskPatch, TaskStatus } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Card, PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { useTimerSnapshot } from '../Timer/useTimer';
import { ProjectsPanel } from './ProjectsPanel';
import { TaskForm } from './TaskForm';
import { TaskRow } from './TaskRow';
import { useTasksData } from './useTasksData';

const filterClass = 'rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg';
const STATUSES: TaskStatus[] = ['open', 'inProgress', 'done', 'cancelled'];

export default function TasksPage(_props: PageProps) {
  const t = useT();
  const { tasks, projects, totals, loaded, reload } = useTasksData();
  const snap = useTimerSnapshot();
  const [projectFilter, setProjectFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<TaskStatus | ''>('');

  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const visible = tasks.filter((x) => (!projectFilter || x.projectId === projectFilter) && (!statusFilter || x.status === statusFilter));
  const canStart = snap?.status === 'idle';
  const api = window.deepFocus.tasks;

  return (
    <>
      <PageHeader title={t('tasks.title')} subtitle={t('tasks.subtitle')} />

      <Card title={t('tasks.newTask')}>
        <TaskForm
          projects={projects}
          onSubmit={async (draft) => {
            await api.create(draft);
            await reload();
          }}
        />
      </Card>

      {loaded && tasks.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted" data-empty="tasks">
          {t('tasks.empty')}
        </p>
      ) : (
        <>
          <div className="mt-6 flex flex-wrap gap-3">
            <select aria-label={t('tasks.project')} value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className={filterClass}>
              <option value="">{t('tasks.filterAll')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label={t('tasks.filterStatus')}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as TaskStatus | '')}
              className={filterClass}
            >
              <option value="">{t('tasks.statusAll')}</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(`tasks.statuses.${s}`)}
                </option>
              ))}
            </select>
          </div>
          {visible.length === 0 ? (
            <p className="mt-4 text-sm text-muted">{t('tasks.emptyFiltered')}</p>
          ) : (
            <ul className="mt-4 flex flex-col gap-3" data-task-list>
              {visible.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  project={task.projectId ? projectById.get(task.projectId) : undefined}
                  projects={projects}
                  spentMs={totals.byTask[task.id] ?? 0}
                  canStart={canStart}
                  onStart={(x) => void window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro', kind: 'focus', taskId: x.id })}
                  onUpdate={async (id, patch: TaskPatch) => {
                    await api.update(id, patch);
                    await reload();
                  }}
                  onRemove={async (id) => {
                    await api.remove(id);
                    await reload();
                  }}
                />
              ))}
            </ul>
          )}
        </>
      )}

      <ProjectsPanel projects={projects} totals={totals.byProject} onChange={reload} />
    </>
  );
}
