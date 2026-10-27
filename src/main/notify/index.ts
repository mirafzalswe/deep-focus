// Модуль notify: Notifier на Electron Notification, связь с таймером и журналом достижений.
import { Notification } from 'electron';
import type { MainContext } from '../context';
import { Notifier } from './Notifier';

export { Notifier } from './Notifier';
export type { NotifyParams, Toast } from './Notifier';

/**
 * AppUserModelID Windows: без него уведомления не группируются и подписаны как «Electron».
 * Т08: тот же идентификатор — `appId` в electron-builder.
 */
export const APP_USER_MODEL_ID = 'com.deepfocus.app';

declare module '../context' {
  interface Services {
    notifier: Notifier;
  }
}

export function registerNotify(ctx: MainContext): void {
  const notifier = new Notifier({
    settings: () => ctx.settings.get().notifications,
    t: ctx.t,
    show: (toast) => {
      if (!Notification.isSupported()) return;
      const n = new Notification({ title: toast.title, body: toast.body, silent: toast.silent });
      n.on('click', () => ctx.showMainWindow());
      n.show();
    },
  });
  ctx.services.notifier = notifier;

  const { timer, analytics } = ctx.services;
  if (timer) {
    notifier.bindTimer(timer, () => {
      try {
        return analytics?.achievements() ?? [];
      } catch (err) {
        ctx.logger.error('notify', 'reading achievements failed', err);
        return [];
      }
    });
  }
}
