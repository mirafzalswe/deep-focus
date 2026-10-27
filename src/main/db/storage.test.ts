import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionRecord, Task } from '../../shared/types';
import { openStorage, openStorageSafe, type Storage } from './index';

let dir: string;
let dbPath: string;
const opened: Storage[] = [];
const open = (p = dbPath) => {
  const s = openStorage(p);
  opened.push(s);
  return s;
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-db-'));
  dbPath = join(dir, 'deepfocus.db');
});
afterEach(() => {
  for (const s of opened.splice(0)) s.close();
  rmSync(dir, { recursive: true, force: true });
});

const session = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: 's1',
  kind: 'focus',
  mode: 'pomodoro',
  presetId: 'classic',
  taskId: null,
  projectId: null,
  startedAt: 1_000,
  endedAt: 1_500_000,
  plannedMs: 1_500_000,
  activeMs: 1_400_000,
  pausedMs: 99_000,
  suspendedMs: 0,
  endReason: 'completed',
  outcome: null,
  recovered: false,
  ...over,
});

describe('Storage: схема и сид', () => {
  it('создаёт все таблицы из схемы и записывает версию в kv', () => {
    const s = open();
    expect(s.tables().sort()).toEqual(
      ['achievements', 'block_rules', 'kv', 'projects', 'recovery', 'sessions', 'settings', 'sound_presets', 'tasks', 'timer_presets'].sort(),
    );
    expect(s.kv.get('schemaVersion')).toBeGreaterThanOrEqual(1);
  });

  it('при первом открытии кладёт встроенные пресеты, правила и пять проектов', () => {
    const s = open();
    const timer = s.timerPresets.list();
    expect(timer.map((p) => [p.focusMin, p.shortBreakMin, p.longBreakMin, p.cyclesBeforeLong])).toEqual([
      [25, 5, 30, 4],
      [45, 10, 30, 4],
      [60, 10, 30, 3],
      [90, 20, 30, 2],
    ]);
    expect(s.soundPresets.list().map((p) => p.name)).toEqual([
      'Rain Focus',
      'Ocean Focus',
      'Forest',
      'Brown Noise',
      'Coffee Shop',
      'Silent Focus',
    ]);
    const yt = s.blockRules.list().find((r) => r.pattern === 'youtube.com');
    expect(yt).toMatchObject({ category: 'video', enabled: true, duringFocus: true, duringShortBreak: false, schedule: null });
    expect(s.projects.list().map((p) => p.name)).toEqual([
      'Разработка',
      'Обучение',
      'Работа',
      'Личные проекты',
      'Подготовка к экзаменам',
    ]);
  });

  it('повторное открытие не дублирует сид и сохраняет данные', () => {
    const s1 = open();
    s1.projects.upsert({ id: 'p-own', name: 'Свой', color: '#123456', weeklyGoalMin: 300, archived: false });
    s1.close();
    opened.splice(0);
    const s2 = open();
    expect(s2.projects.list()).toHaveLength(6);
    expect(s2.timerPresets.list()).toHaveLength(4);
    expect(s2.projects.get('p-own')).toEqual({ id: 'p-own', name: 'Свой', color: '#123456', weeklyGoalMin: 300, archived: false });
  });
});

describe('Storage: репозитории', () => {
  it('settings: секции хранятся как JSON по ключу', () => {
    const s = open();
    expect(s.settings.getAll()).toEqual({});
    s.settings.set('widget', { opacity: 0.5, bounds: { x: 1, y: 2, width: 3, height: 4, displayId: null } });
    expect(s.settings.getAll()).toEqual({ widget: { opacity: 0.5, bounds: { x: 1, y: 2, width: 3, height: 4, displayId: null } } });
  });

  it('sessions: insert / update / list по диапазону startedAt [from, to)', () => {
    const s = open();
    s.sessions.insert(session({ id: 'a', startedAt: 100 }));
    s.sessions.insert(session({ id: 'b', startedAt: 200, plannedMs: null, recovered: true, taskId: 't1', projectId: 'seed-dev' }));
    s.sessions.insert(session({ id: 'c', startedAt: 300 }));
    s.sessions.update('b', { outcome: 'partial' });
    const list = s.sessions.list({ from: 150, to: 300 });
    expect(list).toEqual([
      session({ id: 'b', startedAt: 200, plannedMs: null, recovered: true, taskId: 't1', projectId: 'seed-dev', outcome: 'partial' }),
    ]);
  });

  it('tasks: create / list с фильтром / update / remove', () => {
    const s = open();
    const t: Task = {
      id: 't1',
      title: 'Написать отчёт',
      description: '',
      projectId: 'seed-work',
      priority: 'high',
      plannedMin: 50,
      status: 'open',
      createdAt: 10,
      updatedAt: 10,
    };
    s.tasks.insert(t);
    s.tasks.insert({ ...t, id: 't2', projectId: null, status: 'done' });
    expect(s.tasks.list({ projectId: 'seed-work' }).map((x) => x.id)).toEqual(['t1']);
    expect(s.tasks.list({ status: ['done'] }).map((x) => x.id)).toEqual(['t2']);
    expect(s.tasks.update('t1', { status: 'inProgress', updatedAt: 20 })).toEqual({ ...t, status: 'inProgress', updatedAt: 20 });
    s.tasks.remove('t1');
    expect(s.tasks.get('t1')).toBeNull();
  });

  it('удаление проекта отвязывает его задачи', () => {
    const s = open();
    s.tasks.insert({
      id: 't1',
      title: 'x',
      description: '',
      projectId: 'seed-dev',
      priority: 'low',
      plannedMin: null,
      status: 'open',
      createdAt: 1,
      updatedAt: 1,
    });
    s.projects.remove('seed-dev');
    expect(s.tasks.get('t1')?.projectId).toBeNull();
  });

  it('presets и правила: upsert заменяет, remove удаляет', () => {
    const s = open();
    s.soundPresets.upsert({
      id: 'my',
      name: 'Мой',
      builtin: false,
      masterVolume: 0.5,
      tracks: [{ soundId: 'rain', enabled: true, volume: 0.3 }],
    });
    expect(s.soundPresets.get('my')?.tracks).toEqual([{ soundId: 'rain', enabled: true, volume: 0.3 }]);
    s.blockRules.upsert({
      id: 'r1',
      pattern: 'example.com',
      category: 'custom',
      enabled: true,
      duringFocus: true,
      duringShortBreak: true,
      duringLongBreak: false,
      schedule: { days: [1, 2], from: '09:00', to: '18:00' },
      builtin: false,
    });
    expect(s.blockRules.get('r1')?.schedule).toEqual({ days: [1, 2], from: '09:00', to: '18:00' });
    s.timerPresets.upsert({ id: 'classic', name: 'Мой 25', builtin: true, focusMin: 30, shortBreakMin: 5, longBreakMin: 30, cyclesBeforeLong: 4 });
    expect(s.timerPresets.get('classic')?.focusMin).toBe(30);
    s.timerPresets.remove('classic');
    expect(s.timerPresets.get('classic')).toBeNull();
  });

  it('recovery: одна строка JSON, put заменяет, clear удаляет', () => {
    const s = open();
    expect(s.recovery.get()).toBeNull();
    s.recovery.put({ status: 'running' }, 111);
    s.recovery.put({ status: 'paused' }, 222);
    expect(s.recovery.get()).toEqual({ value: { status: 'paused' }, updatedAt: 222 });
    s.recovery.clear();
    expect(s.recovery.get()).toBeNull();
  });

  it('achievements и kv', () => {
    const s = open();
    s.achievements.insert({ id: 'daily:2026-10-27', kind: 'daily', period: '2026-10-27', achievedAt: 5, valueMin: 240 });
    s.achievements.insert({ id: 'daily:2026-10-27', kind: 'daily', period: '2026-10-27', achievedAt: 6, valueMin: 250 });
    expect(s.achievements.list()).toEqual([{ id: 'daily:2026-10-27', kind: 'daily', period: '2026-10-27', achievedAt: 5, valueMin: 240 }]);
    s.kv.set('proxyBackup', { ProxyEnable: 0 });
    expect(s.kv.get('proxyBackup')).toEqual({ ProxyEnable: 0 });
    s.kv.delete('proxyBackup');
    expect(s.kv.get('proxyBackup')).toBeNull();
  });
});

describe('Storage: повреждённый файл', () => {
  it('битый файл переименовывается в .corrupt-<дата>, создаётся новая база', () => {
    writeFileSync(dbPath, 'это не база sqlite '.repeat(500));
    const { storage, corruptBackupPath } = openStorageSafe(dbPath, { now: () => new Date(2026, 9, 27, 13, 5, 9).getTime() });
    opened.push(storage);
    expect(corruptBackupPath).toBe(`${dbPath}.corrupt-20261027-130509`);
    expect(readFileSync(corruptBackupPath!, 'utf8')).toMatch(/^это не база sqlite/);
    expect(storage.timerPresets.list()).toHaveLength(4);
    expect(readdirSync(dir).filter((f) => f.startsWith('deepfocus.db.corrupt-'))).toHaveLength(1);
  });

  it('целый файл открывается без переименования', () => {
    open().close();
    opened.splice(0);
    const { storage, corruptBackupPath } = openStorageSafe(dbPath);
    opened.push(storage);
    expect(corruptBackupPath).toBeNull();
    expect(existsSync(dbPath)).toBe(true);
  });
});
