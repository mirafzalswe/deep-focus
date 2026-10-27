export { registerHotkeys } from './ipc';
export { HotkeyManager } from './HotkeyManager';
export type { ShortcutHost, HotkeyManagerDeps } from './HotkeyManager';
export { normalizeAccelerator, validateHotkey, HOTKEY_ACTIONS, HOTKEY_REASON } from './validate';
export { startPauseCommand, soundToggle } from './actions';
