// Общие настройки безопасности окон и загрузка renderer-входов (app, widget, audio).
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shell, type BrowserWindow, type WebContents, type WebPreferences } from 'electron';

export type RendererEntry = 'app' | 'widget' | 'audio';
const RENDERER_ENTRIES: readonly RendererEntry[] = ['app', 'widget', 'audio'];

/** Папка собранных страниц renderer (out/renderer). */
const rendererDir = () => join(__dirname, '../renderer');

/** contextIsolation + sandbox, без nodeIntegration; система — только через window.deepFocus (preload). */
export function secureWebPreferences(extra: Partial<WebPreferences> = {}): WebPreferences {
  return {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    ...extra,
  };
}

export function devServerUrl(): string | null {
  return process.env.ELECTRON_RENDERER_URL ?? null;
}

/**
 * URL — одна из собственных страниц приложения: renderer/{app,widget,audio}/index.html (в dev — те же пути
 * на dev-сервере); #хеш и ?запрос не важны. Любой другой file:// (например, перетащенный в окно .html) — нет.
 */
export function isAppPageUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const dev = devServerUrl();
  if (dev !== null && u.protocol !== 'file:') {
    let base: URL;
    try {
      base = new URL(dev);
    } catch {
      return false;
    }
    const prefix = base.pathname.replace(/\/$/, '');
    return u.origin === base.origin && RENDERER_ENTRIES.some((e) => u.pathname === `${prefix}/${e}/index.html`);
  }
  if (u.protocol !== 'file:' || u.host !== '') return false;
  let path: string;
  try {
    path = resolve(fileURLToPath(u));
  } catch {
    return false;
  }
  const same = (a: string, b: string) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
  return RENDERER_ENTRIES.some((e) => same(path, resolve(rendererDir(), e, 'index.html')));
}

/** Запрещает новые окна и переходы за пределы приложения. */
export function hardenWebContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    // Внешние ссылки (например, документация) открываются в браузере пользователя по его клику
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Переход — только между собственными страницами; перетащенный в окно .html или чужой file:// не открывается
  wc.on('will-navigate', (event, url) => {
    if (!isAppPageUrl(url)) event.preventDefault();
  });
  wc.on('will-frame-navigate', (event) => {
    if (!isAppPageUrl(event.url)) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}

export function loadRenderer(win: BrowserWindow, entry: RendererEntry): Promise<void> {
  hardenWebContents(win.webContents);
  const dev = devServerUrl();
  if (dev) return win.loadURL(`${dev}/${entry}/index.html`);
  return win.loadFile(join(rendererDir(), entry, 'index.html'));
}
