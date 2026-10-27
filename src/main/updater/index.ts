// ЗАГЛУШКА Т01 → заполняет Т08 (UpdateService: electron-updater, GitHub Releases, autoDownload: false).
// Пока источник не настроен, проверка обновлений выключена — сетевых запросов нет.
import type { UpdateStatus } from '../../shared/types';
import type { MainContext } from '../context';

export interface UpdateServiceLike {
  checkNow(): Promise<UpdateStatus>;
  status(): UpdateStatus;
}

declare module '../context' {
  interface Services {
    updater: UpdateServiceLike;
  }
}

export const disabledUpdateStatus = (): UpdateStatus => ({ state: 'disabled', version: null, reasonKey: null });

export function registerUpdater(ctx: MainContext): void {
  ctx.services.updater = {
    checkNow: async () => disabledUpdateStatus(),
    status: disabledUpdateStatus,
  };
}
