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
  savePreset: (p: SoundPreset) => invoke<SoundPreset>(IPC.audio.savePreset, p),
  deletePreset: (id: string) => invoke<boolean>(IPC.audio.deletePreset, id),
  addCustomSound: () => invoke<SoundDef | null>(IPC.audio.addCustomSound),
  onStatus: (cb: (s: AudioStatus) => void) => subscribe(IPC.audio.statusChanged, cb),
};
