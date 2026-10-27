import { describe, expect, it, vi } from 'vitest';
import type { Logger } from './logger';
import { initModules } from './modules';

const fakeLogger = () => {
  const error = vi.fn<Logger['error']>();
  const logger: Logger = { path: '', error, warn: vi.fn(), info: vi.fn() };
  return Object.assign(logger, { error });
};

describe('initModules', () => {
  it('исключение в одном модуле логируется, остальные инициализируются', async () => {
    const logger = fakeLogger();
    const started: string[] = [];
    const statuses = await initModules(
      [
        { name: 'timer', init: () => void started.push('timer') },
        {
          name: 'blocker',
          init: () => {
            throw new Error('reg.exe missing');
          },
        },
        { name: 'audio', init: async () => Promise.reject(new Error('decode failed')) },
        { name: 'tasks', init: async () => void started.push('tasks') },
      ],
      {},
      logger,
    );
    expect(started).toEqual(['timer', 'tasks']);
    expect(statuses).toEqual([
      { name: 'timer', state: 'ok', error: null },
      { name: 'blocker', state: 'error', error: 'reg.exe missing' },
      { name: 'audio', state: 'error', error: 'decode failed' },
      { name: 'tasks', state: 'ok', error: null },
    ]);
    expect(logger.error).toHaveBeenCalledWith('blocker', expect.stringContaining('init'), expect.any(Error));
    expect(logger.error).toHaveBeenCalledWith('audio', expect.stringContaining('init'), expect.any(Error));
  });
});
