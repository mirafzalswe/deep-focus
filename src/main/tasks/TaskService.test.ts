import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_PROJECTS } from '../../shared/defaults';
import type { OutcomePrompt, SessionOutcome, SessionRecord } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { TaskService } from './TaskService';

const MIN = 60_000;
let storage: Storage;
let outcomes: Array<[string, SessionOutcome]>;
let prompts: Array<OutcomePrompt | null>;
let ids = 0;
let clock = 1_000;

const svc = () =>
  new TaskService({
    storage,
    setSessionOutcome: (id, o) => {
      outcomes.push([id, o]);
      storage.sessions.update(id, { outcome: o });
    },
    onPromptChange: (p) => prompts.push(p),
    newId: () => `id${++ids}`,
    now: () => clock,
  });

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  const rec: SessionRecord = {
    id: `s${++ids}`, kind: 'focus', mode: 'pomodoro', presetId: 'classic', taskId: null, projectId: null,
    startedAt: 5_000, endedAt: 5_000 + 25 * MIN, plannedMs: 25 * MIN, activeMs: 25 * MIN, pausedMs: 0,
    suspendedMs: 0, endReason: 'completed', outcome: null, recovered: false, ...over,
  };
  storage.sessions.insert(rec);
  return rec;
}

beforeEach(() => {
  storage = openStorage(':memory:');
  outcomes = [];
  prompts = [];
});
afterEach(() => storage.close());

describe('задачи', () => {
  it('создаёт задачу по одному названию с умолчаниями; название обрезается', () => {
    const t = svc().create({ title: '  Написать отчёт  ' });
    expect(t).toMatchObject({ title: 'Написать отчёт', description: '', projectId: null, priority: 'medium', plannedMin: null, status: 'open' });
    expect(svc().list()).toHaveLength(1);
  });

  it('пустое название — ошибка, задача не создаётся', () => {
    expect(() => svc().create({ title: '   ' })).toThrow();
    expect(svc().list()).toHaveLength(0);
  });

  it('обновляет поля и updatedAt; пустое название в патче отвергается', () => {
    const s = svc();
    const t = s.create({ title: 'a' });
    clock = 9_000;
    const u = s.update(t.id, { priority: 'high', plannedMin: 45, projectId: 'seed-dev' });
    expect(u).toMatchObject({ priority: 'high', plannedMin: 45, projectId: 'seed-dev', updatedAt: 9_000 });
    expect(() => s.update(t.id, { title: '' })).toThrow();
    expect(s.list({ projectId: 'seed-dev' })).toHaveLength(1);
  });

  it('удаление задачи убирает её из списка', () => {
    const s = svc();
    const t = s.create({ title: 'a' });
    s.remove(t.id);
    expect(s.list()).toHaveLength(0);
  });
});

describe('проекты', () => {
  it('пять проектов из сида; свой проект добавляется и редактируется', () => {
    const s = svc();
    expect(s.projects().map((p) => p.name)).toEqual(SEED_PROJECTS.map((p) => p.name));
    s.saveProject({ id: 'mine', name: 'Мой', color: '#123456', weeklyGoalMin: 300, archived: false });
    expect(s.projects().find((p) => p.id === 'mine')?.weeklyGoalMin).toBe(300);
  });

  it('удаление проекта отвязывает задачи, сами задачи остаются', () => {
    const s = svc();
    const t = s.create({ title: 'a', projectId: 'seed-dev' });
    s.deleteProject('seed-dev');
    expect(s.list()[0]).toMatchObject({ id: t.id, projectId: null });
    expect(s.projects().some((p) => p.id === 'seed-dev')).toBe(false);
  });
});

describe('время по задачам и проектам', () => {
  it('суммирует activeMs только Focus-сессий', () => {
    session({ taskId: 't1', projectId: 'seed-dev', activeMs: 10 * MIN });
    session({ taskId: 't1', projectId: 'seed-dev', activeMs: 5 * MIN, endReason: 'stopped' });
    session({ taskId: 't1', projectId: 'seed-dev', kind: 'shortBreak', activeMs: 5 * MIN });
    session({ taskId: null, projectId: 'seed-work', activeMs: 7 * MIN });
    expect(svc().totals()).toEqual({ byTask: { t1: 15 * MIN }, byProject: { 'seed-dev': 15 * MIN, 'seed-work': 7 * MIN } });
  });
});

describe('результат сессии', () => {
  it.each([
    ['done', 'done'],
    ['partial', 'inProgress'],
    ['later', 'open'],
    ['cancelled', 'cancelled'],
  ] as const)('исход %s ставит задаче статус %s', (outcome, status) => {
    const s = svc();
    const t = s.create({ title: 'a', status: outcome === 'later' ? 'inProgress' : 'open' });
    expect(s.applyOutcome(t.id, outcome)?.status).toBe(status);
  });

  it('конец Focus-сессии с задачей предлагает карточку; ответ пишет исход в сессию и меняет задачу', () => {
    const s = svc();
    const t = s.create({ title: 'Отчёт' });
    const rec = session({ taskId: t.id });
    s.onIntervalEnded(rec);
    expect(s.pendingOutcome()).toEqual({ sessionId: rec.id, taskId: t.id, taskTitle: 'Отчёт' });
    s.setOutcome(rec.id, 'done');
    expect(outcomes).toEqual([[rec.id, 'done']]);
    expect(storage.tasks.get(t.id)?.status).toBe('done');
    expect(s.pendingOutcome()).toBeNull();
    expect(prompts.at(-1)).toBeNull();
  });

  it('карточки нет: без задачи, перерыв, сброс/рестарт/выход, нулевое время', () => {
    const s = svc();
    const t = s.create({ title: 'a' });
    for (const over of [
      { taskId: null },
      { taskId: t.id, kind: 'shortBreak' as const },
      { taskId: t.id, endReason: 'reset' as const },
      { taskId: t.id, endReason: 'restarted' as const },
      { taskId: t.id, endReason: 'appQuit' as const },
      { taskId: t.id, activeMs: 0 },
    ]) {
      s.onIntervalEnded(session(over));
      expect(s.pendingOutcome()).toBeNull();
    }
  });

  it('карточку можно проигнорировать: dismiss убирает её без изменения задачи', () => {
    const s = svc();
    const t = s.create({ title: 'a' });
    s.onIntervalEnded(session({ taskId: t.id }));
    s.dismissOutcome();
    expect(s.pendingOutcome()).toBeNull();
    expect(storage.tasks.get(t.id)?.status).toBe('open');
    expect(outcomes).toEqual([]);
  });

  it('исход старой сессии (карточки уже нет) тоже применяется к задаче', () => {
    const s = svc();
    const t = s.create({ title: 'a' });
    const rec = session({ taskId: t.id });
    s.setOutcome(rec.id, 'partial');
    expect(storage.tasks.get(t.id)?.status).toBe('inProgress');
  });
});
