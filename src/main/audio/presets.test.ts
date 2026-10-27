// Пресеты звука (§5.7): встроенные неизменяемы, свои — сохранить, переименовать, удалить.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage, type Storage } from '../db';
import { deleteSoundPreset, saveSoundPreset } from './presets';

let storage: Storage;
beforeEach(() => {
  storage = openStorage(':memory:');
});
afterEach(() => storage.close());

const mine = { id: 'my-mix', name: 'Мой микс', builtin: false, masterVolume: 1, tracks: [{ soundId: 'rain', enabled: true, volume: 0.5 }] };

describe('встроенные пресеты', () => {
  it('Rain Focus, Ocean Focus, Forest, Brown Noise, Coffee Shop, Silent Focus есть в базе; Silent — без дорожек', () => {
    const builtin = storage.soundPresets.list().filter((p) => p.builtin);
    expect(builtin.map((p) => p.name)).toEqual(['Rain Focus', 'Ocean Focus', 'Forest', 'Brown Noise', 'Coffee Shop', 'Silent Focus']);
    expect(builtin.find((p) => p.name === 'Silent Focus')?.tracks).toEqual([]);
  });

  it('сохранение с id встроенного отклоняется, встроенный не меняется', () => {
    expect(() => saveSoundPreset(storage, { ...mine, id: 'rain-focus', name: 'Подмена' })).toThrow();
    expect(storage.soundPresets.get('rain-focus')?.name).toBe('Rain Focus');
  });

  it('встроенный не удаляется', () => {
    expect(deleteSoundPreset(storage, 'forest')).toBe(false);
    expect(storage.soundPresets.get('forest')).not.toBeNull();
  });
});

describe('свои пресеты', () => {
  it('builtin от renderer игнорируется: сохраняется false и пресет удаляем', () => {
    const saved = saveSoundPreset(storage, { ...mine, builtin: true });
    expect(saved.builtin).toBe(false);
    expect(storage.soundPresets.get('my-mix')?.builtin).toBe(false);
    expect(deleteSoundPreset(storage, 'my-mix')).toBe(true);
    expect(storage.soundPresets.get('my-mix')).toBeNull();
  });

  it('переименование — сохранение с тем же id', () => {
    saveSoundPreset(storage, mine);
    saveSoundPreset(storage, { ...mine, name: 'Дождь и тишина' });
    expect(storage.soundPresets.list().filter((p) => p.id === 'my-mix').map((p) => p.name)).toEqual(['Дождь и тишина']);
  });

  it('неверная форма отклоняется', () => {
    expect(() => saveSoundPreset(storage, { ...mine, name: '' })).toThrow();
    expect(() => saveSoundPreset(storage, { ...mine, tracks: [{ soundId: 'rain', enabled: true, volume: 2 }] })).toThrow();
  });
});
