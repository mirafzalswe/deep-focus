import { IPC } from '../../shared/ipc';
import type {
  OutcomePrompt,
  Project,
  SessionOutcome,
  Task,
  TaskDraft,
  TaskFilter,
  TaskPatch,
  TimeTotals,
} from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const tasks = {
  list: (filter?: TaskFilter) => invoke<Task[]>(IPC.tasks.list, filter),
  create: (draft: TaskDraft) => invoke<Task>(IPC.tasks.create, draft),
  update: (id: string, patch: TaskPatch) => invoke<Task | null>(IPC.tasks.update, id, patch),
  remove: (id: string) => invoke<void>(IPC.tasks.remove, id),
  projects: () => invoke<Project[]>(IPC.tasks.projects),
  saveProject: (p: Project) => invoke<Project>(IPC.tasks.saveProject, p),
  deleteProject: (id: string) => invoke<void>(IPC.tasks.deleteProject, id),
  totals: () => invoke<TimeTotals>(IPC.tasks.totals),
  pendingOutcome: () => invoke<OutcomePrompt | null>(IPC.tasks.pendingOutcome),
  setOutcome: (sessionId: string, outcome: SessionOutcome) => invoke<void>(IPC.tasks.setOutcome, sessionId, outcome),
  dismissOutcome: () => invoke<void>(IPC.tasks.dismissOutcome),
  onOutcomeChanged: (cb: (prompt: OutcomePrompt | null) => void) => subscribe<OutcomePrompt | null>(IPC.tasks.outcomeChanged, cb),
};
