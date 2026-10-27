// Модуль tasks: TaskService + IPC. Результат Focus-сессии с задачей — карточка на Home (не модальная).
import { IPC } from '../../shared/ipc';
import type { Priority, Project, SessionOutcome, TaskDraft, TaskFilter, TaskPatch, TaskStatus } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';
import { TaskService } from './TaskService';

declare module '../context' {
  interface Services {
    tasks: TaskService;
  }
}

const isPriority = v.oneOf<Priority>('low', 'medium', 'high');
const isStatus = v.oneOf<TaskStatus>('open', 'inProgress', 'done', 'cancelled');
const isOutcome = v.oneOf<SessionOutcome>('done', 'partial', 'later', 'cancelled');
const isFilter = v.optional(
  v.object({ projectId: v.optional(v.nullable(v.id())), status: v.optional(v.array(isStatus, { max: 4 })) }),
);
const taskFields = {
  title: v.str({ min: 1, max: 300 }),
  description: v.str({ max: 5000 }),
  projectId: v.nullable(v.id()),
  priority: isPriority,
  plannedMin: v.nullable(v.int(1, 10_000)),
  status: isStatus,
};
const optionalFields = Object.fromEntries(Object.entries(taskFields).map(([k, c]) => [k, v.optional(c)]));
const isDraft = v.object({ ...optionalFields, title: taskFields.title });
const isPatch = v.object(optionalFields);
const isProject = v.object({
  id: v.id(),
  name: v.str({ min: 1, max: 100 }),
  color: v.str({ pattern: /^#[0-9a-fA-F]{6}$/ }),
  weeklyGoalMin: v.nullable(v.int(1, 10_080)),
  archived: v.bool(),
});

export function registerTasks(ctx: MainContext): void {
  const { storage, logger } = ctx;
  const service = new TaskService({
    storage,
    setSessionOutcome: (sessionId, outcome) => ctx.services.timer?.setOutcome(sessionId, outcome),
    onPromptChange: (prompt) => ctx.broadcast(IPC.tasks.outcomeChanged, prompt),
  });
  ctx.services.tasks = service;

  ctx.services.timer?.on('intervalEnded', (record) => {
    try {
      service.onIntervalEnded(record);
    } catch (err) {
      logger.error('tasks', 'outcome prompt failed', err);
    }
  });

  handle<[TaskFilter | undefined]>(IPC.tasks.list, [isFilter], (filter) => service.list(filter));
  handle<[TaskDraft]>(IPC.tasks.create, [isDraft], (draft) => service.create(draft));
  handle<[string, TaskPatch]>(IPC.tasks.update, [v.id(), isPatch], (id, patch) => service.update(id, patch));
  handle<[string]>(IPC.tasks.remove, [v.id()], (id) => service.remove(id));
  handle<[]>(IPC.tasks.projects, [], () => service.projects());
  handle<[Project]>(IPC.tasks.saveProject, [isProject], (p) => service.saveProject(p));
  handle<[string]>(IPC.tasks.deleteProject, [v.id()], (id) => service.deleteProject(id));
  handle<[]>(IPC.tasks.totals, [], () => service.totals());
  handle<[]>(IPC.tasks.pendingOutcome, [], () => service.pendingOutcome());
  handle<[string, SessionOutcome]>(IPC.tasks.setOutcome, [v.id(), isOutcome], (sessionId, outcome) => {
    service.setOutcome(sessionId, outcome);
    ctx.broadcast(IPC.analytics.changed);
  });
  handle<[]>(IPC.tasks.dismissOutcome, [], () => service.dismissOutcome());
}
