import { IPC } from '../../shared/ipc';
import type { ModuleStatus, UpdateStatus } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const app = {
  version: () => invoke<string>(IPC.app.version),
  /** Полный выход; при идущей сессии main спросит, что с ней сделать. false — пользователь отменил. */
  quit: () => invoke<boolean>(IPC.app.quit),
  checkUpdates: () => invoke<UpdateStatus>(IPC.app.checkUpdates),
  updateStatus: () => invoke<UpdateStatus>(IPC.app.updateStatus),
  logPath: () => invoke<string>(IPC.app.logPath),
  dataPath: () => invoke<string>(IPC.app.dataPath),
  modules: () => invoke<ModuleStatus[]>(IPC.app.modules),
  onNotice: (cb: (notice: { key: string; params?: Record<string, string | number> }) => void) =>
    subscribe(IPC.app.notice, cb),
};
