import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from './logger';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-log-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('Logger', () => {
  it('пишет уровень, модуль, сообщение и стек ошибки в logs/deepfocus.log', () => {
    const logger = createLogger(dir);
    logger.error('blocker', 'proxy failed', new Error('boom'));
    logger.info('app', 'started');
    const text = readFileSync(join(dir, 'logs', 'deepfocus.log'), 'utf8');
    expect(text).toMatch(/ERROR \[blocker\] proxy failed/);
    expect(text).toMatch(/Error: boom/);
    expect(text).toMatch(/INFO \[app\] started/);
    expect(logger.path).toBe(join(dir, 'logs', 'deepfocus.log'));
  });

  it('ротирует по размеру и хранит не больше трёх файлов', () => {
    const logger = createLogger(dir, { maxBytes: 1024, maxFiles: 3 });
    const line = 'x'.repeat(200);
    for (let i = 0; i < 100; i++) logger.warn('test', `${i} ${line}`);
    const files = readdirSync(join(dir, 'logs')).sort();
    expect(files).toEqual(['deepfocus.log', 'deepfocus.log.1', 'deepfocus.log.2']);
    for (const f of files) expect(statSync(join(dir, 'logs', f)).size).toBeLessThanOrEqual(1024 + 400);
    expect(readFileSync(join(dir, 'logs', 'deepfocus.log'), 'utf8')).toMatch(/99 x/);
  });
});
