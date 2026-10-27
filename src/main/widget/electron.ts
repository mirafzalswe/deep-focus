// Адаптеры WidgetManager к Electron: окно виджета на BrowserWindow и экраны через screen.
import { BrowserWindow, screen } from 'electron';
import type { Unsubscribe } from '../../shared/types';
import { loadRenderer, secureWebPreferences } from '../windows';
import type { DisplayInfo, Rect } from './geometry';
import type { ScreenPort, WidgetWindowPort } from './WidgetManager';

/** Уровень, на котором виджет остаётся над обычными окнами и окнами «поверх всех» (§3.2). */
const TOPMOST_LEVEL = 'screen-saver';

export interface WidgetWindowHandle {
  port: WidgetWindowPort;
  window: BrowserWindow;
}

export function createWidgetWindow(
  init: { bounds: Rect; clickThrough: boolean; title: string },
  hooks: { onSystemMenu(): void },
): WidgetWindowHandle {
  const win = new BrowserWindow({
    ...init.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: !init.clickThrough,
    title: init.title,
    webPreferences: secureWebPreferences({ backgroundThrottling: false }),
  });
  win.removeMenu();
  void loadRenderer(win, 'widget');

  let wantTopmost = true;
  const applyTopmost = () => {
    if (win.isDestroyed()) return;
    if (wantTopmost) {
      win.setAlwaysOnTop(true, TOPMOST_LEVEL);
      win.setVisibleOnAllWorkspaces(true);
    } else win.setAlwaysOnTop(false);
  };
  const raise = () => {
    if (win.isDestroyed() || !win.isVisible() || !wantTopmost) return;
    if (!win.isAlwaysOnTop()) applyTopmost();
    win.moveTop();
  };
  // Другое окно забрало фокус — поднимаем виджет снова, не забирая фокус себе
  win.on('blur', raise);
  // Правый клик по зоне перетаскивания открыл бы системное меню окна — показываем своё
  win.on('system-context-menu', (event) => {
    event.preventDefault();
    hooks.onSystemMenu();
  });

  // Падение renderer: окно с мёртвой страницей уничтожается, WidgetManager создаёт новое (по 'closed' ниже)
  let crashed = false;
  win.webContents.on('render-process-gone', () => {
    crashed = true;
    if (!win.isDestroyed()) win.destroy();
  });
  let closeRequest: (() => boolean) | null = null;
  // Закрытие пользователем (Alt+F4): решает WidgetManager — обычно это «Скрыть», при выходе — закрыть
  win.on('close', (event) => {
    if (closeRequest?.()) event.preventDefault();
  });
  let gone: ((reason: 'crashed' | 'closed') => void) | null = null;
  win.on('closed', () => gone?.(crashed ? 'crashed' : 'closed'));

  // Показ до окончания загрузки откладывается до ready-to-show (без белой вспышки), скрытие его отменяет
  let wantVisible = false;
  let loaded = false;
  win.once('ready-to-show', () => {
    loaded = true;
    if (wantVisible && !win.isDestroyed()) {
      win.showInactive();
      raise();
    }
  });

  const port: WidgetWindowPort = {
    show: () => {
      wantVisible = true;
      if (loaded && !win.isDestroyed()) win.showInactive();
    },
    hide: () => {
      wantVisible = false;
      if (!win.isDestroyed()) win.hide();
    },
    isVisible: () => !win.isDestroyed() && win.isVisible(),
    getBounds: () => win.getBounds(),
    setBounds: (r) => {
      if (!win.isDestroyed()) win.setBounds(r);
    },
    setMinimumSize: (w, h) => {
      if (!win.isDestroyed()) win.setMinimumSize(w, h);
    },
    setOpacity: (o) => {
      if (!win.isDestroyed()) win.setOpacity(o);
    },
    setAlwaysOnTop: (on) => {
      wantTopmost = on;
      applyTopmost();
    },
    setClickThrough: (on) => {
      if (win.isDestroyed()) return;
      // WS_EX_TRANSPARENT: клики проходят к окну под виджетом; forward — чтобы renderer видел наведение
      if (on) win.setIgnoreMouseEvents(true, { forward: true });
      else win.setIgnoreMouseEvents(false);
      win.setFocusable(!on);
      // setFocusable на Windows возвращает кнопку на панель задач — убираем её снова
      win.setSkipTaskbar(true);
      applyTopmost();
    },
    raise,
    onGeometryChange: (cb) => {
      win.on('move', cb);
      win.on('resize', cb);
    },
    onGone: (cb) => {
      gone = cb;
    },
    onCloseRequest: (cb) => {
      closeRequest = cb;
    },
  };
  return { port, window: win };
}

export function electronScreen(): ScreenPort {
  return {
    displays: (): DisplayInfo[] => {
      const primaryId = screen.getPrimaryDisplay().id;
      return screen.getAllDisplays().map((d) => ({ id: d.id, primary: d.id === primaryId, workArea: d.workArea }));
    },
    onChange: (cb): Unsubscribe => {
      const events = ['display-added', 'display-removed', 'display-metrics-changed'] as const;
      for (const e of events) screen.on(e as 'display-added', cb);
      return () => {
        for (const e of events) screen.removeListener(e as 'display-added', cb);
      };
    },
  };
}
