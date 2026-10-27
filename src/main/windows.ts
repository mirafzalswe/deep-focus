// Общие настройки безопасности окон и загрузка renderer-входов (app, widget, audio).
import { join } from 'node:path';
import { shell, type BrowserWindow, type WebContents, type WebPreferences } from 'electron';

export type RendererEntry = 'app' | 'widget' | 'audio';

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

/** Запрещает новые окна и переходы за пределы приложения. */
export function hardenWebContents(wc: WebContents): void {
  wc.setWindowOpenHandler(({ url }) => {
    // Внешние ссылки (например, документация) открываются в браузере пользователя по его клику
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const dev = devServerUrl();
    const allowed = url.startsWith('file://') || (dev !== null && url.startsWith(dev));
    if (!allowed) event.preventDefault();
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
}

export function loadRenderer(win: BrowserWindow, entry: RendererEntry): Promise<void> {
  hardenWebContents(win.webContents);
  const dev = devServerUrl();
  if (dev) return win.loadURL(`${dev}/${entry}/index.html`);
  return win.loadFile(join(__dirname, `../renderer/${entry}/index.html`));
}
