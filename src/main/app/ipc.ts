// IPC домена app: версия, выход (с вопросом о сессии — Т07), обновления, пути данных и журнала, статусы модулей.
import { app } from 'electron';
import { IPC } from '../../shared/ipc';
import type { UpdateStatus } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { createLifecycle } from './lifecycle';

const disabled = (): UpdateStatus => ({ state: 'disabled', version: null, reasonKey: null });

export function registerApp(ctx: MainContext): void {
  const lifecycle = createLifecycle(ctx);
  ctx.services.lifecycle = lifecycle;

  handle<[]>(IPC.app.version, [], () => app.getVersion());
  handle<[]>(IPC.app.quit, [], () => lifecycle.requestQuit());
  handle<[]>(IPC.app.checkUpdates, [], () => ctx.services.updater?.checkNow() ?? disabled());
  handle<[]>(IPC.app.updateStatus, [], () => ctx.services.updater?.status() ?? disabled());
  handle<[]>(IPC.app.logPath, [], () => ctx.logger.path);
  handle<[]>(IPC.app.dataPath, [], () => ctx.paths.userData);
  handle<[]>(IPC.app.modules, [], () => ctx.moduleStatuses());
}
