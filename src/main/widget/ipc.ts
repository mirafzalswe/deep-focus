// Модуль widget: WidgetManager на Electron, IPC домена, контекстное меню, временные горячие клавиши.
import { app, BrowserWindow, Menu, Notification, type MenuItemConstructorOptions } from 'electron';
import { IPC } from '../../shared/ipc';
import type { Anchor, WidgetDisplayMode } from '../../shared/types';
import type { MainContext, Services } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';
import { createWidgetWindow, electronScreen } from './electron';
import { registerWidgetHotkeys } from './hotkeys';
import { WidgetManager, type TimerFeed } from './WidgetManager';

declare module '../context' {
  interface Services {
    widget: WidgetManager;
  }
}

const isAnchor = v.oneOf<Anchor>('free', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight');
const isSize = v.int(1, 20_000);

/** TimerEngine из Т02, если он поднялся: виджету нужны только снимок и события. */
function timerFeed(services: Partial<Services>): TimerFeed | null {
  const timer = (services as { timer?: Partial<TimerFeed> }).timer;
  return timer && typeof timer.on === 'function' && typeof timer.snapshot === 'function' ? (timer as TimerFeed) : null;
}

export function registerWidget(ctx: MainContext): void {
  let window: BrowserWindow | null = null;
  let quitting = false;
  app.on('before-quit', () => (quitting = true));

  const manager: WidgetManager = new WidgetManager({
    settings: ctx.settings,
    screen: electronScreen(),
    timer: timerFeed(ctx.services),
    createWindow: (init) => {
      const handleWin = createWidgetWindow(
        { ...init, title: ctx.t('widget.windowTitle') },
        { onSystemMenu: () => showMenu() },
      );
      const created = handleWin.window;
      window = created;
      // после падения новое окно создаётся раньше, чем сюда доходит 'closed' старого
      created.on('closed', () => {
        if (window === created) window = null;
      });
      return handleWin.port;
    },
    onClickThroughRestored: () => notifyClickThroughRestored(),
    // Выход: окно виджета закрывается насовсем (не «Скрыть» и не пересоздание)
    isQuitting: () => quitting || (ctx.services.lifecycle?.isQuitting() ?? false),
    onError: (message, err) => ctx.logger.warn('widget', message, err),
  });

  function showMenu(): void {
    if (!window || window.isDestroyed()) return;
    const s = ctx.settings.get().widget;
    const mode = (displayMode: WidgetDisplayMode): MenuItemConstructorOptions => ({
      label: ctx.t(`widget.menu.${displayMode}`),
      type: 'radio',
      checked: s.displayMode === displayMode,
      click: () => ctx.settings.patch({ widget: { displayMode } }),
    });
    const corner = (anchor: Exclude<Anchor, 'free'>): MenuItemConstructorOptions => ({
      label: ctx.t(`widget.menu.${anchor}`),
      type: 'radio',
      checked: s.anchor === anchor,
      click: () => manager.snapToAnchor(anchor),
    });
    const hotkeys = ctx.settings.get().hotkeys;
    Menu.buildFromTemplate([
      mode('compact'),
      mode('standard'),
      mode('expanded'),
      { type: 'separator' },
      {
        label: ctx.t('widget.menu.snapTo'),
        submenu: [corner('topLeft'), corner('topRight'), corner('bottomLeft'), corner('bottomRight')],
      },
      {
        label: ctx.t('widget.menu.alwaysOnTop'),
        type: 'checkbox',
        checked: s.alwaysOnTop,
        click: () => manager.setAlwaysOnTop(!s.alwaysOnTop),
      },
      {
        label: ctx.t('widget.menu.clickThrough'),
        type: 'checkbox',
        checked: s.clickThrough,
        accelerator: hotkeys.toggleClickThrough || undefined,
        registerAccelerator: false,
        click: () => manager.setClickThrough(!s.clickThrough),
      },
      { type: 'separator' },
      {
        label: ctx.t('widget.menu.hide'),
        accelerator: hotkeys.toggleWidget || undefined,
        registerAccelerator: false,
        click: () => manager.hide(),
      },
      { label: ctx.t('widget.menu.openApp'), click: () => ctx.showMainWindow() },
    ]).popup({ window });
  }

  /** Click-through восстановлен после перезапуска — подсказываем, как вернуть интерактивность (§3.9). */
  function notifyClickThroughRestored(): void {
    const { notifications, hotkeys } = ctx.settings.get();
    if (!notifications.enabled || !Notification.isSupported()) return;
    const toast = new Notification({
      title: ctx.t('widget.clickThroughRestored.title'),
      body: ctx.t('widget.clickThroughRestored.body', { hotkey: hotkeys.toggleClickThrough || '—' }),
      silent: notifications.silent,
    });
    toast.on('click', () => manager.setClickThrough(false));
    toast.show();
  }

  ctx.services.widget = manager;
  manager.on('visibilityChanged', (visible) => ctx.broadcast(IPC.widget.visibilityChanged, visible));
  manager.start();

  handle<[]>(IPC.widget.show, [], () => manager.show());
  handle<[]>(IPC.widget.hide, [], () => manager.hide());
  handle<[]>(IPC.widget.toggle, [], () => manager.toggle());
  handle<[]>(IPC.widget.isVisible, [], () => manager.isVisible());
  handle<[boolean]>(IPC.widget.setClickThrough, [v.bool()], (on) => manager.setClickThrough(on));
  handle<[boolean]>(IPC.widget.setAlwaysOnTop, [v.bool()], (on) => manager.setAlwaysOnTop(on));
  handle<[Anchor]>(IPC.widget.snapTo, [isAnchor], (anchor) => manager.snapToAnchor(anchor));
  handle<[]>(IPC.widget.showMenu, [], () => showMenu());
  handle<[number, number]>(IPC.widget.resize, [isSize, isSize], (w, h) => manager.resize(w, h));

  registerWidgetHotkeys(ctx, manager);
}
