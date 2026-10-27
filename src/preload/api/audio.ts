import { IPC } from '../../shared/ipc';
import type { AudioStatus, SoundAvailability, SoundDef, SoundPreset, TrackState } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const audio = {
  status: () => invoke<AudioStatus>(IPC.audio.status),
  library: () => invoke<(SoundDef & SoundAvailability)[]>(IPC.audio.library),
  play: (presetIdOrTracks: string | TrackState[]) => invoke<AudioStatus>(IPC.audio.play, presetIdOrTracks),
  stop: () => invoke<AudioStatus>(IPC.audio.stop),
  setTrack: (soundId: string, patch: { enabled?: boolean; volume?: number }) =>
    invoke<AudioStatus>(IPC.audio.setTrack, soundId, patch),
  setMaster: (volume: number) => invoke<AudioStatus>(IPC.audio.setMaster, volume),
  toggleMute: () => invoke<AudioStatus>(IPC.audio.toggleMute),
  presets: () => invoke<SoundPreset[]>(IPC.audio.presets),
  /** builtin задаёт main: свой пресет всегда false; id встроенного — отказ */
  /** builtin задаёт main (свой — всегда false); id встроенного пресета — отказ. */
  savePreset: (p: SoundPreset) => invoke<SoundPreset>(IPC.audio.savePreset, p),
  deletePreset: (id: string) => invoke<boolean>(IPC.audio.deletePreset, id),
  /** Диалог выбора файла: без id — новый звук в «Свои»; с id звука библиотеки — файл для него. null — отмена. */
  addCustomSound: (soundId?: string) =>
    invoke<SoundDef | null>(IPC.audio.addCustomSound, ...(soundId === undefined ? [] : [soundId])),
  onStatus: (cb: (s: AudioStatus) => void) => subscribe(IPC.audio.statusChanged, cb),
};
