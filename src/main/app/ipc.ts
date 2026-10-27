// IPC домена app: версия, выход, обновления, путь журнала, статусы модулей.
// Выход с активной сессией (диалог, quitBehavior) — Т07; обновления — Т08 через ctx.services.updater.
import { app } from 'electron';
import { IPC } from '../../shared/ipc';
import type { UpdateStatus } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';

const disabled = (): UpdateStatus => ({ state: 'disabled', version: null, reasonKey: null });

export function registerApp(ctx: MainContext): void {
  handle<[]>(IPC.app.version, [], () => app.getVersion());
  handle<[]>(IPC.app.quit, [], () => app.quit());
  handle<[]>(IPC.app.checkUpdates, [], () => ctx.services.updater?.checkNow() ?? disabled());
  handle<[]>(IPC.app.updateStatus, [], () => ctx.services.updater?.status() ?? disabled());
  handle<[]>(IPC.app.logPath, [], () => ctx.logger.path);
  handle<[]>(IPC.app.modules, [], () => ctx.moduleStatuses());
}
