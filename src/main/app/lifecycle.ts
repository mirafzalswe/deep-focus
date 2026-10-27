// Жизненный цикл (§9): «Выход» с вопросом о сессии, закрытие окна в трей, автозапуск с Windows.
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import type { MainContext } from '../context';
import { loginItemSettings, quitChoice, quitPlan, QUIT_BUTTONS } from './quit';

export interface Lifecycle {
  /**
   * Полный выход по желанию пользователя (трей, кнопка в окне, закрытие окна без трея).
   * При идущей сессии — по quitBehavior или диалогу. false — пользователь передумал.
   */
  requestQuit(): Promise<boolean>;
  isQuitting(): boolean;
  /** Закрытие главного окна: в трей (closeToTray) или выход. */
  attachMainWindow(win: BrowserWindow): void;
}

declare module '../context' {
  interface Services {
    lifecycle: Lifecycle;
  }
}

export function createLifecycle(ctx: MainContext): Lifecycle {
  let quitting = false;
  let pending: Promise<boolean> | null = null;

  // Выход не через requestQuit (завершение работы Windows, обновление): запомненное «остановить» действует и здесь.
  // Слушатель регистрируется раньше модуля timer, поэтому его финальный heartbeat видит уже остановленную сессию.
  app.on('before-quit', () => {
    if (!quitting) {
      const timer = ctx.services.timer;
      if (timer && quitPlan(timer.snapshot().status, ctx.settings.get().general.quitBehavior) === 'stop') {
        try {
          timer.stop();
        } catch (err) {
          ctx.logger.error('app', 'stopping session on quit failed', err);
        }
      }
    }
    quitting = true;
  });

  async function ask(): Promise<ReturnType<typeof quitChoice>> {
    const win = ctx.mainWindow();
    const options: MessageBoxOptions = {
      type: 'question',
      title: ctx.t('common.appName'),
      message: ctx.t('system.quit.message'),
      detail: ctx.t('system.quit.detail'),
      buttons: QUIT_BUTTONS.map((b) => (b === 'cancel' ? ctx.t('common.cancel') : ctx.t(`system.quit.${b}`))),
      defaultId: QUIT_BUTTONS.indexOf('keep'),
      cancelId: QUIT_BUTTONS.indexOf('cancel'),
      checkboxLabel: ctx.t('system.quit.remember'),
      checkboxChecked: false,
      noLink: true,
    };
    const res = win && win.isVisible() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return quitChoice(res.response, res.checkboxChecked);
  }

  async function decideAndQuit(): Promise<boolean> {
    const timer = ctx.services.timer;
    let plan = timer ? quitPlan(timer.snapshot().status, ctx.settings.get().general.quitBehavior) : 'keep';
    if (plan === 'ask') {
      const choice = await ask();
      if (choice.remember) ctx.settings.patch({ general: { quitBehavior: choice.remember } });
      if (choice.plan === 'cancel') return false;
      plan = choice.plan;
    }
    if (plan === 'stop') timer?.stop();
    ctx.logger.info('app', `quit requested by user (session: ${plan})`);
    // Блокировка снимается всегда: will-quit модуля blocker (§4.7, §9.3).
    quitting = true;
    app.quit();
    return true;
  }

  function requestQuit(): Promise<boolean> {
    pending ??= decideAndQuit()
      .catch((err: unknown) => {
        ctx.logger.error('app', 'quit flow failed, quitting anyway', err);
        quitting = true;
        app.quit();
        return true;
      })
      .finally(() => (pending = null));
    return pending;
  }

  // Автозапуск: только у установленного приложения — иначе в HKCU\…\Run попал бы electron.exe разработки.
  const applyLoginItem = (enabled: boolean) => {
    if (!app.isPackaged) {
      ctx.logger.info('app', `launchAtLogin=${enabled} is applied only in the installed app`);
      return;
    }
    try {
      app.setLoginItemSettings(loginItemSettings(enabled));
    } catch (err) {
      ctx.logger.error('app', 'setLoginItemSettings failed', err);
    }
  };
  if (app.isPackaged) applyLoginItem(ctx.settings.get().general.launchAtLogin);
  ctx.settings.on('change', (next, prev) => {
    if (next.general.launchAtLogin !== prev.general.launchAtLogin) applyLoginItem(next.general.launchAtLogin);
  });

  return {
    requestQuit,
    isQuitting: () => quitting,
    attachMainWindow(win) {
      win.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        // Без трея (модуль не поднялся) спрятанное окно было бы не вернуть — тогда закрытие = выход.
        if (ctx.settings.get().general.closeToTray && ctx.services.tray) win.hide();
        else void requestQuit();
      });
    },
  };
}
