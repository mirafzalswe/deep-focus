import { IPC } from '../../shared/ipc';
import type { HotkeyAction, HotkeyCheck, HotkeyResult } from '../../shared/types';
import { invoke } from '../bridge';

export const hotkeys = {
  validate: (accelerator: string, action: HotkeyAction) => invoke<HotkeyCheck>(IPC.hotkeys.validate, accelerator, action),
  results: () => invoke<HotkeyResult[]>(IPC.hotkeys.results),
};
