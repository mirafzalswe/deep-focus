// Строка задачи: ▶ запуск таймера, название, проект, приоритет, время, статус, правка, удаление, история.
import { useState } from 'react';
import type { Project, SessionRecord, Task, TaskPatch, TaskStatus } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, cx } from '../../../shared/ui';
import { formatDuration } from '../Analytics/format';
import { SessionList } from './SessionList';
import { TaskForm } from './TaskForm';

const STATUSES: TaskStatus[] = ['open', 'inProgress', 'done', 'cancelled'];

export function TaskRow({
  task,
  project,
  projects,
  spentMs,
  canStart,
  onStart,
  onUpdate,
  onRemove,
}: {
  task: Task;
  project: Project | undefined;
  projects: Project[];
  spentMs: number;
  canStart: boolean;
  onStart: (task: Task) => void;
  onUpdate: (id: string, patch: TaskPatch) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [history, setHistory] = useState<SessionRecord[] | null>(null);

  const toggleHistory = async () => {
    if (history) return setHistory(null);
    const all = await window.deepFocus.analytics.history({ from: 0, to: Date.now() + 86_400_000 });
    setHistory(all.filter((s) => s.taskId === task.id && s.kind === 'focus').reverse());
  };

  if (editing) {
    return (
      <li className="rounded-xl border border-line bg-surface p-4" data-task-id={task.id}>
        <TaskForm
          projects={projects}
          initial={task}
          onCancel={() => setEditing(false)}
          onSubmit={async (draft) => {
            await onUpdate(task.id, draft);
            setEditing(false);
          }}
        />
      </li>
    );
  }

  const finished = task.status === 'done' || task.status === 'cancelled';
  return (
    <li className="rounded-xl border border-line bg-surface p-4" data-task-id={task.id} data-task-status={task.status}>
      <div className="flex items-center gap-3">
        <Button
          variant="primary"
          disabled={!canStart}
          title={canStart ? undefined : t('tasks.timerBusy')}
          aria-label={t('tasks.startFor', { title: task.title })}
          onClick={() => onStart(task)}
          data-action="start-task"
          className="shrink-0 px-3"
        >
          ▶ {t('tasks.start')}
        </Button>
        <div className="min-w-0 flex-1">
          <div className={cx('truncate text-sm font-medium', finished ? 'text-muted line-through' : 'text-fg')}>{task.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            {project && (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
                {project.name}
              </span>
            )}
            <span>{t(`tasks.priorities.${task.priority}`)}</span>
            <span data-task-spent>{t('tasks.spent', { time: formatDuration(spentMs, t) })}</span>
            {task.plannedMin !== null && <span>{t('tasks.planned', { time: formatDuration(task.plannedMin * 60_000, t) })}</span>}
          </div>
        </div>
        <select
          aria-label={t('tasks.status')}
          value={task.status}
          onChange={(e) => void onUpdate(task.id, { status: e.target.value as TaskStatus })}
          className="rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-sm text-fg"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`tasks.statuses.${s}`)}
            </option>
          ))}
        </select>
        <Button variant="ghost" onClick={() => setEditing(true)}>
          {t('tasks.edit')}
        </Button>
        {confirmRemove ? (
          <Button
            variant="danger"
            onClick={() => void onRemove(task.id)}
            onBlur={() => setConfirmRemove(false)}
            autoFocus
            title={t('tasks.deleteTaskConfirm', { title: task.title })}
            data-action="confirm-remove-task"
          >
            {t('common.confirm')}
          </Button>
        ) : (
          <Button variant="ghost" onClick={() => setConfirmRemove(true)} data-action="remove-task">
            {t('tasks.remove')}
          </Button>
        )}
      </div>
      {task.description && <p className="mt-2 text-xs text-muted">{task.description}</p>}
      <div className="mt-2">
        <button type="button" onClick={() => void toggleHistory()} className="text-xs text-accent hover:underline">
          {history ? t('tasks.historyHide') : t('tasks.historyShow')}
        </button>
        {history && (
          <div className="mt-2">
            {history.length === 0 ? <p className="text-xs text-muted">{t('tasks.historyEmpty')}</p> : <SessionList sessions={history} />}
          </div>
        )}
      </div>
    </li>
  );
}
