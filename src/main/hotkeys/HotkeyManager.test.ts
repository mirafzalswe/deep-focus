import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings, HotkeyAction } from '../../shared/types';
import { HotkeyManager, type ShortcutHost } from './HotkeyManager';

/** Фейковый globalShortcut: «чужие» сочетания заняты другой программой. */
function fakeHost(takenByOthers: string[] = []) {
  const registered = new Map<string, () => void>();
  const host: ShortcutHost = {
    register: (accel, fn) => {
      if (takenByOthers.includes(accel) || registered.has(accel)) return false;
      registered.set(accel, fn);
      return true;
    },
    unregister: (accel) => void registered.delete(accel),
  };
  const press = (accel: string) => registered.get(accel)?.();
  return { host, registered, press };
}

function actions() {
  return {
    startPause: vi.fn(),
    toggleWidget: vi.fn(),
    toggleClickThrough: vi.fn(),
    endSession: vi.fn(),
    toggleSound: vi.fn(),
  } satisfies Record<HotkeyAction, () => void>;
}

const defaults = (): AppSettings['hotkeys'] => ({ ...DEFAULT_SETTINGS.hotkeys });

describe('HotkeyManager', () => {
  it('регистрирует пять действий по умолчанию, нажатие вызывает действие', () => {
    const { host, registered, press } = fakeHost();
    const a = actions();
    const m = new HotkeyManager({ host, actions: a });
    const results = m.applyAll(defaults());
    expect(results.map((r) => [r.action, r.accelerator, r.registered])).toEqual([
      ['startPause', 'Ctrl+Alt+Space', true],
      ['toggleWidget', 'Ctrl+Alt+W', true],
      ['toggleClickThrough', 'Ctrl+Alt+I', true],
      ['endSession', 'Ctrl+Alt+E', true],
      ['toggleSound', 'Ctrl+Alt+M', true],
    ]);
    expect([...registered.keys()]).toHaveLength(5);
    press('Ctrl+Alt+M');
    expect(a.toggleSound).toHaveBeenCalledTimes(1);
    press('Ctrl+Alt+Space');
    expect(a.startPause).toHaveBeenCalledTimes(1);
  });

  it('сочетание, занятое другой программой при запуске, отмечено в результатах, остальные работают', () => {
    const { host, registered } = fakeHost(['Ctrl+Alt+E']);
    const m = new HotkeyManager({ host, actions: actions() });
    const results = m.applyAll(defaults());
    expect(results.find((r) => r.action === 'endSession')).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.taken' });
    expect(registered.size).toBe(4);
    expect(m.results()).toEqual(results);
  });

  it('assign: занято другой программой → прежнее сочетание остаётся рабочим', () => {
    const { host, registered, press } = fakeHost(['Ctrl+Shift+F9']);
    const a = actions();
    const m = new HotkeyManager({ host, actions: a });
    m.applyAll(defaults());
    const res = m.assign('toggleSound', 'Ctrl+Shift+F9', defaults());
    expect(res).toMatchObject({ action: 'toggleSound', registered: false, reasonKey: 'system.hotkeys.reason.taken' });
    expect(registered.has('Ctrl+Alt+M')).toBe(true);
    press('Ctrl+Alt+M');
    expect(a.toggleSound).toHaveBeenCalledTimes(1);
  });

  it('assign: системное и дублирующее сочетание отклоняются без регистрации', () => {
    const { host, registered } = fakeHost();
    const m = new HotkeyManager({ host, actions: actions() });
    m.applyAll(defaults());
    expect(m.assign('toggleSound', 'Alt+F4', defaults())).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.system' });
    expect(m.assign('toggleSound', 'Ctrl+Alt+W', defaults())).toMatchObject({ registered: false, reasonKey: 'system.hotkeys.reason.duplicate' });
    expect(registered.has('Alt+F4')).toBe(false);
    expect(registered.has('Ctrl+Alt+M')).toBe(true);
  });

  it('assign: свободное сочетание заменяет прежнее; пустое значение отключает действие', () => {
    const { host, registered, press } = fakeHost();
    const a = actions();
    const m = new HotkeyManager({ host, actions: a });
    m.applyAll(defaults());
    expect(m.assign('toggleSound', 'shift+ctrl+f9', defaults())).toEqual({
      action: 'toggleSound',
      accelerator: 'Ctrl+Shift+F9',
      registered: true,
      reasonKey: null,
    });
    expect(registered.has('Ctrl+Alt+M')).toBe(false);
    press('Ctrl+Shift+F9');
    expect(a.toggleSound).toHaveBeenCalledTimes(1);

    expect(m.assign('endSession', '', defaults())).toEqual({ action: 'endSession', accelerator: '', registered: false, reasonKey: null });
    expect(registered.has('Ctrl+Alt+E')).toBe(false);
  });

  it('applyAll с изменёнными настройками перерегистрирует только изменившееся', () => {
    const { host } = fakeHost();
    const register = vi.spyOn(host, 'register');
    const m = new HotkeyManager({ host, actions: actions() });
    m.applyAll(defaults());
    register.mockClear();
    m.applyAll({ ...defaults(), toggleWidget: 'Ctrl+Alt+Shift+W' });
    expect(register.mock.calls.map((c) => c[0])).toEqual(['Ctrl+Alt+Shift+W']);
  });

  it('suspend снимает все регистрации (запись сочетания), resume возвращает', () => {
    const { host, registered } = fakeHost();
    const m = new HotkeyManager({ host, actions: actions() });
    m.applyAll(defaults());
    m.suspend();
    expect(registered.size).toBe(0);
    m.resume(defaults());
    expect(registered.size).toBe(5);
    m.dispose();
    expect(registered.size).toBe(0);
  });

  it('validate: занятое другой программой сочетание распознаётся пробной регистрацией', () => {
    const { host, registered } = fakeHost(['Ctrl+Shift+F9']);
    const m = new HotkeyManager({ host, actions: actions() });
    m.applyAll(defaults());
    expect(m.validate('Ctrl+Shift+F9', 'toggleSound', defaults())).toEqual({ ok: false, reasonKey: 'system.hotkeys.reason.taken' });
    expect(m.validate('Ctrl+Shift+F10', 'toggleSound', defaults())).toEqual({ ok: true, reasonKey: null });
    expect(m.validate('Ctrl+Alt+M', 'toggleSound', defaults())).toEqual({ ok: true, reasonKey: null });
    expect(registered.has('Ctrl+Shift+F10')).toBe(false);
  });
});
