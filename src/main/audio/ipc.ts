// Модуль audio: AudioController + скрытое окно движка + протокол df-sound:// + IPC домена audio.
import { basename, extname, join } from 'node:path';
import { dialog, type OpenDialogOptions } from 'electron';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import { IPC } from '../../shared/ipc';
import type { TrackState } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isPlainObject, v } from '../validate';
import { AudioController } from './AudioController';
import { createEngineHost, type EngineHost } from './engineHost';
import { AUDIO_EXTENSIONS, SoundLibrary } from './library';
import { deleteSoundPreset, saveSoundPreset } from './presets';
import { registerSoundProtocol } from './protocol';

declare module '../context' {
  interface Services {
    audio: AudioController;
    audioEngine: EngineHost;
  }
}

const isTracks = v.array(v.object({ soundId: v.id(), enabled: v.bool(), volume: v.num(0, 1) }), { max: 100 });
const isTrackPatch = v.object({ enabled: v.optional(v.bool()), volume: v.optional(v.num(0, 1)) });

export function registerAudio(ctx: MainContext): void {
  const { storage, settings, logger } = ctx;
  const library = new SoundLibrary(storage, {
    user: join(ctx.paths.userData, 'sounds'),
    bundled: join(ctx.paths.assets, 'sounds'),
  });
  registerSoundProtocol(library);

  let host: EngineHost | null = null;
  const audio = new AudioController({
    engine: {
      send: (cmd) => {
        if (cmd.type !== 'signal') return host?.send(cmd);
        // Сигнал необязателен: его сбой не должен мешать звуку сессии и остальным подписчикам таймера
        try {
          host?.send(cmd);
        } catch (err) {
          logger.warn('audio', `signal ${cmd.kind} failed`, err);
        }
      },
    },
    library,
    presets: { get: (id) => storage.soundPresets.get(id) },
    settings: {
      get: () => settings.get().sound,
      patch: (p) => void settings.patch({ sound: p }),
    },
  });
  host = createEngineHost({
    logger,
    current: () => audio.engineCommand(),
    onReport: (r) => {
      if (r.type === 'trackFailed') logger.warn('audio', `sound ${r.soundId} failed: ${r.reason}`);
      if (r.type === 'error') logger.error('audio', `engine: ${r.message}`);
      if (r.type === 'signalFailed') logger.warn('audio', `signal failed: ${r.message}`);
      audio.handleEngineReport(r);
    },
    onFatal: (message) => {
      logger.error('audio', 'engine window keeps crashing, sound disabled until restart');
      audio.setEngineError(message);
    },
  });
  ctx.services.audio = audio;
  ctx.services.audioEngine = host;

  audio.on('status', (s) => ctx.broadcast(IPC.audio.statusChanged, s));
  settings.on('change', (next, prev) => {
    if (JSON.stringify(next.sound) !== JSON.stringify(prev.sound)) audio.refresh();
  });
  if (ctx.services.timer) audio.bindTimer(ctx.services.timer);
  else logger.warn('audio', 'timer is unavailable: sound will not follow sessions');

  // Проверка при запуске (§5.12): какие файлы на месте. Декодирование — при открытии Sounds и при воспроизведении.
  const missing = audio.availability().filter((a) => !a.available).map((a) => a.id);
  if (missing.length > 0) logger.info('audio', `sound files not added: ${missing.join(', ')}`);

  handle<[]>(IPC.audio.status, [], () => audio.status());
  handle<[]>(IPC.audio.library, [], async () => {
    await audio.verify();
    return audio.library();
  });
  handle<[string | TrackState[]]>(IPC.audio.play, [(x) => v.id()(x) || isTracks(x)], (p) => audio.play(p));
  handle<[]>(IPC.audio.stop, [], () => audio.stop({ fade: true }));
  handle<[string, { enabled?: boolean; volume?: number }]>(IPC.audio.setTrack, [v.id(), isTrackPatch], (id, patch) =>
    audio.setTrack(id, patch),
  );
  handle<[number]>(IPC.audio.setMaster, [v.num(0, 1)], (vol) => audio.setMaster(vol));
  handle<[]>(IPC.audio.toggleMute, [], () => audio.toggleMute());
  handle<[]>(IPC.audio.previewSignal, [], () => audio.previewSignal());
  handle<[]>(IPC.audio.presets, [], () => storage.soundPresets.list());
  handle<[unknown]>(IPC.audio.savePreset, [isPlainObject], (p) => saveSoundPreset(storage, p));
  handle<[string]>(IPC.audio.deletePreset, [v.id()], (id) => {
    const removed = deleteSoundPreset(storage, id);
    if (removed) {
      const s = settings.get().sound;
      if (s.workPresetId === id) settings.patch({ sound: { workPresetId: DEFAULT_SETTINGS.sound.workPresetId } });
      if (s.breakPresetId === id) settings.patch({ sound: { breakPresetId: null } });
    }
    return removed;
  });
  // Без аргумента — новый звук в «Свои»; с id звука библиотеки — файл для него (§5.1 «или добавлю кнопкой»).
  handle<[string | undefined]>(IPC.audio.addCustomSound, [v.optional(v.id())], async (soundId) => {
    const win = ctx.mainWindow();
    const options: OpenDialogOptions = {
      title: ctx.t('sounds.addCustom'),
      properties: ['openFile'],
      filters: [{ name: ctx.t('sounds.audioFiles'), extensions: AUDIO_EXTENSIONS.map((e) => e.slice(1)) }],
    };
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options));
    const file = result.canceled ? undefined : result.filePaths[0];
    if (!file) return null;
    const def = soundId ? audio.attachFile(soundId, file) : audio.addCustomSound(file, basename(file, extname(file)));
    void audio.verify();
    return def;
  });
}
