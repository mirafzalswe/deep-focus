// ЗАГЛУШКА Т01 → заполняет Т07 (HotkeyManager: globalShortcut, validate, системные сочетания).
import { IPC } from '../../shared/ipc';
import type { HotkeyAction, HotkeyCheck, HotkeyResult } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v } from '../validate';

const isAction = v.oneOf<HotkeyAction>('startPause', 'toggleWidget', 'toggleClickThrough', 'endSession', 'toggleSound');

export function registerHotkeys(_ctx: MainContext): void {
  handle<[string, HotkeyAction]>(
    IPC.hotkeys.validate,
    [v.str({ max: 100 }), isAction],
    (): HotkeyCheck => ({ ok: true, reasonKey: null }),
  );
  handle<[]>(IPC.hotkeys.results, [], (): HotkeyResult[] => []);
}
