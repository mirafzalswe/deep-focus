import { IPC } from '../../shared/ipc';
import type { HotkeyAction, HotkeyCheck, HotkeyResult } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const hotkeys = {
  validate: (accelerator: string, action: HotkeyAction) => invoke<HotkeyCheck>(IPC.hotkeys.validate, accelerator, action),
  results: () => invoke<HotkeyResult[]>(IPC.hotkeys.results),
  /** Проверить, зарегистрировать и сохранить; '' — отключить. reasonKey !== null — отказ, прежнее сочетание работает. */
  assign: (action: HotkeyAction, accelerator: string) => invoke<HotkeyResult>(IPC.hotkeys.assign, action, accelerator),
  /** Пока окно записывает сочетание, глобальные регистрации сняты (сами вернутся через минуту). */
  setRecording: (on: boolean) => invoke<void>(IPC.hotkeys.setRecording, on),
  onResults: (cb: (results: HotkeyResult[]) => void) => subscribe(IPC.hotkeys.resultsChanged, cb),
};
