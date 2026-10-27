// Проверка глобальных сочетаний (§8.3). Чистые функции, без Electron.
// «Занято другой программой» узнаётся только при регистрации — это делает HotkeyManager.
import type { AppSettings, HotkeyAction, HotkeyCheck } from '../../shared/types';

export const HOTKEY_REASON = {
  invalid: 'system.hotkeys.reason.invalid',
  system: 'system.hotkeys.reason.system',
  needsModifier: 'system.hotkeys.reason.needsModifier',
  duplicate: 'system.hotkeys.reason.duplicate',
  taken: 'system.hotkeys.reason.taken',
} as const;

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = ['startPause', 'toggleWidget', 'toggleClickThrough', 'endSession', 'toggleSound'];

type Modifier = 'Ctrl' | 'Alt' | 'Shift' | 'Super';
const MODIFIER_ORDER: readonly Modifier[] = ['Ctrl', 'Alt', 'Shift', 'Super'];

const MODIFIERS: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  commandorcontrol: 'Ctrl',
  cmdorctrl: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  cmd: 'Super',
  command: 'Super',
  win: 'Super',
};

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  ins: 'Insert',
  enter: 'Enter',
  return: 'Enter',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  esc: 'Esc',
  escape: 'Esc',
  printscreen: 'PrintScreen',
  capslock: 'Capslock',
  numlock: 'Numlock',
  scrolllock: 'Scrolllock',
  plus: 'Plus',
  volumeup: 'VolumeUp',
  volumedown: 'VolumeDown',
  volumemute: 'VolumeMute',
  medianexttrack: 'MediaNextTrack',
  mediaprevioustrack: 'MediaPreviousTrack',
  mediastop: 'MediaStop',
  mediaplaypause: 'MediaPlayPause',
  numdec: 'numdec',
  numadd: 'numadd',
  numsub: 'numsub',
  nummult: 'nummult',
  numdiv: 'numdiv',
};

const PUNCTUATION = new Set([...'-=[]\\;\',./`']);

function normalizeKey(token: string): string | null {
  const lower = token.toLowerCase();
  if (/^[a-z0-9]$/.test(lower)) return lower.toUpperCase();
  if (/^f([1-9]|1\d|2[0-4])$/.test(lower)) return lower.toUpperCase();
  if (/^num[0-9]$/.test(lower)) return lower;
  if (token.length === 1 && PUNCTUATION.has(token)) return token;
  return NAMED_KEYS[lower] ?? null;
}

/** Каноническая запись Electron-сочетания: 'alt+control+k' → 'Ctrl+Alt+K'; неразбираемое → null. */
export function normalizeAccelerator(accel: string): string | null {
  const tokens = accel.trim().split('+');
  if (tokens.some((t) => t.trim() === '')) return null;
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const raw of tokens) {
    const token = raw.trim();
    const mod = MODIFIERS[token.toLowerCase()];
    if (mod) {
      if (mods.has(mod) || key !== null) return null;
      mods.add(mod);
      continue;
    }
    if (key !== null) return null;
    key = normalizeKey(token);
    if (key === null) return null;
  }
  if (key === null) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** Зарезервированы Windows (переключение окон, диспетчер задач, экран блокировки и т.п.). */
const SYSTEM_COMBOS = new Set([
  'Alt+Tab',
  'Alt+Shift+Tab',
  'Ctrl+Alt+Tab',
  'Ctrl+Tab',
  'Alt+F4',
  'Ctrl+F4',
  'Alt+Esc',
  'Alt+Shift+Esc',
  'Ctrl+Esc',
  'Ctrl+Shift+Esc',
  'Ctrl+Alt+Delete',
  'Alt+Space',
  'Alt+Enter',
]);

function isSystem(canonical: string): boolean {
  const parts = canonical.split('+');
  const key = parts[parts.length - 1];
  return parts.includes('Super') || key === 'PrintScreen' || SYSTEM_COMBOS.has(canonical);
}

/** Глобальное сочетание без двух модификаторов (Ctrl/Alt/Shift) перехватывало бы обычный ввод во всех программах. */
function hasEnoughModifiers(canonical: string): boolean {
  const parts = canonical.split('+').slice(0, -1);
  return parts.filter((p) => p === 'Ctrl' || p === 'Alt' || p === 'Shift').length >= 2;
}

/**
 * Можно ли назначить accel действию action при текущих сочетаниях приложения.
 * '' — отключено (допустимо). Порядок причин: invalid → system → needsModifier → duplicate.
 */
export function validateHotkey(accel: string, action: HotkeyAction, current: AppSettings['hotkeys']): HotkeyCheck {
  if (accel.trim() === '') return { ok: true, reasonKey: null };
  const canonical = normalizeAccelerator(accel);
  if (canonical === null) return { ok: false, reasonKey: HOTKEY_REASON.invalid };
  if (isSystem(canonical)) return { ok: false, reasonKey: HOTKEY_REASON.system };
  if (!hasEnoughModifiers(canonical)) return { ok: false, reasonKey: HOTKEY_REASON.needsModifier };
  const duplicate = HOTKEY_ACTIONS.some((other) => other !== action && current[other] !== '' && normalizeAccelerator(current[other]) === canonical);
  if (duplicate) return { ok: false, reasonKey: HOTKEY_REASON.duplicate };
  return { ok: true, reasonKey: null };
}
