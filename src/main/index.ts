// Точка входа main: single-instance, журнал, база, настройки, главное окно, регистрация модулей.
// Дальше этот файл меняет только Т07 (жизненный цикл); модули живут в своих папках.
import { join } from 'node:path';
import { app, BrowserWindow, dialog, session } from 'electron';
import { translate } from '../shared/i18n';
import type { ModuleStatus } from '../shared/types';
import { registerAnalytics } from './analytics';
import { createMainWindow, registerApp } from './app';
import { registerAudio } from './audio';
import { registerBlocker } from './blocker';
import type { MainContext } from './context';
import { openStorage, openStorageSafe, type Storage } from './db';
import { registerHotkeys } from './hotkeys';
import { setTrustedOrigins } from './ipc';
import { createLogger } from './logger';
import { initModules, type ModuleDef } from './modules';
import { registerNotify } from './notify';
import { deleteAllDataIfRequested, registerSettings, SettingsManager } from './settings';
import { registerTasks } from './tasks';
import { registerTimer } from './timer';
import { registerTray } from './tray';
import { registerUpdater } from './updater';
import { registerWidget } from './widget';
import { devServerUrl } from './windows';

const isDev = !app.isPackaged;

// Отдельная папка данных для e2e-тестов и ручной проверки (не влияет на обычный запуск).
if (process.env.DEEPFOCUS_USER_DATA) app.setPath('userData', process.env.DEEPFOCUS_USER_DATA);

const userData = app.getPath('userData');
const logger = createLogger(userData, { console: isDev });

process.on('uncaughtException', (err) => logger.error('main', 'uncaughtException', err));
process.on('unhandledRejection', (reason) => logger.error('main', 'unhandledRejection', reason));

const MODULES: ModuleDef<MainContext>[] = [
  { name: 'settings', init: registerSettings },
  { name: 'app', init: registerApp },
  { name: 'timer', init: registerTimer },
  { name: 'widget', init: registerWidget },
  { name: 'blocker', init: registerBlocker },
  { name: 'audio', init: registerAudio },
  { name: 'tasks', init: registerTasks },
  { name: 'analytics', init: registerAnalytics },
  { name: 'hotkeys', init: registerHotkeys },
  { name: 'notify', init: registerNotify },
  { name: 'tray', init: registerTray },
  { name: 'updater', init: registerUpdater },
];

let mainWindow: BrowserWindow | null = null;

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => (mainWindow = null));
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Renderer не ходит в сеть: всё, кроме file:, data:, df-sound:, devtools и dev-сервера, отменяется. */
function lockDownSession(): void {
  const dev = devServerUrl();
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.webContentsId === undefined) return callback({}); // запросы самого main (Т08: обновления)
    const url = details.url;
    const local =
      /^(file|data|blob|devtools|df-sound|chrome-extension):/i.test(url) ||
      (dev !== null && (url.startsWith(dev) || url.startsWith(dev.replace(/^http/, 'ws'))));
    callback({ cancel: !local });
  });
}

function openDatabase(dbPath: string): { storage: Storage; corruptBackupPath: string | null } {
  try {
    return openStorageSafe(dbPath);
  } catch (err) {
    // База недоступна (заблокирована, нет прав) — работаем в памяти, чтобы приложение не падало.
    logger.error('storage', 'cannot open database, falling back to in-memory storage', err);
    return { storage: openStorage(':memory:'), corruptBackupPath: null };
  }
}

async function bootstrap(): Promise<void> {
  const dev = devServerUrl();
  setTrustedOrigins(dev ? [dev, 'file://'] : ['file://']);
  lockDownSession();

  const dbPath = join(userData, 'deepfocus.db');
  if (await deleteAllDataIfRequested(userData, dbPath)) logger.info('storage', 'all user data deleted on request');
  const { storage, corruptBackupPath } = openDatabase(dbPath);
  if (corruptBackupPath) logger.error('storage', `database was corrupt, moved to ${corruptBackupPath}`);

  let statuses: ModuleStatus[] = [];
  const settings = new SettingsManager(storage, {
    onListenerError: (err) => logger.error('settings', 'change listener failed', err),
  });

  const ctx: MainContext = {
    isDev,
    paths: {
      userData,
      assets: app.isPackaged ? join(process.resourcesPath, 'assets') : join(app.getAppPath(), 'assets'),
      db: dbPath,
      logs: join(userData, 'logs'),
    },
    logger,
    storage,
    settings,
    services: {},
    mainWindow: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null),
    showMainWindow,
    broadcast: (channel, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload);
      }
    },
    t: (key, params) => translate(settings.get().general.language, key, params),
    moduleStatuses: () => [{ name: 'storage', state: 'ok', error: null }, ...statuses],
  };

  statuses = await initModules(MODULES, ctx, logger);
  showMainWindow();

  if (corruptBackupPath) {
    const win = ctx.mainWindow();
    const options = {
      type: 'warning' as const,
      message: ctx.t('common.appName'),
      detail: ctx.t('settings.dbRecovered', { file: corruptBackupPath }),
    };
    void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  }

  logger.info('main', `started ${app.getVersion()}; modules: ${statuses.map((s) => `${s.name}=${s.state}`).join(', ')}`);
}

if (!app.requestSingleInstanceLock()) {
  // Второй экземпляр: первый получит 'second-instance' и покажет своё окно; этот завершается сразу.
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showMainWindow();
  });
  app.on('window-all-closed', () => app.quit());
  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      logger.error('main', 'bootstrap failed', err);
      dialog.showErrorBox('Deep Focus', `${String(err)}\n\n${logger.path}`);
      app.quit();
    });
}
