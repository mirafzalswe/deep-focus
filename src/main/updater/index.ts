// Модуль updater (R150, R158i): UpdateService поверх electron-updater. Пока источник не настроен,
// electron-updater не загружается и сетевых запросов нет.
import { app } from 'electron';
import type { MainContext } from '../context';
import { UpdateService, type UpdaterLike } from './UpdateService';
import { UPDATE_OWNER, UPDATE_REPO } from './source';

export { UpdateService } from './UpdateService';

declare module '../context' {
  interface Services {
    updater: UpdateService;
  }
}

export function registerUpdater(ctx: MainContext): void {
  ctx.services.updater = new UpdateService({
    source: { owner: UPDATE_OWNER, repo: UPDATE_REPO },
    isPackaged: app.isPackaged,
    createUpdater: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- ленивая загрузка: без источника модуль не нужен
      const { autoUpdater } = require('electron-updater') as { autoUpdater: UpdaterLike };
      return autoUpdater;
    },
    log: (message, err) => ctx.logger.warn('updater', message, err),
  });
}
