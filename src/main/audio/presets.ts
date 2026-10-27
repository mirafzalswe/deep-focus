// Пресеты звука в базе (§5.7). Встроенные (Rain Focus … Silent Focus) засевает миграция и их нельзя
// перезаписать или удалить; признак builtin задаёт только main — от renderer он всегда false.
import { BUILTIN_SOUND_PRESETS } from '../../shared/defaults';
import type { SoundPreset } from '../../shared/types';
import type { Storage } from '../db';
import { isSoundPreset } from '../settings/schema';
import { assertValid, ValidationError } from '../validate';

const isBuiltinId = (storage: Storage, id: string) =>
  BUILTIN_SOUND_PRESETS.some((p) => p.id === id) || storage.soundPresets.get(id)?.builtin === true;

export function saveSoundPreset(storage: Storage, input: unknown): SoundPreset {
  assertValid(isSoundPreset, input, 'soundPreset');
  const preset = input as SoundPreset;
  if (isBuiltinId(storage, preset.id)) throw new ValidationError('soundPreset.id (builtin)');
  const saved: SoundPreset = { ...preset, builtin: false };
  storage.soundPresets.upsert(saved);
  return saved;
}

/** false — пресета нет или он встроенный. */
export function deleteSoundPreset(storage: Storage, id: string): boolean {
  const existing = storage.soundPresets.get(id);
  if (!existing || isBuiltinId(storage, id)) return false;
  storage.soundPresets.remove(id);
  return true;
}
