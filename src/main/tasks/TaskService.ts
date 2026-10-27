// TaskService: задачи, проекты, время по ним и результат сессии (карточка на Home).
import { randomUUID } from 'node:crypto';
import type {
  OutcomePrompt,
  Project,
  SessionOutcome,
  SessionRecord,
  Task,
  TaskDraft,
  TaskFilter,
  TaskPatch,
  TaskStatus,
  TimeTotals,
} from '../../shared/types';
import type { Storage } from '../db';

export interface TaskServiceDeps {
  storage: Pick<Storage, 'tasks' | 'projects' | 'sessions'>;
  /** Запись исхода в сессию — делает таймер (владелец sessions). */
  setSessionOutcome: (sessionId: string, outcome: SessionOutcome) => void;
  onPromptChange?: (prompt: OutcomePrompt | null) => void;
  newId?: () => string;
  now?: () => number;
}

/** Ошибка ввода; field — поле формы, рядом с которым показывается сообщение. */
export class TaskError extends Error {
  constructor(public readonly field: 'title') {
    super(`Invalid task field: ${field}`);
    this.name = 'TaskError';
  }
}

const OUTCOME_STATUS: Record<SessionOutcome, TaskStatus> = {
  done: 'done',
  partial: 'inProgress',
  later: 'open',
  cancelled: 'cancelled',
};
/** Карточка нужна, когда пользователь действительно поработал и закончил интервал сам или по таймеру. */
const PROMPT_REASONS: ReadonlyArray<SessionRecord['endReason']> = ['completed', 'recoveredCompleted', 'stopped', 'skipped'];

export class TaskService {
  private prompt: OutcomePrompt | null = null;
  private readonly newId: () => string;
  private readonly now: () => number;

  constructor(private readonly deps: TaskServiceDeps) {
    this.newId = deps.newId ?? randomUUID;
    this.now = deps.now ?? Date.now;
  }

  list(filter?: TaskFilter): Task[] {
    return this.deps.storage.tasks.list(filter);
  }

  create(draft: TaskDraft): Task {
    const title = draft.title.trim();
    if (!title) throw new TaskError('title');
    const now = this.now();
    const task: Task = {
      description: '',
      projectId: null,
      priority: 'medium',
      plannedMin: null,
      status: 'open',
      ...Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined)),
      id: this.newId(),
      title,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.storage.tasks.insert(task);
    return task;
  }

  update(id: string, patch: TaskPatch): Task | null {
    const next: TaskPatch = { ...patch };
    if (patch.title !== undefined) {
      next.title = patch.title.trim();
      if (!next.title) throw new TaskError('title');
    }
    return this.deps.storage.tasks.update(id, { ...next, updatedAt: this.now() });
  }

  remove(id: string): void {
    if (this.prompt?.taskId === id) this.setPrompt(null);
    this.deps.storage.tasks.remove(id);
  }

  projects(): Project[] {
    return this.deps.storage.projects.list();
  }

  saveProject(project: Project): Project {
    this.deps.storage.projects.upsert(project);
    return project;
  }

  deleteProject(id: string): void {
    // Задачи остаются без проекта (не полагаемся на внешние ключи БД).
    for (const task of this.deps.storage.tasks.list({ projectId: id })) {
      this.deps.storage.tasks.update(task.id, { projectId: null, updatedAt: this.now() });
    }
    this.deps.storage.projects.remove(id);
  }

  /** Накопленное активное время Focus-сессий по задачам и проектам. */
  totals(): TimeTotals {
    const totals: TimeTotals = { byTask: {}, byProject: {} };
    for (const s of this.deps.storage.sessions.list({ from: 0, to: this.now() + 86_400_000 })) {
      if (s.kind !== 'focus') continue;
      if (s.taskId) totals.byTask[s.taskId] = (totals.byTask[s.taskId] ?? 0) + s.activeMs;
      if (s.projectId) totals.byProject[s.projectId] = (totals.byProject[s.projectId] ?? 0) + s.activeMs;
    }
    return totals;
  }

  applyOutcome(taskId: string, outcome: SessionOutcome): Task | null {
    return this.deps.storage.tasks.update(taskId, { status: OUTCOME_STATUS[outcome], updatedAt: this.now() });
  }

  /** Подписка на intervalEnded таймера. */
  onIntervalEnded(record: SessionRecord): void {
    if (record.kind !== 'focus' || !record.taskId || record.activeMs <= 0) return;
    if (!PROMPT_REASONS.includes(record.endReason)) return;
    const task = this.deps.storage.tasks.get(record.taskId);
    if (!task) return;
    this.setPrompt({ sessionId: record.id, taskId: task.id, taskTitle: task.title });
  }

  pendingOutcome(): OutcomePrompt | null {
    return this.prompt;
  }

  /** Результат сессии: пишется в сессию и переносится на статус задачи. Карточка при этом закрывается. */
  setOutcome(sessionId: string, outcome: SessionOutcome): void {
    const session = this.deps.storage.sessions.get(sessionId);
    if (!session) return;
    this.deps.setSessionOutcome(sessionId, outcome);
    if (session.taskId) this.applyOutcome(session.taskId, outcome);
    if (this.prompt?.sessionId === sessionId) this.setPrompt(null);
  }

  dismissOutcome(): void {
    this.setPrompt(null);
  }

  private setPrompt(prompt: OutcomePrompt | null): void {
    if (this.prompt === null && prompt === null) return;
    this.prompt = prompt;
    this.deps.onPromptChange?.(prompt);
  }
}
