// ЗАГЛУШКА Т01 → заполняет Т06 (TaskService: задачи, проекты, applyOutcome).
// Простой CRUD поверх Storage, чтобы оболочка могла работать с данными.
import { randomUUID } from 'node:crypto';
import { IPC } from '../../shared/ipc';
import type { Priority, Project, Task, TaskFilter, TaskStatus } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';

const isPriority = v.oneOf<Priority>('low', 'medium', 'high');
const isStatus = v.oneOf<TaskStatus>('open', 'inProgress', 'done', 'cancelled');
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
type TaskDraft = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'projectId' | 'priority' | 'plannedMin' | 'status'>>;
type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'projectId' | 'priority' | 'plannedMin' | 'status'>>;
const isDraft = v.object({
  title: taskFields.title,
  description: v.optional(taskFields.description),
  projectId: v.optional(taskFields.projectId),
  priority: v.optional(taskFields.priority),
  plannedMin: v.optional(taskFields.plannedMin),
  status: v.optional(taskFields.status),
});
const isPatch = v.object(Object.fromEntries(Object.entries(taskFields).map(([k, c]) => [k, v.optional(c)])));
const isProject = v.object({
  id: v.id(),
  name: v.str({ min: 1, max: 100 }),
  color: v.str({ pattern: /^#[0-9a-fA-F]{6}$/ }),
  weeklyGoalMin: v.nullable(v.int(1, 10_080)),
  archived: v.bool(),
});

export function registerTasks(ctx: MainContext): void {
  const { storage } = ctx;
  handle<[TaskFilter | undefined]>(IPC.tasks.list, [isFilter], (filter) => storage.tasks.list(filter));
  handle<[TaskDraft]>(IPC.tasks.create, [isDraft], (draft) => {
    const now = Date.now();
    const task: Task = {
      id: randomUUID(),
      description: '',
      projectId: null,
      priority: 'medium',
      plannedMin: null,
      status: 'open',
      ...draft,
      createdAt: now,
      updatedAt: now,
    };
    storage.tasks.insert(task);
    return task;
  });
  handle<[string, TaskPatch]>(IPC.tasks.update, [v.id(), isPatch], (id, patch) =>
    storage.tasks.update(id, { ...patch, updatedAt: Date.now() }),
  );
  handle<[string]>(IPC.tasks.remove, [v.id()], (id) => storage.tasks.remove(id));
  handle<[]>(IPC.tasks.projects, [], () => storage.projects.list());
  handle<[Project]>(IPC.tasks.saveProject, [isProject], (p) => {
    storage.projects.upsert(p);
    return p;
  });
  handle<[string]>(IPC.tasks.deleteProject, [v.id()], (id) => storage.projects.remove(id));
}
