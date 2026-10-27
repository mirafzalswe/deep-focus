// Что делают горячие клавиши «старт/пауза» и «звук вкл/выкл» в зависимости от состояния. Чистые функции.
import type { AudioStatus, TimerCommand, TimerSnapshot, TrackState } from '../../shared/types';

/** Пресет, если рабочий не выбран (как в разделе Sounds). */
const FALLBACK_SOUND_PRESET = 'rain-focus';

/** Та же основная кнопка, что на Home: старт / пауза / продолжить / следующий интервал / продлить. */
export function startPauseCommand(snap: TimerSnapshot, freeExtendMin: number): TimerCommand {
  switch (snap.status) {
    case 'running':
      return { type: 'pause' };
    case 'paused':
      return { type: 'resume' };
    case 'awaiting':
      return snap.mode === 'free' ? { type: 'extend', min: freeExtendMin } : { type: 'start', mode: 'pomodoro' };
    default:
      return { type: 'start', mode: snap.mode };
  }
}

export type SoundToggle = { type: 'stop' } | { type: 'play'; target: string | TrackState[] };

/** Играет — выключить; тишина — включить последнее звучавшее (пресет или свой набор), иначе рабочий пресет. */
export function soundToggle(status: AudioStatus, workPresetId: string | null): SoundToggle {
  if (status.playing) return { type: 'stop' };
  if (status.presetId) return { type: 'play', target: status.presetId };
  if (status.tracks.some((t) => t.enabled)) return { type: 'play', target: status.tracks };
  return { type: 'play', target: workPresetId ?? FALLBACK_SOUND_PRESET };
}
