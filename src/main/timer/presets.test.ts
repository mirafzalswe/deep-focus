import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TimerPreset } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { deleteTimerPreset, saveTimerPreset } from './presets';

let storage: Storage;
beforeEach(() => {
  storage = openStorage(':memory:');
});
afterEach(() => storage.close());

const mine: TimerPreset = { id: 'mine', name: 'Мой 50/10', builtin: false, focusMin: 50, shortBreakMin: 10, longBreakMin: 20, cyclesBeforeLong: 3 };

describe('пресеты таймера', () => {
  it('встроенные по умолчанию: 25/5/30×4, 45/10/30×4, 60/10/30×3, 90/20/30×2', () => {
    const list = storage.timerPresets.list().map((p) => [p.focusMin, p.shortBreakMin, p.longBreakMin, p.cyclesBeforeLong]);
    expect(list).toEqual([[25, 5, 30, 4], [45, 10, 30, 4], [60, 10, 30, 3], [90, 20, 30, 2]]);
  });

  it('свой пресет создаётся, редактируется и удаляется', () => {
    expect(saveTimerPreset(storage, mine)).toEqual(mine);
    saveTimerPreset(storage, { ...mine, focusMin: 480, name: 'Марафон' });
    expect(storage.timerPresets.get('mine')).toMatchObject({ focusMin: 480, name: 'Марафон', builtin: false });
    expect(deleteTimerPreset(storage, 'mine')).toBe(true);
    expect(storage.timerPresets.get('mine')).toBeNull();
  });

  it('длительность вне 1–480 мин или дробная не сохраняется', () => {
    for (const bad of [
      { ...mine, focusMin: 0 },
      { ...mine, focusMin: 481 },
      { ...mine, shortBreakMin: 2.5 },
      { ...mine, longBreakMin: -1 },
      { ...mine, cyclesBeforeLong: 0 },
      { ...mine, name: '' },
      { ...mine, extra: 1 },
    ]) {
      expect(() => saveTimerPreset(storage, bad), JSON.stringify(bad)).toThrow();
    }
    expect(storage.timerPresets.get('mine')).toBeNull();
  });

  it('встроенный пресет можно изменить, но нельзя удалить или «разжаловать»', () => {
    const classic = storage.timerPresets.get('classic')!;
    saveTimerPreset(storage, { ...classic, focusMin: 30, builtin: false });
    expect(storage.timerPresets.get('classic')).toMatchObject({ focusMin: 30, builtin: true });
    expect(deleteTimerPreset(storage, 'classic')).toBe(false);
    expect(storage.timerPresets.get('classic')).not.toBeNull();
  });

  it('новый пресет не может назваться встроенным', () => {
    saveTimerPreset(storage, { ...mine, builtin: true });
    expect(storage.timerPresets.get('mine')?.builtin).toBe(false);
    expect(deleteTimerPreset(storage, 'mine')).toBe(true);
  });
});
