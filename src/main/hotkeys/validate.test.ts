import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { normalizeAccelerator, validateHotkey } from './validate';

const current = DEFAULT_SETTINGS.hotkeys; // Ctrl+Alt+Space / W / I / E / M

describe('normalizeAccelerator', () => {
  it('приводит модификаторы к порядку Ctrl, Alt, Shift, Super и синонимы — к одному имени', () => {
    expect(normalizeAccelerator('alt+control+k')).toBe('Ctrl+Alt+K');
    expect(normalizeAccelerator('Shift+CmdOrCtrl+Alt+f5')).toBe('Ctrl+Alt+Shift+F5');
    expect(normalizeAccelerator('Ctrl+Alt+Escape')).toBe('Ctrl+Alt+Esc');
    expect(normalizeAccelerator('Ctrl+Alt+Del')).toBe('Ctrl+Alt+Delete');
    expect(normalizeAccelerator('Ctrl+Alt+space')).toBe('Ctrl+Alt+Space');
  });

  it('неразбираемое сочетание → null', () => {
    expect(normalizeAccelerator('Ctrl+Alt')).toBeNull(); // нет клавиши
    expect(normalizeAccelerator('Ctrl+A+B')).toBeNull(); // две клавиши
    expect(normalizeAccelerator('Ctrl+Ctrl+A')).toBeNull(); // повтор модификатора
    expect(normalizeAccelerator('Ctrl+Alt+Banana')).toBeNull();
    expect(normalizeAccelerator('Ctrl++')).toBeNull();
  });
});

describe('validateHotkey', () => {
  it('пустое значение — сочетание отключено, это допустимо', () => {
    expect(validateHotkey('', 'toggleSound', current)).toEqual({ ok: true, reasonKey: null });
  });

  it('свободное сочетание из двух модификаторов и клавиши допустимо', () => {
    expect(validateHotkey('Ctrl+Shift+F9', 'toggleSound', current)).toEqual({ ok: true, reasonKey: null });
  });

  it('системные сочетания Windows отклоняются', () => {
    for (const accel of [
      'Alt+Tab',
      'Alt+F4',
      'Ctrl+Alt+Delete',
      'Ctrl+Esc',
      'Ctrl+Shift+Esc',
      'PrintScreen',
      'Alt+PrintScreen',
      'Super+D',
      'Ctrl+Alt+Super+L',
      'Alt+Space',
    ]) {
      expect(validateHotkey(accel, 'startPause', current), accel).toEqual({ ok: false, reasonKey: 'system.hotkeys.reason.system' });
    }
  });

  it('сочетание без двух модификаторов перехватило бы обычный ввод', () => {
    for (const accel of ['A', 'F5', 'Shift+A', 'Ctrl+C', 'Alt+X']) {
      expect(validateHotkey(accel, 'startPause', current), accel).toEqual({ ok: false, reasonKey: 'system.hotkeys.reason.needsModifier' });
    }
  });

  it('дубликат другого действия приложения отклоняется, своё же значение — нет', () => {
    expect(validateHotkey('Alt+Ctrl+W', 'startPause', current)).toEqual({ ok: false, reasonKey: 'system.hotkeys.reason.duplicate' });
    expect(validateHotkey('Ctrl+Alt+W', 'toggleWidget', current)).toEqual({ ok: true, reasonKey: null });
  });

  it('неразбираемое сочетание — invalid', () => {
    expect(validateHotkey('Ctrl+Alt', 'startPause', current)).toEqual({ ok: false, reasonKey: 'system.hotkeys.reason.invalid' });
  });
});
