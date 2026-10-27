// Пресеты таймера в базе: встроенные (можно менять значения, нельзя удалить) и свои (полный CRUD).
// Длительность 1–480 мин проверяет isTimerPreset; неверный пресет не сохраняется.
import type { TimerPreset } from '../../shared/types';
import type { Storage } from '../db';
import { isTimerPreset } from '../settings/schema';
import { assertValid } from '../validate';

export function saveTimerPreset(storage: Storage, input: unknown): TimerPreset {
  assertValid(isTimerPreset, input, 'timerPreset');
  const preset = input as TimerPreset;
  // Признак «встроенный» задаёт только база: свой пресет не станет неудаляемым, встроенный — удаляемым.
  const builtin = storage.timerPresets.get(preset.id)?.builtin ?? false;
  const saved: TimerPreset = { ...preset, builtin };
  storage.timerPresets.upsert(saved);
  return saved;
}

/** false — пресета нет или он встроенный. */
export function deleteTimerPreset(storage: Storage, id: string): boolean {
  const existing = storage.timerPresets.get(id);
  if (!existing || existing.builtin) return false;
  storage.timerPresets.remove(id);
  return true;
}
