// Главное окно. Поведение закрытия (в трей) и выхода — Т07.
import { BrowserWindow } from 'electron';
import { loadRenderer, secureWebPreferences } from '../windows';

/** Цвет фона до загрузки renderer — совпадает с токеном --df-bg тёмной темы. */
const GRAPHITE_BG = '#16191d';

export function createMainWindow(opts: { show?: boolean } = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 740,
    minWidth: 880,
    minHeight: 560,
    show: false,
    title: 'Deep Focus',
    backgroundColor: GRAPHITE_BG,
    autoHideMenuBar: true,
    webPreferences: secureWebPreferences(),
  });
  win.removeMenu();
  if (opts.show !== false) win.once('ready-to-show', () => win.show());
  void loadRenderer(win, 'app');
  return win;
}
