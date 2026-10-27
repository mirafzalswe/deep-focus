// Форма задачи: обязательно только название; ошибка — рядом с полем, введённое не теряется.
import { useState, type FormEvent } from 'react';
import type { Priority, Project, Task, TaskDraft } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, cx } from '../../../shared/ui';

const PRIORITIES: Priority[] = ['low', 'medium', 'high'];
const inputClass =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';

export function parsePlanned(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  return n >= 1 && n <= 10_000 ? n : 'invalid';
}

export function TaskForm({
  projects,
  initial,
  onSubmit,
  onCancel,
}: {
  projects: Project[];
  initial?: Task;
  onSubmit: (draft: TaskDraft) => Promise<void>;
  onCancel?: () => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [projectId, setProjectId] = useState<string | null>(initial?.projectId ?? null);
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 'medium');
  const [planned, setPlanned] = useState(initial?.plannedMin ? String(initial.plannedMin) : '');
  const [titleError, setTitleError] = useState(false);
  const [plannedError, setPlannedError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    const plannedMin = parsePlanned(planned);
    setTitleError(trimmed === '');
    setPlannedError(plannedMin === 'invalid');
    setSaveError(false);
    if (trimmed === '' || plannedMin === 'invalid') return; // поля остаются как были
    try {
      await onSubmit({ title: trimmed, description, projectId, priority, plannedMin });
      if (!initial) {
        setTitle('');
        setDescription('');
        setPlanned('');
      }
    } catch {
      setSaveError(true);
    }
  };

  const visibleProjects = projects.filter((p) => !p.archived || p.id === projectId);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3" data-task-form={initial ? 'edit' : 'create'}>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t('tasks.titleLabel')}
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('tasks.titlePlaceholder')}
          aria-invalid={titleError}
          aria-describedby={titleError ? 'task-title-error' : undefined}
          maxLength={300}
          className={cx(inputClass, titleError && 'border-warn')}
          data-field="title"
        />
        {titleError && (
          <span id="task-title-error" role="alert" className="text-xs text-warn" data-error="title">
            {t('tasks.titleRequired')}
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        {t('tasks.description')}
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} maxLength={5000} className={inputClass} />
      </label>
      <div className="grid grid-cols-3 gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('tasks.project')}
          <select value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)} className={inputClass}>
            <option value="">{t('tasks.noProject')}</option>
            {visibleProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('tasks.priority')}
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {t(`tasks.priorities.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          {t('tasks.plannedMin')}
          <input
            value={planned}
            onChange={(e) => setPlanned(e.target.value)}
            inputMode="numeric"
            aria-invalid={plannedError}
            className={cx(inputClass, plannedError && 'border-warn')}
          />
          {plannedError && (
            <span role="alert" className="text-xs text-warn">
              {t('tasks.plannedInvalid')}
            </span>
          )}
        </label>
      </div>
      {saveError && (
        <p role="alert" className="text-xs text-warn">
          {t('tasks.saveFailed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" data-action="submit-task">
          {initial ? t('tasks.save') : t('tasks.add')}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} variant="ghost">
            {t('tasks.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
