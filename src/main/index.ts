// Точка входа main: single-instance, журнал, база, настройки, главное окно, регистрация модулей,
// жизненный цикл (Т07): окно закрывается в трей, запуск свёрнутым (--hidden), выход — через Lifecycle.
import { join } from 'node:path';
import { app, BrowserWindow, dialog, session, type MessageBoxOptions } from 'electron';
import { translate } from '../shared/i18n';
import type { ModuleStatus } from '../shared/types';
import { registerAnalytics } from './analytics';
import { createMainWindow, HIDDEN_ARG, registerApp } from './app';
import { registerAudio } from './audio';
import { CLEANUP_ARG, registerBlocker } from './blocker';
import type { MainContext } from './context';
import { openStorage, openStorageSafe, type Storage } from './db';
import { registerHotkeys } from './hotkeys';
import { setTrustedSender } from './ipc';
import { createLogger } from './logger';
import { initModules, type ModuleDef } from './modules';
import { APP_USER_MODEL_ID, registerNotify } from './notify';
import { deleteAllDataIfRequested, registerSettings, SettingsManager } from './settings';
import { registerTasks } from './tasks';
import { registerTimer } from './timer';
import { registerTray } from './tray';
import { registerUpdater } from './updater';
import { registerWidget } from './widget';
import { devServerUrl, isAppPageUrl } from './windows';

const isDev = !app.isPackaged;

// Отдельная папка данных для e2e-тестов и ручной проверки (не влияет на обычный запуск).
if (process.env.DEEPFOCUS_USER_DATA) app.setPath('userData', process.env.DEEPFOCUS_USER_DATA);

const userData = app.getPath('userData');
// Имя и группировка уведомлений Windows (§8.1); без AppUserModelID они подписаны как «Electron».
app.setAppUserModelId(APP_USER_MODEL_ID);
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
let context: MainContext | null = null;

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow();
    mainWindow.on('closed', () => (mainWindow = null));
    // Закрытие окна: в трей (closeToTray) или выход с вопросом о сессии.
    context?.services.lifecycle?.attachMainWindow(mainWindow);
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

function openDatabase(dbPath: string): { storage: Storage; corruptBackupPath: string | null; error: string | null } {
  try {
    return { ...openStorageSafe(dbPath), error: null };
  } catch (err) {
    // База недоступна (заблокирована, нет прав) — работаем в памяти, чтобы приложение не падало,
    // но не молча: статус storage = error и диалог пользователю (§12.3).
    logger.error('storage', `cannot open database ${dbPath}, falling back to in-memory storage: data will not be saved`, err);
    return { storage: openStorage(':memory:'), corruptBackupPath: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function bootstrap(): Promise<void> {
  setTrustedSender(isAppPageUrl);
  lockDownSession();

  const dbPath = join(userData, 'deepfocus.db');
  try {
    const deleted = await deleteAllDataIfRequested(userData, dbPath);
    if (deleted) logger.info('storage', `all user data deleted on request: ${deleted.join(', ') || '(nothing)'}`);
  } catch (err) {
    logger.error('storage', 'delete all data failed', err);
  }
  const { storage, corruptBackupPath, error: storageError } = openDatabase(dbPath);
  if (corruptBackupPath) logger.error('storage', `database was corrupt, moved to ${corruptBackupPath}`);

  let statuses: ModuleStatus[] = [];
  const settings = new SettingsManager(storage, {
    onListenerError: (err) => logger.error('settings', 'change listener failed', err),
  });

  const ctx: MainContext = (context = {
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
    moduleStatuses: () => [{ name: 'storage', state: storageError ? 'error' : 'ok', error: storageError }, ...statuses],
  });

  statuses = await initModules(MODULES, ctx, logger);
  // Автозапуск с Windows (--hidden) стартует в трей; без трея окно показывается всегда.
  if (!(process.argv.includes(HIDDEN_ARG) && ctx.services.tray)) showMainWindow();

  const warn = (options: MessageBoxOptions) => {
    const win = ctx.mainWindow();
    void (win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options));
  };
  if (corruptBackupPath) {
    warn({ type: 'warning', message: ctx.t('common.appName'), detail: ctx.t('settings.dbRecovered', { file: corruptBackupPath }) });
  }
  if (storageError) {
    // База не открылась: всё живёт в памяти и пропадёт при выходе — где база и где подробности
    warn({
      type: 'error',
      title: ctx.t('common.appName'),
      message: ctx.t('settings.dbUnavailable', { path: dbPath, log: logger.path }),
    });
  }

  logger.info('main', `started ${app.getVersion()}; modules: ${statuses.map((s) => `${s.name}=${s.state}`).join(', ')}`);
}

if (!app.requestSingleInstanceLock()) {
  // Второй экземпляр: первый получит 'second-instance' и покажет своё окно; этот завершается сразу.
  app.exit(0);
} else {
  app.on('second-instance', (_event, argv) => {
    // --cleanup (деинсталлятор) обрабатывает модуль blocker; окно не нужно.
    if (app.isReady() && !argv.includes(CLEANUP_ARG)) showMainWindow();
  });
  // Окна закрываются в трей; без трея (модуль не поднялся) закрытие последнего окна — выход.
  app.on('window-all-closed', () => {
    if (!context?.services.tray || context.services.lifecycle?.isQuitting()) app.quit();
  });
  app
    .whenReady()
    .then(bootstrap)
    .catch((err) => {
      logger.error('main', 'bootstrap failed', err);
      dialog.showErrorBox('Deep Focus', `${String(err)}\n\n${logger.path}`);
      app.quit();
    });
}
