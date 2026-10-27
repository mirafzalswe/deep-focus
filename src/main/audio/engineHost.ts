// Скрытое окно audio со звуковым движком. Создаётся по первой надобности (звук или проверка файлов),
// падение renderer → окно пересоздаётся и получает текущее состояние (§12.2). Таймер и другие модули
// от окна не зависят. Статус движка принимается только от webContents этого окна.
import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '../../shared/ipc';
import type { AudioEngineCommand, AudioEngineReport } from '../../shared/types';
import type { Logger } from '../logger';
import { isPlainObject, v } from '../validate';
import { loadRenderer, secureWebPreferences } from '../windows';
import type { EnginePort } from './AudioController';

const MAX_CRASHES = 3;
const CRASH_WINDOW_MS = 60_000;

const isProbeResults = v.array(v.object({ soundId: v.id(), ok: v.bool() }), { max: 1000 });

export function isEngineReport(x: unknown): x is AudioEngineReport {
  if (!isPlainObject(x)) return false;
  switch (x.type) {
    case 'ready':
      return Object.keys(x).length === 1;
    case 'trackFailed':
      return v.object({ type: v.any(), soundId: v.id(), reason: v.oneOf('missing', 'corrupt') })(x);
    case 'probeResult':
      return v.object({ type: v.any(), requestId: v.int(1), results: isProbeResults })(x);
    case 'error':
      return v.object({ type: v.any(), message: v.str({ max: 1000 }) })(x);
    default:
      return false;
  }
}

export interface EngineHostOptions {
  logger: Logger;
  /** текущее состояние микса — отправляется окну после загрузки и после пересоздания */
  current(): AudioEngineCommand;
  onReport(report: AudioEngineReport): void;
  /** окно падает снова и снова — звук недоступен до перезапуска */
  onFatal(message: string): void;
}

export interface EngineHost extends EnginePort {
  /** webContents окна движка (для e2e и проверок), null — окна нет */
  window(): BrowserWindow | null;
  dispose(): void;
}

export function createEngineHost(opts: EngineHostOptions): EngineHost {
  let win: BrowserWindow | null = null;
  let ready = false;
  let pending: AudioEngineCommand[] = [];
  let crashes: number[] = [];
  let fatal = false;
  let disposed = false;

  const alive = () => (win && !win.isDestroyed() ? win : null);

  function create(): BrowserWindow | null {
    if (disposed || fatal) return null;
    const w = new BrowserWindow({
      show: false,
      width: 320,
      height: 200,
      skipTaskbar: true,
      focusable: false,
      title: 'Deep Focus — Audio',
      webPreferences: secureWebPreferences({ backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' }),
    });
    w.removeMenu();
    ready = false;
    w.webContents.on('render-process-gone', (_e, details) => {
      opts.logger.error('audio', `engine renderer gone: ${details.reason}`);
      if (win === w) {
        win = null;
        ready = false;
      }
      if (!w.isDestroyed()) w.destroy();
      const now = Date.now();
      crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
      if (crashes.length > MAX_CRASHES) {
        fatal = true;
        opts.onFatal('engineCrashed');
        return;
      }
      // пересоздаём, только если есть что играть; иначе окно поднимется по следующей команде
      const cmd = opts.current();
      if (cmd.type === 'apply' && cmd.playing) ensure();
    });
    w.on('closed', () => {
      if (win === w) {
        win = null;
        ready = false;
      }
    });
    loadRenderer(w, 'audio').catch((err) => opts.logger.error('audio', 'engine window failed to load', err));
    return w;
  }

  function ensure(): BrowserWindow | null {
    const w = alive();
    if (w) return w;
    win = create();
    return win;
  }

  function deliver(w: BrowserWindow, cmd: AudioEngineCommand) {
    if (!w.isDestroyed()) w.webContents.send(IPC.audio.engineCommand, cmd);
  }

  ipcMain.on(IPC.audio.engineStatus, (event, payload: unknown) => {
    const w = alive();
    // Канал открыт в preload всем окнам — принимаем только от окна движка
    if (!w || event.sender !== w.webContents) return;
    if (!isEngineReport(payload)) {
      opts.logger.warn('audio', 'invalid engine report ignored');
      return;
    }
    if (payload.type === 'ready') {
      ready = true;
      deliver(w, opts.current());
      for (const cmd of pending) deliver(w, cmd);
      pending = [];
    }
    opts.onReport(payload);
  });

  // Скрытое окно не должно держать приложение: закрылось последнее видимое окно — закрываем и его.
  app.on('browser-window-created', (_e, created) => {
    created.on('closed', () => {
      setImmediate(() => {
        const w = alive();
        if (!w || created === w) return;
        const others = BrowserWindow.getAllWindows().filter((o) => o !== w && !o.isDestroyed());
        if (others.length === 0) w.destroy();
      });
    });
  });
  app.on('before-quit', () => {
    disposed = true;
    alive()?.destroy();
  });

  return {
    send(cmd) {
      // Тишина не повод поднимать окно
      if (cmd.type === 'apply' && !cmd.playing && !alive()) return;
      const w = ensure();
      if (!w) return;
      if (!ready) {
        if (cmd.type === 'probe') pending.push(cmd);
        return; // apply придёт целиком из current() после ready
      }
      deliver(w, cmd);
    },
    window: alive,
    dispose() {
      disposed = true;
      alive()?.destroy();
    },
  };
}
