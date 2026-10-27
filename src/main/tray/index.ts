// Модуль tray (§9.1): значок в трее, подсказка с остатком, меню (открыть, старт/пауза, таймер, интерактивность,
// поверх окон, выход). Левый клик — открыть главное окно.
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import type { TimerSnapshot } from '../../shared/types';
import type { MainContext } from '../context';
import { startPauseCommand } from '../hotkeys/actions';
import { trayIconTone, trayMenuModel, trayTooltip, type TrayItemId, type TrayTone } from './trayModel';

export { trayIconTone, trayMenuModel, trayTooltip } from './trayModel';

export interface TrayManager {
  create(): void;
  refresh(snapshot: TimerSnapshot | null): void;
  destroy(): void;
}

declare module '../context' {
  interface Services {
    tray: TrayManager;
  }
}

/** Цвета значка — те же приглушённые тона, что в интерфейсе (графит, синий, зелёный, янтарный). */
const TONE_RGB: Record<TrayTone, [number, number, number]> = {
  idle: [0x9a, 0xa3, 0xad],
  focus: [0x6b, 0x93, 0xc4],
  break: [0x6f, 0xae, 0x8c],
  paused: [0xc9, 0xa2, 0x5a],
};

/** Значок рисуется кодом (кольцо, в работе — с точкой), чтобы не зависеть от файлов ресурсов. */
function drawIcon(tone: TrayTone): NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const [r, g, b] = TONE_RGB[tone];
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const ring = Math.min(1, Math.max(0, 15.5 - d)) * Math.min(1, Math.max(0, d - 10.5));
      const dot = tone === 'idle' ? 0 : Math.min(1, Math.max(0, 7.5 - d));
      const alpha = Math.round(255 * Math.max(ring, dot));
      const i = (y * size + x) * 4;
      // BGRA
      buf[i] = b;
      buf[i + 1] = g;
      buf[i + 2] = r;
      buf[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 });
}

export function registerTray(ctx: MainContext): void {
  let tray: Tray | null = null;
  let lastTone: TrayTone | null = null;
  let lastMenuKey = '';
  const icons = new Map<TrayTone, NativeImage>();
  const icon = (tone: TrayTone) => {
    let img = icons.get(tone);
    if (!img) icons.set(tone, (img = drawIcon(tone)));
    return img;
  };

  const run = (id: TrayItemId, checked: boolean) => {
    const { timer, widget, lifecycle } = ctx.services;
    switch (id) {
      case 'open':
        return ctx.showMainWindow();
      case 'startPause':
        if (timer) timer.command(startPauseCommand(timer.snapshot(), ctx.settings.get().timer.freeExtendMin));
        return;
      case 'showTimer':
        if (checked) widget?.show();
        else widget?.hide();
        return;
      case 'interactive':
        return widget?.setClickThrough(!checked);
      case 'alwaysOnTop':
        return widget?.setAlwaysOnTop(checked);
      case 'quit':
        if (lifecycle) void lifecycle.requestQuit();
        else app.quit();
    }
  };

  const refresh = (snapshot: TimerSnapshot | null) => {
    if (!tray || tray.isDestroyed()) return;
    tray.setToolTip(trayTooltip(snapshot, ctx.t).slice(0, 127));
    const tone = trayIconTone(snapshot);
    if (tone !== lastTone) {
      tray.setImage(icon(tone));
      lastTone = tone;
    }
    const { widget } = ctx.services;
    const w = ctx.settings.get().widget;
    const model = trayMenuModel({
      timer: snapshot,
      widgetAvailable: widget !== undefined,
      widgetVisible: widget?.isVisible() ?? false,
      clickThrough: w.clickThrough,
      alwaysOnTop: w.alwaysOnTop,
    });
    // Меню пересобирается только при изменении (тики раз в секунду меняют лишь подсказку).
    const menuKey = JSON.stringify(model) + ctx.settings.get().general.language;
    if (menuKey === lastMenuKey) return;
    lastMenuKey = menuKey;
    const template: MenuItemConstructorOptions[] = model.map((item) =>
      'type' in item
        ? { type: 'separator' }
        : {
            label: ctx.t(item.labelKey),
            enabled: item.enabled,
            ...(item.checked === undefined ? {} : { type: 'checkbox' as const, checked: item.checked }),
            click: (menuItem) => {
              try {
                run(item.id, menuItem.checked);
              } catch (err) {
                ctx.logger.error('tray', `menu action ${item.id} failed`, err);
              }
            },
          },
    );
    tray.setContextMenu(Menu.buildFromTemplate(template));
  };

  const snapshot = () => ctx.services.timer?.snapshot() ?? null;

  const manager: TrayManager = {
    create() {
      if (tray && !tray.isDestroyed()) return;
      lastTone = null;
      lastMenuKey = '';
      tray = new Tray(icon('idle'));
      tray.on('click', () => ctx.showMainWindow());
      refresh(snapshot());
    },
    refresh,
    destroy() {
      tray?.destroy();
      tray = null;
    },
  };

  manager.create();
  ctx.services.tray = manager;

  const { timer, widget } = ctx.services;
  timer?.on('state', refresh);
  timer?.on('tick', refresh);
  widget?.on('visibilityChanged', () => refresh(snapshot()));
  ctx.settings.on('change', () => refresh(snapshot()));
  app.on('will-quit', () => manager.destroy());
}
