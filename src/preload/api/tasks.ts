import { IPC } from '../../shared/ipc';
import type { Project, Task, TaskFilter } from '../../shared/types';
import { invoke } from '../bridge';

type TaskDraft = Pick<Task, 'title'> & Partial<Pick<Task, 'description' | 'projectId' | 'priority' | 'plannedMin' | 'status'>>;
type TaskPatch = Partial<Pick<Task, 'title' | 'description' | 'projectId' | 'priority' | 'plannedMin' | 'status'>>;

export const tasks = {
  list: (filter?: TaskFilter) => invoke<Task[]>(IPC.tasks.list, filter),
  create: (draft: TaskDraft) => invoke<Task>(IPC.tasks.create, draft),
  update: (id: string, patch: TaskPatch) => invoke<Task | null>(IPC.tasks.update, id, patch),
  remove: (id: string) => invoke<void>(IPC.tasks.remove, id),
  projects: () => invoke<Project[]>(IPC.tasks.projects),
  saveProject: (p: Project) => invoke<Project>(IPC.tasks.saveProject, p),
  deleteProject: (id: string) => invoke<void>(IPC.tasks.deleteProject, id),
};
