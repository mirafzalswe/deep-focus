// Миграции схемы. Список только дополняется в конец; номер версии = индекс + 1.
// Версия хранится в kv('schemaVersion').
import type Database from 'better-sqlite3';
import {
  BUILTIN_BLOCK_RULES,
  BUILTIN_SOUND_PRESETS,
  BUILTIN_TIMER_PRESETS,
  SEED_PROJECTS,
} from '../../shared/defaults';

type Db = Database.Database;

export interface Migration {
  description: string;
  up(db: Db, now: number): void;
}

const b = (v: boolean) => (v ? 1 : 0);

export const MIGRATIONS: Migration[] = [
  {
    description: 'initial schema + seed',
    up(db, now) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS kv (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE timer_presets (
          id                 TEXT PRIMARY KEY,
          name               TEXT NOT NULL,
          builtin            INTEGER NOT NULL DEFAULT 0,
          focus_min          INTEGER NOT NULL,
          short_break_min    INTEGER NOT NULL,
          long_break_min     INTEGER NOT NULL,
          cycles_before_long INTEGER NOT NULL
        );
        CREATE TABLE sound_presets (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          builtin       INTEGER NOT NULL DEFAULT 0,
          tracks        TEXT NOT NULL,
          master_volume REAL NOT NULL
        );
        CREATE TABLE block_rules (
          id                 TEXT PRIMARY KEY,
          pattern            TEXT NOT NULL,
          category           TEXT NOT NULL,
          enabled            INTEGER NOT NULL,
          during_focus       INTEGER NOT NULL,
          during_short_break INTEGER NOT NULL,
          during_long_break  INTEGER NOT NULL,
          schedule           TEXT,
          builtin            INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE projects (
          id              TEXT PRIMARY KEY,
          name            TEXT NOT NULL,
          color           TEXT NOT NULL,
          weekly_goal_min INTEGER,
          archived        INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE tasks (
          id          TEXT PRIMARY KEY,
          title       TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
          priority    TEXT NOT NULL,
          planned_min INTEGER,
          status      TEXT NOT NULL,
          created_at  INTEGER NOT NULL,
          updated_at  INTEGER NOT NULL
        );
        CREATE INDEX tasks_project ON tasks(project_id);
        CREATE TABLE sessions (
          id           TEXT PRIMARY KEY,
          kind         TEXT NOT NULL,
          mode         TEXT NOT NULL,
          preset_id    TEXT NOT NULL,
          task_id      TEXT,
          project_id   TEXT,
          started_at   INTEGER NOT NULL,
          ended_at     INTEGER NOT NULL,
          planned_ms   INTEGER,
          active_ms    INTEGER NOT NULL,
          paused_ms    INTEGER NOT NULL,
          suspended_ms INTEGER NOT NULL,
          end_reason   TEXT NOT NULL,
          outcome      TEXT,
          recovered    INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX sessions_started ON sessions(started_at);
        CREATE INDEX sessions_task ON sessions(task_id);
        CREATE TABLE achievements (
          id          TEXT PRIMARY KEY,
          kind        TEXT NOT NULL,
          period      TEXT NOT NULL,
          achieved_at INTEGER NOT NULL,
          value_min   INTEGER NOT NULL
        );
        CREATE TABLE recovery (
          id         INTEGER PRIMARY KEY CHECK (id = 1),
          json       TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);

      const tp = db.prepare(
        `INSERT INTO timer_presets (id, name, builtin, focus_min, short_break_min, long_break_min, cycles_before_long)
         VALUES (@id, @name, 1, @focusMin, @shortBreakMin, @longBreakMin, @cyclesBeforeLong)`,
      );
      for (const p of BUILTIN_TIMER_PRESETS) tp.run(p);

      const sp = db.prepare(
        `INSERT INTO sound_presets (id, name, builtin, tracks, master_volume) VALUES (?, ?, 1, ?, ?)`,
      );
      for (const p of BUILTIN_SOUND_PRESETS) sp.run(p.id, p.name, JSON.stringify(p.tracks), p.masterVolume);

      const br = db.prepare(
        `INSERT INTO block_rules (id, pattern, category, enabled, during_focus, during_short_break, during_long_break, schedule, builtin)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      );
      for (const r of BUILTIN_BLOCK_RULES) {
        br.run(
          r.id,
          r.pattern,
          r.category,
          b(r.enabled),
          b(r.duringFocus),
          b(r.duringShortBreak),
          b(r.duringLongBreak),
          r.schedule ? JSON.stringify(r.schedule) : null,
        );
      }

      const pr = db.prepare(`INSERT INTO projects (id, name, color, weekly_goal_min, archived) VALUES (?, ?, ?, ?, ?)`);
      for (const p of SEED_PROJECTS) pr.run(p.id, p.name, p.color, p.weeklyGoalMin, b(p.archived));

      db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES ('seededAt', ?)`).run(JSON.stringify(now));
    },
  },
];

export function migrate(db: Db, now: number): number {
  db.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM kv WHERE key = 'schemaVersion'`).get() as { value: string } | undefined;
  let version = row ? Number(JSON.parse(row.value)) : 0;
  const setVersion = db.prepare(`INSERT OR REPLACE INTO kv (key, value) VALUES ('schemaVersion', ?)`);
  while (version < MIGRATIONS.length) {
    const migration = MIGRATIONS[version]!;
    db.transaction(() => {
      migration.up(db, now);
      setVersion.run(JSON.stringify(version + 1));
    })();
    version += 1;
  }
  return version;
}
