// IPC домена settings: get / patch / рассылка изменений / резервная копия / папка данных / удаление данных.
import { readFile, writeFile } from 'node:fs/promises';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
import { en } from '../../shared/i18n/en';
import { ru } from '../../shared/i18n/ru';
import { IPC } from '../../shared/ipc';
import type { AppSettings, DeleteDataResult, FileActionResult } from '../../shared/types';
import { SNAPSHOT_KEY, STRICT_LOCKED_KEY, StrictLockedError } from '../blocker';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isPlainObject, v } from '../validate';
import { deleteMarkerPath, requestDeleteAllData } from './dataReset';
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
  // Strict во время сессии: настройки, снимающие блокировку, отклоняются (§4.7)
  handle<[unknown]>(IPC.settings.patch, [isPlainObject], (patch) => {
    const blocker = ctx.services.blocker;
    if (blocker && !blocker.allowsSettings(settings.preview(patch), settings.get())) throw new StrictLockedError();
    return settings.patch(patch);
  });

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
    // копия заменяет правила и настройки блокировки — в Strict во время сессии это обход ожидания и фразы
    if (ctx.services.blocker?.status().strictLocked) return { ok: false, errorKey: STRICT_LOCKED_KEY };
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

  // «Удалить все данные»: слово подтверждения вводится в окне; main проверяет его сам.
  handle<[string]>(IPC.settings.deleteAllData, [v.str({ max: 100 })], (word): Promise<DeleteDataResult> =>
    requestDeleteAllData(word, {
      confirmWords: [ru.settings.deleteConfirmWord, en.settings.deleteConfirmWord],
      disableBlocker: () => {
        const was = settings.get().blocker.enabled;
        if (was) settings.patch({ blocker: { enabled: false } });
        return () => {
          if (was) settings.patch({ blocker: { enabled: true } });
        };
      },
      releaseBlocker: async () => {
        await ctx.services.blocker?.cleanup();
      },
      proxyRestored: () => ctx.storage.kv.get(SNAPSHOT_KEY) === null,
      stopActivity: () => {
        ctx.services.timer?.stop();
        ctx.services.audio?.stop({ fade: false });
      },
      writeMarker: () => writeFile(deleteMarkerPath(ctx.paths.userData), String(Date.now()), 'utf8'),
      restart: () => {
        logger.info('settings', 'delete all data: blocking released, restarting to delete');
        // DEEPFOCUS_NO_RELAUNCH — для e2e: тест сам запускает приложение снова.
        if (!process.env.DEEPFOCUS_NO_RELAUNCH) app.relaunch();
        setImmediate(() => app.quit());
      },
    }),
  );
}
