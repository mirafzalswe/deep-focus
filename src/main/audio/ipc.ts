// ЗАГЛУШКА Т01 → заполняет Т05 (AudioController, скрытое окно audio, протокол df-sound://).
import { SOUND_LIBRARY } from '../../shared/defaults';
import { IPC } from '../../shared/ipc';
import type { AudioStatus, SoundAvailability, SoundDef, SoundPreset, TrackState } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isSoundPreset } from '../settings/schema';
import { v } from '../validate';

const isTracks = v.array(v.object({ soundId: v.id(), enabled: v.bool(), volume: v.num(0, 1) }), { max: 100 });

export function registerAudio(ctx: MainContext): void {
  const { storage } = ctx;
  const status = (): AudioStatus => ({
    playing: false,
    presetId: null,
    tracks: [],
    masterVolume: ctx.settings.get().sound.masterVolume,
    muted: false,
    missing: [],
    error: null,
  });
  const library = (): (SoundDef & SoundAvailability)[] =>
    SOUND_LIBRARY.map((s) => ({ ...s, available: s.source.type === 'generated', path: null }));

  handle<[]>(IPC.audio.status, [], status);
  handle<[]>(IPC.audio.library, [], library);
  handle<[string | TrackState[]]>(IPC.audio.play, [(x) => v.id()(x) || isTracks(x)], status);
  handle<[]>(IPC.audio.stop, [], status);
  handle<[string, { enabled?: boolean; volume?: number }]>(
    IPC.audio.setTrack,
    [v.id(), v.object({ enabled: v.optional(v.bool()), volume: v.optional(v.num(0, 1)) })],
    status,
  );
  handle<[number]>(IPC.audio.setMaster, [v.num(0, 1)], status);
  handle<[]>(IPC.audio.toggleMute, [], status);
  handle<[]>(IPC.audio.presets, [], () => storage.soundPresets.list());
  handle<[SoundPreset]>(IPC.audio.savePreset, [isSoundPreset], (p) => {
    storage.soundPresets.upsert(p);
    return p;
  });
  handle<[string]>(IPC.audio.deletePreset, [v.id()], (id) => {
    if (storage.soundPresets.get(id)?.builtin) return false;
    storage.soundPresets.remove(id);
    return true;
  });
  handle<[]>(IPC.audio.addCustomSound, [], () => null);
}
