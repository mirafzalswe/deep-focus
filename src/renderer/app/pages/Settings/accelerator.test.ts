import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent } from './accelerator';

const ev = (code: string, mods: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}) => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('acceleratorFromEvent', () => {
  it('собирает сочетание Electron по физической клавише (раскладка не важна)', () => {
    expect(acceleratorFromEvent(ev('KeyK', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+K');
    expect(acceleratorFromEvent(ev('Space', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Space');
    expect(acceleratorFromEvent(ev('Digit5', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+5');
    expect(acceleratorFromEvent(ev('F9', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+F9');
    expect(acceleratorFromEvent(ev('ArrowUp', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Up');
    expect(acceleratorFromEvent(ev('Numpad7', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+num7');
    expect(acceleratorFromEvent(ev('Comma', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+,');
    expect(acceleratorFromEvent(ev('KeyD', { metaKey: true }))).toBe('Super+D');
  });

  it('одни модификаторы или неизвестная клавиша — сочетание ещё не набрано', () => {
    expect(acceleratorFromEvent(ev('ControlLeft', { ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev('AltRight', { altKey: true, ctrlKey: true }))).toBeNull();
    expect(acceleratorFromEvent(ev('IntlRo', { ctrlKey: true, altKey: true }))).toBeNull();
  });
});
