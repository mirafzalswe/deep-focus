import { describe, expect, it } from 'vitest';
import { HIDDEN_ARG, loginItemSettings, quitChoice, quitPlan } from './quit';

describe('quitPlan', () => {
  it('без идущей сессии выход ничего не спрашивает', () => {
    expect(quitPlan('idle', 'ask')).toBe('keep');
    expect(quitPlan('awaiting', 'ask')).toBe('keep');
    expect(quitPlan('idle', 'stop')).toBe('keep');
  });

  it('идущая или приостановленная сессия: по quitBehavior', () => {
    expect(quitPlan('running', 'ask')).toBe('ask');
    expect(quitPlan('paused', 'ask')).toBe('ask');
    expect(quitPlan('running', 'stop')).toBe('stop');
    expect(quitPlan('paused', 'keep')).toBe('keep');
  });
});

describe('quitChoice', () => {
  it('кнопки диалога: остановить, продолжить, отмена; «запомнить» сохраняет только выбор, не отмену', () => {
    expect(quitChoice(0, false)).toEqual({ plan: 'stop', remember: null });
    expect(quitChoice(1, true)).toEqual({ plan: 'keep', remember: 'keep' });
    expect(quitChoice(0, true)).toEqual({ plan: 'stop', remember: 'stop' });
    expect(quitChoice(2, true)).toEqual({ plan: 'cancel', remember: null });
  });
});

describe('loginItemSettings', () => {
  it('автозапуск стартует свёрнутым в трей', () => {
    expect(loginItemSettings(true)).toEqual({ openAtLogin: true, args: [HIDDEN_ARG] });
    expect(loginItemSettings(false)).toEqual({ openAtLogin: false, args: [HIDDEN_ARG] });
  });
});
