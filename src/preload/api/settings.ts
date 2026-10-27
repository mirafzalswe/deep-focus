import { IPC } from '../../shared/ipc';
import type { AppSettings, DeleteDataResult, FileActionResult, SettingsPatch } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const settings = {
  get: () => invoke<AppSettings>(IPC.settings.get),
  /** Бросает, если значение недопустимо (SettingsError в main); сохранённое не меняется. */
  patch: (p: SettingsPatch) => invoke<AppSettings>(IPC.settings.patch, p),
  onChange: (cb: (next: AppSettings) => void) => subscribe(IPC.settings.changed, cb),
  exportBackup: () => invoke<FileActionResult>(IPC.settings.exportBackup),
  importBackup: () => invoke<FileActionResult>(IPC.settings.importBackup),
  openDataFolder: () => invoke<void>(IPC.settings.openDataFolder),
  /** confirmWord — слово подтверждения (settings.deleteConfirmWord на любом языке). */
  deleteAllData: (confirmWord: string) => invoke<DeleteDataResult>(IPC.settings.deleteAllData, confirmWord),
};
