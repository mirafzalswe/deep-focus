// Проекты: список с недельной целью, архив, удаление и добавление своего проекта.
import { useState, type FormEvent } from 'react';
import type { Project } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, Card } from '../../../shared/ui';
import { formatDuration } from '../Analytics/format';

const inputClass =
  'rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';

function parseGoal(text: string): number | null | 'invalid' {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  if (!/^\d+$/.test(trimmed)) return 'invalid';
  const n = Number(trimmed);
  return n >= 1 && n <= 10_080 ? n : 'invalid';
}

function ProjectRow({
  project,
  spentMs,
  onSave,
  onDelete,
}: {
  project: Project;
  spentMs: number;
  onSave: (p: Project) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [goal, setGoal] = useState(project.weeklyGoalMin ? String(project.weeklyGoalMin) : '');
  const [confirm, setConfirm] = useState(false);
  const parsed = parseGoal(goal);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2" data-project-id={project.id}>
      <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: project.color }} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-fg">
        {project.name}
        {project.archived && <span className="ml-2 text-xs text-faint">{t('tasks.archived')}</span>}
      </span>
      <span className="text-xs text-muted">{formatDuration(spentMs, t)}</span>
      <input
        aria-label={t('tasks.projectGoal')}
        placeholder={t('tasks.projectGoalHint')}
        value={goal}
        inputMode="numeric"
        aria-invalid={parsed === 'invalid'}
        onChange={(e) => setGoal(e.target.value)}
        onBlur={() => {
          if (parsed !== 'invalid' && parsed !== project.weeklyGoalMin) void onSave({ ...project, weeklyGoalMin: parsed });
        }}
        className={`${inputClass} w-28`}
      />
      <Button variant="ghost" onClick={() => void onSave({ ...project, archived: !project.archived })}>
        {project.archived ? t('tasks.unarchive') : t('tasks.archive')}
      </Button>
      {confirm ? (
        <Button
          variant="danger"
          autoFocus
          onBlur={() => setConfirm(false)}
          onClick={() => void onDelete(project.id)}
          title={t('tasks.deleteProjectConfirm', { name: project.name })}
        >
          {t('common.confirm')}
        </Button>
      ) : (
        <Button variant="ghost" onClick={() => setConfirm(true)}>
          {t('tasks.remove')}
        </Button>
      )}
    </li>
  );
}

export function ProjectsPanel({
  projects,
  totals,
  onChange,
}: {
  projects: Project[];
  totals: Record<string, number>;
  onChange: () => Promise<void>;
}) {
  const t = useT();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#5b7fa6');
  const [goal, setGoal] = useState('');
  const [nameError, setNameError] = useState(false);

  const save = async (p: Project) => {
    await window.deepFocus.tasks.saveProject(p);
    await onChange();
  };
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const weeklyGoalMin = parseGoal(goal);
    setNameError(name.trim() === '');
    if (name.trim() === '' || weeklyGoalMin === 'invalid') return;
    await save({ id: crypto.randomUUID(), name: name.trim(), color, weeklyGoalMin, archived: false });
    setName('');
    setGoal('');
  };

  return (
    <Card title={t('tasks.projects')} className="mt-8">
      <ul className="divide-y divide-line" data-projects>
        {projects.map((p) => (
          <ProjectRow
            key={`${p.id}:${p.weeklyGoalMin}:${p.archived}`}
            project={p}
            spentMs={totals[p.id] ?? 0}
            onSave={save}
            onDelete={async (id) => {
              await window.deepFocus.tasks.deleteProject(id);
              await onChange();
            }}
          />
        ))}
      </ul>
      <form onSubmit={add} noValidate className="mt-4 flex flex-wrap items-start gap-3">
        <div className="flex flex-col gap-1">
          <input
            aria-label={t('tasks.projectName')}
            placeholder={t('tasks.projectName')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={nameError}
            maxLength={100}
            className={inputClass}
            data-field="project-name"
          />
          {nameError && (
            <span role="alert" className="text-xs text-warn">
              {t('tasks.projectNameRequired')}
            </span>
          )}
        </div>
        <input
          type="color"
          aria-label={t('tasks.projectColor')}
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-9 w-12 rounded-lg border border-line bg-surface-2"
        />
        <input
          aria-label={t('tasks.projectGoal')}
          placeholder={t('tasks.projectGoal')}
          value={goal}
          inputMode="numeric"
          onChange={(e) => setGoal(e.target.value)}
          className={`${inputClass} w-40`}
        />
        <Button type="submit" data-action="add-project">
          {t('tasks.addProject')}
        </Button>
      </form>
    </Card>
  );
}
