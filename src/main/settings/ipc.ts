// IPC домена settings: get / patch / рассылка изменений / резервная копия / папка данных / удаление данных.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import { IPC } from '../../shared/ipc';
import type { AppSettings, FileActionResult } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isPlainObject } from '../validate';
import { SettingsError } from './SettingsManager';

const MAX_BACKUP_BYTES = 5 * 1024 * 1024;

function applyNativeTheme(settings: AppSettings) {
  nativeTheme.themeSource = settings.general.theme;
}

export function registerSettings(ctx: MainContext): void {
  const { settings, logger } = ctx;

  applyNativeTheme(settings.get());
  settings.on('change', (next, prev) => {
    if (next.general.theme !== prev.general.theme) applyNativeTheme(next);
    ctx.broadcast(IPC.settings.changed, next);
  });

  handle<[]>(IPC.settings.get, [], () => settings.get());
  handle<[unknown]>(IPC.settings.patch, [isPlainObject], (patch) => settings.patch(patch));

  handle<[]>(IPC.settings.exportBackup, [], async (): Promise<FileActionResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
    const date = new Date().toISOString().slice(0, 10);
    const options = {
      defaultPath: `deep-focus-backup-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const res = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (res.canceled || !res.filePath) return { ok: false, cancelled: true };
    try {
      await writeFile(res.filePath, JSON.stringify(settings.exportBackup(), null, 2), 'utf8');
      return { ok: true, path: res.filePath };
    } catch (err) {
      logger.error('settings', 'backup export failed', err);
      return { ok: false, errorKey: 'common.error' };
    }
  });

  handle<[]>(IPC.settings.importBackup, [], async (): Promise<FileActionResult> => {
    const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
    const options = {
      properties: ['openFile' as const],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    };
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    const filePath = res.filePaths[0];
    if (res.canceled || !filePath) return { ok: false, cancelled: true };
    try {
      const raw = await readFile(filePath);
      if (raw.byteLength > MAX_BACKUP_BYTES) throw new SettingsError('backup.size');
      settings.importBackup(JSON.parse(raw.toString('utf8')));
      return { ok: true, path: filePath };
    } catch (err) {
      logger.warn('settings', 'backup import rejected', err instanceof SettingsError ? err.field : err);
      return { ok: false, errorKey: 'settings.backupInvalid' };
    }
  });

  handle<[]>(IPC.settings.openDataFolder, [], async () => {
    const error = await shell.openPath(ctx.paths.userData);
    if (error) logger.warn('settings', `openDataFolder: ${error}`);
  });

  handle<[]>(IPC.settings.deleteAllData, [], async () => {
    const win = BrowserWindow.getFocusedWindow() ?? ctx.mainWindow();
    const options = {
      type: 'warning' as const,
      buttons: [ctx.t('common.delete'), ctx.t('common.cancel')],
      defaultId: 1,
      cancelId: 1,
      message: ctx.t('settings.deleteAllData'),
      detail: ctx.t('settings.deleteAllDataConfirm'),
    };
    const res = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    if (res.response !== 0) return false;
    logger.info('settings', 'delete all data requested');
    // Удаление — при следующем запуске, до открытия базы: обычный выход успевает снять блокировку и т.п.
    await writeFile(deleteMarkerPath(ctx.paths.userData), String(Date.now()), 'utf8');
    app.relaunch();
    app.quit();
    return true;
  });
}

export const deleteMarkerPath = (userData: string) => join(userData, '.delete-all-data');

/** Вызывается index.ts до открытия базы: если пользователь просил удалить все данные — удаляем. */
export async function deleteAllDataIfRequested(userData: string, dbPath: string): Promise<boolean> {
  const marker = deleteMarkerPath(userData);
  try {
    await readFile(marker);
  } catch {
    return false;
  }
  for (const suffix of ['', '-wal', '-shm']) await rm(dbPath + suffix, { force: true });
  await rm(join(userData, 'sounds'), { recursive: true, force: true });
  await rm(marker, { force: true });
  return true;
}
