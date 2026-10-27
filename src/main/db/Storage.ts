// Storage — файл deepfocus.db в userData. Драйвер: better-sqlite3 (N-API prebuild, без пересборки под Electron).
// SQL и драйвер наружу не выходят: модули получают только репозитории.
import { existsSync, renameSync } from 'node:fs';
import Database from 'better-sqlite3';
import type {
  Achievement,
  BlockRule,
  DateRange,
  Project,
  SessionRecord,
  SoundPreset,
  Task,
  TaskFilter,
  TimerPreset,
} from '../../shared/types';
import { migrate } from './migrations';

type Db = Database.Database;
type Row = Record<string, unknown>;

export interface CrudRepo<T extends { id: string }> {
  list(): T[];
  get(id: string): T | null;
  /** Вставка или полная замена по id (порядок списка — по первой вставке). */
  upsert(item: T): void;
  remove(id: string): void;
}

export interface Storage {
  readonly path: string;
  close(): void;
  transaction<T>(fn: () => T): T;
  /** Имена пользовательских таблиц (для диагностики и тестов). */
  tables(): string[];
  settings: {
    /** Все сохранённые секции настроек: { [section]: value }. */
    getAll(): Record<string, unknown>;
    set(section: string, value: unknown): void;
    clear(): void;
  };
  sessions: {
    insert(record: SessionRecord): void;
    update(id: string, patch: Partial<Omit<SessionRecord, 'id'>>): void;
    get(id: string): SessionRecord | null;
    /** Сессии с startedAt в [from, to), по возрастанию startedAt. */
    list(range: DateRange): SessionRecord[];
  };
  tasks: {
    list(filter?: TaskFilter): Task[];
    get(id: string): Task | null;
    insert(task: Task): void;
    update(id: string, patch: Partial<Omit<Task, 'id'>>): Task | null;
    remove(id: string): void;
  };
  projects: CrudRepo<Project>;
  timerPresets: CrudRepo<TimerPreset>;
  soundPresets: CrudRepo<SoundPreset>;
  blockRules: CrudRepo<BlockRule>;
  recovery: {
    get<T = unknown>(): { value: T; updatedAt: number } | null;
    put(value: unknown, updatedAt: number): void;
    clear(): void;
  };
  achievements: {
    /** Повторная вставка того же id игнорируется. */
    insert(a: Achievement): void;
    list(): Achievement[];
  };
  kv: {
    get<T = unknown>(key: string): T | null;
    set(key: string, value: unknown): void;
    delete(key: string): void;
  };
}

const bool = (v: unknown) => v === 1 || v === true;
const int = (v: boolean) => (v ? 1 : 0);
const parse = <T>(v: unknown): T => JSON.parse(String(v)) as T;
const nullableNum = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const nullableStr = (v: unknown) => (v === null || v === undefined ? null : String(v));

// ── Отображение строк ─────────────────────────────────────────────────────
const toSession = (r: Row): SessionRecord => ({
  id: String(r.id),
  kind: r.kind as SessionRecord['kind'],
  mode: r.mode as SessionRecord['mode'],
  presetId: String(r.preset_id),
  taskId: nullableStr(r.task_id),
  projectId: nullableStr(r.project_id),
  startedAt: Number(r.started_at),
  endedAt: Number(r.ended_at),
  plannedMs: nullableNum(r.planned_ms),
  activeMs: Number(r.active_ms),
  pausedMs: Number(r.paused_ms),
  suspendedMs: Number(r.suspended_ms),
  endReason: r.end_reason as SessionRecord['endReason'],
  outcome: (r.outcome ?? null) as SessionRecord['outcome'],
  recovered: bool(r.recovered),
});
const sessionCols: Record<keyof SessionRecord, string> = {
  id: 'id',
  kind: 'kind',
  mode: 'mode',
  presetId: 'preset_id',
  taskId: 'task_id',
  projectId: 'project_id',
  startedAt: 'started_at',
  endedAt: 'ended_at',
  plannedMs: 'planned_ms',
  activeMs: 'active_ms',
  pausedMs: 'paused_ms',
  suspendedMs: 'suspended_ms',
  endReason: 'end_reason',
  outcome: 'outcome',
  recovered: 'recovered',
};

const toTask = (r: Row): Task => ({
  id: String(r.id),
  title: String(r.title),
  description: String(r.description ?? ''),
  projectId: nullableStr(r.project_id),
  priority: r.priority as Task['priority'],
  plannedMin: nullableNum(r.planned_min),
  status: r.status as Task['status'],
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const taskCols: Record<keyof Task, string> = {
  id: 'id',
  title: 'title',
  description: 'description',
  projectId: 'project_id',
  priority: 'priority',
  plannedMin: 'planned_min',
  status: 'status',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};

const sqlValue = (v: unknown) => (typeof v === 'boolean' ? int(v) : (v ?? null));

/** UPDATE по полям патча; имена колонок только из фиксированной карты. */
function updateByPatch(db: Db, table: string, cols: Record<string, string>, id: string, patch: Row) {
  const keys = Object.keys(patch).filter((k) => k !== 'id' && k in cols && patch[k] !== undefined);
  if (keys.length === 0) return;
  const set = keys.map((k) => `${cols[k]} = @${k}`).join(', ');
  const params: Row = { id };
  for (const k of keys) params[k] = sqlValue(patch[k]);
  db.prepare(`UPDATE ${table} SET ${set} WHERE id = @id`).run(params);
}

function crud<T extends { id: string }>(
  db: Db,
  table: string,
  toItem: (r: Row) => T,
  upsertSql: string,
  toParams: (item: T) => Row,
): CrudRepo<T> {
  const listStmt = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`);
  const getStmt = db.prepare(`SELECT * FROM ${table} WHERE id = ?`);
  const upsertStmt = db.prepare(upsertSql);
  const removeStmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
  return {
    list: () => (listStmt.all() as Row[]).map(toItem),
    get: (id) => {
      const row = getStmt.get(id) as Row | undefined;
      return row ? toItem(row) : null;
    },
    upsert: (item) => void upsertStmt.run(toParams(item)),
    remove: (id) => void removeStmt.run(id),
  };
}

function createStorage(db: Db, path: string): Storage {
  const sessionInsert = db.prepare(
    `INSERT INTO sessions (${Object.values(sessionCols).join(', ')})
     VALUES (${Object.keys(sessionCols).map((k) => `@${k}`).join(', ')})`,
  );
  const taskInsert = db.prepare(
    `INSERT INTO tasks (${Object.values(taskCols).join(', ')})
     VALUES (${Object.keys(taskCols).map((k) => `@${k}`).join(', ')})`,
  );

  const toParams = (o: object): Row => {
    const out: Row = {};
    for (const [k, v] of Object.entries(o)) out[k] = sqlValue(v);
    return out;
  };

  return {
    path,
    close: () => db.close(),
    transaction: <T>(fn: () => T) => db.transaction(fn)(),
    tables: () =>
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as Row[]).map(
        (r) => String(r.name),
      ),

    settings: {
      getAll: () => {
        const out: Record<string, unknown> = {};
        for (const r of db.prepare(`SELECT key, value FROM settings`).all() as Row[]) {
          try {
            out[String(r.key)] = parse(r.value);
          } catch {
            // битое значение секции — пропускаем, SettingsManager подставит значения по умолчанию
          }
        }
        return out;
      },
      set: (section, value) =>
        void db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`).run(section, JSON.stringify(value)),
      clear: () => void db.prepare(`DELETE FROM settings`).run(),
    },

    sessions: {
      insert: (record) => void sessionInsert.run(toParams(record)),
      update: (id, patch) => updateByPatch(db, 'sessions', sessionCols, id, patch as Row),
      get: (id) => {
        const r = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as Row | undefined;
        return r ? toSession(r) : null;
      },
      list: (range) =>
        (
          db
            .prepare(`SELECT * FROM sessions WHERE started_at >= ? AND started_at < ? ORDER BY started_at, rowid`)
            .all(range.from, range.to) as Row[]
        ).map(toSession),
    },

    tasks: {
      list: (filter = {}) => {
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.projectId !== undefined) {
          if (filter.projectId === null) where.push('project_id IS NULL');
          else {
            where.push('project_id = ?');
            params.push(filter.projectId);
          }
        }
        if (filter.status && filter.status.length > 0) {
          where.push(`status IN (${filter.status.map(() => '?').join(', ')})`);
          params.push(...filter.status);
        }
        const sql = `SELECT * FROM tasks ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, rowid`;
        return (db.prepare(sql).all(...params) as Row[]).map(toTask);
      },
      get: (id) => {
        const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row | undefined;
        return r ? toTask(r) : null;
      },
      insert: (task) => void taskInsert.run(toParams(task)),
      update: (id, patch) => {
        updateByPatch(db, 'tasks', taskCols, id, patch as Row);
        const r = db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as Row | undefined;
        return r ? toTask(r) : null;
      },
      remove: (id) => void db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id),
    },

    projects: crud<Project>(
      db,
      'projects',
      (r) => ({
        id: String(r.id),
        name: String(r.name),
        color: String(r.color),
        weeklyGoalMin: nullableNum(r.weekly_goal_min),
        archived: bool(r.archived),
      }),
      `INSERT INTO projects (id, name, color, weekly_goal_min, archived) VALUES (@id, @name, @color, @weeklyGoalMin, @archived)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color,
         weekly_goal_min = excluded.weekly_goal_min, archived = excluded.archived`,
      toParams,
    ),

    timerPresets: crud<TimerPreset>(
      db,
      'timer_presets',
      (r) => ({
        id: String(r.id),
        name: String(r.name),
        builtin: bool(r.builtin),
        focusMin: Number(r.focus_min),
        shortBreakMin: Number(r.short_break_min),
        longBreakMin: Number(r.long_break_min),
        cyclesBeforeLong: Number(r.cycles_before_long),
      }),
      `INSERT INTO timer_presets (id, name, builtin, focus_min, short_break_min, long_break_min, cycles_before_long)
       VALUES (@id, @name, @builtin, @focusMin, @shortBreakMin, @longBreakMin, @cyclesBeforeLong)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, builtin = excluded.builtin, focus_min = excluded.focus_min,
         short_break_min = excluded.short_break_min, long_break_min = excluded.long_break_min,
         cycles_before_long = excluded.cycles_before_long`,
      toParams,
    ),

    soundPresets: crud<SoundPreset>(
      db,
      'sound_presets',
      (r) => ({
        id: String(r.id),
        name: String(r.name),
        builtin: bool(r.builtin),
        tracks: parse<SoundPreset['tracks']>(r.tracks),
        masterVolume: Number(r.master_volume),
      }),
      `INSERT INTO sound_presets (id, name, builtin, tracks, master_volume) VALUES (@id, @name, @builtin, @tracks, @masterVolume)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, builtin = excluded.builtin, tracks = excluded.tracks,
         master_volume = excluded.master_volume`,
      (p) => ({ ...toParams(p), tracks: JSON.stringify(p.tracks) }),
    ),

    blockRules: crud<BlockRule>(
      db,
      'block_rules',
      (r) => ({
        id: String(r.id),
        pattern: String(r.pattern),
        category: r.category as BlockRule['category'],
        enabled: bool(r.enabled),
        duringFocus: bool(r.during_focus),
        duringShortBreak: bool(r.during_short_break),
        duringLongBreak: bool(r.during_long_break),
        schedule: r.schedule === null || r.schedule === undefined ? null : parse<BlockRule['schedule']>(r.schedule),
        builtin: bool(r.builtin),
      }),
      `INSERT INTO block_rules (id, pattern, category, enabled, during_focus, during_short_break, during_long_break, schedule, builtin)
       VALUES (@id, @pattern, @category, @enabled, @duringFocus, @duringShortBreak, @duringLongBreak, @schedule, @builtin)
       ON CONFLICT(id) DO UPDATE SET pattern = excluded.pattern, category = excluded.category, enabled = excluded.enabled,
         during_focus = excluded.during_focus, during_short_break = excluded.during_short_break,
         during_long_break = excluded.during_long_break, schedule = excluded.schedule, builtin = excluded.builtin`,
      (r) => ({ ...toParams(r), schedule: r.schedule ? JSON.stringify(r.schedule) : null }),
    ),

    recovery: {
      get: <T>() => {
        const r = db.prepare(`SELECT json, updated_at FROM recovery WHERE id = 1`).get() as Row | undefined;
        if (!r) return null;
        try {
          return { value: parse<T>(r.json), updatedAt: Number(r.updated_at) };
        } catch {
          return null;
        }
      },
      put: (value, updatedAt) =>
        void db
          .prepare(`INSERT OR REPLACE INTO recovery (id, json, updated_at) VALUES (1, ?, ?)`)
          .run(JSON.stringify(value), updatedAt),
      clear: () => void db.prepare(`DELETE FROM recovery`).run(),
    },

    achievements: {
      insert: (a) =>
        void db
          .prepare(`INSERT OR IGNORE INTO achievements (id, kind, period, achieved_at, value_min) VALUES (?, ?, ?, ?, ?)`)
          .run(a.id, a.kind, a.period, a.achievedAt, a.valueMin),
      list: () =>
        (db.prepare(`SELECT * FROM achievements ORDER BY achieved_at, rowid`).all() as Row[]).map((r) => ({
          id: String(r.id),
          kind: r.kind as Achievement['kind'],
          period: String(r.period),
          achievedAt: Number(r.achieved_at),
          valueMin: Number(r.value_min),
        })),
    },

    kv: {
      get: <T>(key: string) => {
        const r = db.prepare(`SELECT value FROM kv WHERE key = ?`).get(key) as Row | undefined;
        if (!r) return null;
        try {
          return parse<T>(r.value);
        } catch {
          return null;
        }
      },
      set: (key, value) => void db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)`).run(key, JSON.stringify(value)),
      delete: (key) => void db.prepare(`DELETE FROM kv WHERE key = ?`).run(key),
    },
  };
}

/** Открывает (или создаёт) базу и применяет миграции. Повреждённый файл → исключение (см. isCorruptionError). */
export function openStorage(path: string, now: () => number = Date.now): Storage {
  const db = new Database(path);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('synchronous = NORMAL');
    const check = db.pragma('quick_check', { simple: true });
    if (check !== 'ok') {
      const err = new Error(`quick_check: ${String(check)}`) as Error & { code: string };
      err.code = 'SQLITE_CORRUPT';
      throw err;
    }
    migrate(db, now());
    return createStorage(db, path);
  } catch (err) {
    db.close();
    throw err;
  }
}

export function isCorruptionError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (code.startsWith('SQLITE_CORRUPT') || code.startsWith('SQLITE_NOTADB'));
}

export interface OpenSafeResult {
  storage: Storage;
  /** Путь, куда переименован повреждённый файл; null — база была цела. */
  corruptBackupPath: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
function stamp(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * Открывает базу; если файл повреждён — переименовывает его (и -wal/-shm) в `<file>.corrupt-<YYYYMMDD-HHmmss>`
 * и создаёт новую базу (§12.3). Прочие ошибки (доступ, блокировка) пробрасываются.
 */
export function openStorageSafe(path: string, opts: { now?: () => number } = {}): OpenSafeResult {
  const now = opts.now ?? Date.now;
  try {
    return { storage: openStorage(path, now), corruptBackupPath: null };
  } catch (err) {
    if (!isCorruptionError(err)) throw err;
    let backup = `${path}.corrupt-${stamp(now())}`;
    for (let i = 1; existsSync(backup); i++) backup = `${path}.corrupt-${stamp(now())}-${i}`;
    renameSync(path, backup);
    for (const suffix of ['-wal', '-shm']) {
      if (existsSync(path + suffix)) renameSync(path + suffix, backup + suffix);
    }
    return { storage: openStorage(path, now), corruptBackupPath: backup };
  }
}
