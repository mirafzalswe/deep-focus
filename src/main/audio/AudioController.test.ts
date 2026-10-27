// AudioController (§5): микшер, доступность файлов, команды движку и реакция на события таймера.
// Движок — фейковый порт, таймер — настоящий TimerEngine на фиктивных часах.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings, AudioEngineCommand, AudioStatus } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { storageTimerStore, TimerEngine } from '../timer';
import { AudioController } from './AudioController';
import { SoundLibrary, soundUrl } from './library';

type Apply = Extract<AudioEngineCommand, { type: 'apply' }>;
type Probe = Extract<AudioEngineCommand, { type: 'probe' }>;

let dir: string;
let roots: { user: string; bundled: string };
let storage: Storage;
let sound: AppSettings['sound'];
let sent: AudioEngineCommand[];
let statuses: AudioStatus[];
let audio: AudioController;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-audio-'));
  roots = { user: join(dir, 'user'), bundled: join(dir, 'bundled') };
  mkdirSync(roots.bundled, { recursive: true });
  writeFileSync(join(roots.bundled, 'rain.mp3'), 'mp3');
  storage = openStorage(':memory:');
  sound = { ...DEFAULT_SETTINGS.sound };
  sent = [];
  statuses = [];
  audio = new AudioController({
    engine: { send: (cmd) => sent.push(cmd) },
    library: new SoundLibrary(storage, roots),
    presets: { get: (id) => storage.soundPresets.get(id) },
    settings: { get: () => sound, patch: (p) => (sound = { ...sound, ...p }) },
    probeTimeoutMs: 1000,
  });
  audio.on('status', (s) => statuses.push(s));
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const applies = () => sent.filter((c): c is Apply => c.type === 'apply');
const last = (): Apply => applies().at(-1)!;
const gainOf = (id: string) => last().tracks.find((t) => t.soundId === id)?.gain;

describe('микшер', () => {
  it('пресет: дорожки с громкостями, генератор без файла, файл по df-sound://, мастер = общая × уровень пресета', () => {
    const s = audio.play('rain-focus');
    expect(s).toMatchObject({ playing: true, presetId: 'rain-focus', missing: [], muted: false, masterVolume: 0.8 });
    expect(last()).toMatchObject({ playing: true, masterGain: 0.8 * 0.8 });
    expect(last().tracks).toEqual([
      { soundId: 'rain', source: { type: 'url', url: soundUrl('rain') }, gain: 0.7 },
      { soundId: 'brown-noise', source: { type: 'generated', generator: 'brown' }, gain: 0.15 },
    ]);
    expect(statuses.at(-1)).toEqual(s);
  });

  it('отсутствующие файлы — в missing и не уходят в движок, остальное играет', () => {
    audio.play('forest');
    expect(audio.status().missing).toEqual(['forest', 'birds', 'stream']);
    expect(last().tracks).toEqual([]);
    audio.setTrack('white-noise', { enabled: true, volume: 0.3 });
    expect(last().tracks.map((t) => t.soundId)).toEqual(['white-noise']);
  });

  it('независимые громкость и включатель дорожки; выключенная остаётся в составе', () => {
    audio.play('rain-focus');
    audio.setTrack('rain', { volume: 0.25 });
    expect(gainOf('rain')).toBe(0.25);
    expect(gainOf('brown-noise')).toBe(0.15);
    audio.setTrack('brown-noise', { enabled: false });
    expect(last().tracks.map((t) => t.soundId)).toEqual(['rain']);
    expect(audio.status().tracks).toContainEqual({ soundId: 'brown-noise', enabled: false, volume: 0.15 });
    audio.setTrack('pink-noise', { enabled: true });
    expect(last().tracks.map((t) => t.soundId)).toEqual(['rain', 'pink-noise']);
  });

  it('включение дорожки в тишине запускает воспроизведение', () => {
    audio.setTrack('white-noise', { enabled: true, volume: 0.4 });
    expect(audio.status()).toMatchObject({ playing: true, presetId: null });
    expect(last()).toMatchObject({ playing: true, masterGain: 0.8, tracks: [{ soundId: 'white-noise', gain: 0.4 }] });
  });

  it('общая громкость сохраняется в настройках; mute — мастер 0, повтор — возврат', () => {
    audio.play('brown-noise');
    audio.setMaster(0.5);
    expect(sound.masterVolume).toBe(0.5);
    expect(last().masterGain).toBeCloseTo(0.5 * 0.8);
    expect(audio.toggleMute().muted).toBe(true);
    expect(last().masterGain).toBe(0);
    expect(audio.toggleMute().muted).toBe(false);
    expect(last().masterGain).toBeCloseTo(0.4);
  });

  it('остановка — затухание fadeOutMs; без fade — сразу', () => {
    sound.fadeOutMs = 2500;
    audio.play('brown-noise');
    expect(audio.stop({ fade: true }).playing).toBe(false);
    expect(last()).toMatchObject({ playing: false, fadeMs: 2500 });
    audio.play('brown-noise');
    audio.stop({ fade: false });
    expect(last()).toMatchObject({ playing: false, fadeMs: 0 });
  });

  it('свой список дорожек вместо пресета', () => {
    audio.play([{ soundId: 'pink-noise', enabled: true, volume: 0.6 }]);
    expect(audio.status()).toMatchObject({ playing: true, presetId: null });
    expect(last()).toMatchObject({ masterGain: 0.8, tracks: [{ soundId: 'pink-noise', gain: 0.6 }] });
  });

  it('неизвестный пресет — ошибка, состояние не меняется', () => {
    expect(() => audio.play('nope')).toThrow();
    expect(audio.status().playing).toBe(false);
  });
});

describe('доступность (§5.12)', () => {
  it('нет файла → available=false, path=null; файл есть → true; генератор → true', () => {
    const byId = Object.fromEntries(audio.availability().map((a) => [a.id, a]));
    expect(byId.waves).toEqual({ id: 'waves', available: false, path: null });
    expect(byId.rain).toEqual({ id: 'rain', available: true, path: join(roots.bundled, 'rain.mp3') });
    expect(byId['brown-noise']).toEqual({ id: 'brown-noise', available: true, path: null });
  });

  it('движок не смог декодировать → «повреждён» (available=false, path есть), дорожка снята, остальные играют', () => {
    audio.play('rain-focus');
    audio.handleEngineReport({ type: 'trackFailed', soundId: 'rain', reason: 'corrupt' });
    expect(audio.availability().find((a) => a.id === 'rain')).toEqual({
      id: 'rain',
      available: false,
      path: join(roots.bundled, 'rain.mp3'),
    });
    expect(audio.status()).toMatchObject({ playing: true, missing: ['rain'] });
    expect(last().tracks.map((t) => t.soundId)).toEqual(['brown-noise']);
  });

  it('проверка декодирования: файлы уходят движку один раз, результат помечает повреждённые', async () => {
    writeFileSync(join(roots.bundled, 'waves.mp3'), 'broken');
    const pending = audio.verify();
    const probe = sent.find((c): c is Probe => c.type === 'probe')!;
    expect(probe.items).toEqual([
      { soundId: 'rain', url: soundUrl('rain') },
      { soundId: 'waves', url: soundUrl('waves') },
    ]);
    audio.handleEngineReport({
      type: 'probeResult',
      requestId: probe.requestId,
      results: [
        { soundId: 'rain', ok: true },
        { soundId: 'waves', ok: false },
      ],
    });
    await pending;
    expect(audio.availability().filter((a) => !a.available && a.path).map((a) => a.id)).toEqual(['waves']);
    sent = [];
    await audio.verify();
    expect(sent).toEqual([]);
  });

  it('без файлов для проверки движок не поднимается', async () => {
    rmSync(join(roots.bundled, 'rain.mp3'));
    await audio.verify();
    expect(sent).toEqual([]);
  });
});

describe('реакция на таймер (§5.8–5.10)', () => {
  const MIN = 60_000;
  let timer: TimerEngine;
  let timerSettings: AppSettings['timer'];

  beforeEach(() => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 27, 9) });
    timerSettings = { ...DEFAULT_SETTINGS.timer };
    timer = new TimerEngine({ clock: { now: () => Date.now() }, store: storageTimerStore(storage), settings: () => timerSettings });
    timer.recover(Date.now());
    audio.bindTimer(timer);
    sound = { ...sound, autoStartOnSession: true, workPresetId: 'brown-noise', breakPresetId: 'forest' };
  });
  afterEach(() => {
    timer.dispose();
    vi.useRealTimers();
  });

  const focus = () => timer.command({ type: 'start', mode: 'pomodoro' });

  it('старт Focus включает рабочий профиль, если включено autoStartOnSession', () => {
    focus();
    expect(audio.status()).toMatchObject({ playing: true, presetId: 'brown-noise' });
  });

  it('autoStartOnSession выключено — старт сессии звук не включает', () => {
    sound.autoStartOnSession = false;
    focus();
    expect(audio.status().playing).toBe(false);
    expect(applies()).toEqual([]);
  });

  it('перерыв: stop — затухание, следующий Focus снова включает рабочий профиль', () => {
    sound.breakBehavior = 'stop';
    focus();
    timer.switchKind('shortBreak');
    expect(audio.status().playing).toBe(false);
    expect(last()).toMatchObject({ playing: false, fadeMs: 1500 });
    timer.switchKind('focus');
    expect(audio.status()).toMatchObject({ playing: true, presetId: 'brown-noise' });
  });

  it('перерыв: continue — играет как было', () => {
    sound.breakBehavior = 'continue';
    focus();
    const before = last();
    timer.switchKind('shortBreak');
    expect(audio.status()).toMatchObject({ playing: true, presetId: 'brown-noise' });
    expect(last()).toEqual(before);
  });

  it('перерыв: switch — профиль отдыха, затем обратно рабочий', () => {
    sound.breakBehavior = 'switch';
    focus();
    timer.switchKind('longBreak');
    expect(audio.status()).toMatchObject({ playing: true, presetId: 'forest' });
    timer.switchKind('focus');
    expect(audio.status().presetId).toBe('brown-noise');
  });

  it('перерыв: lower — мастер × lowerFactor при естественном конце Focus (autoSwitch), Focus возвращает громкость', () => {
    sound.breakBehavior = 'lower';
    sound.lowerFactor = 0.4;
    timerSettings.autoSwitch = true;
    focus();
    expect(last().masterGain).toBeCloseTo(0.8 * 0.8);
    vi.advanceTimersByTime(25 * MIN + 1000);
    expect(timer.snapshot()).toMatchObject({ status: 'running', kind: 'shortBreak' });
    expect(last().masterGain).toBeCloseTo(0.8 * 0.8 * 0.4);
    expect(audio.status().playing).toBe(true);
    timer.switchKind('focus');
    expect(last().masterGain).toBeCloseTo(0.8 * 0.8);
  });

  it('остановка сессии гасит включённый ею звук затуханием', () => {
    focus();
    timer.stop();
    expect(audio.status().playing).toBe(false);
    expect(last()).toMatchObject({ playing: false, fadeMs: 1500 });
  });

  it('звук, включённый вручную, остановка сессии не трогает', () => {
    sound.autoStartOnSession = false;
    audio.play('rain-focus');
    focus();
    timer.stop();
    expect(audio.status()).toMatchObject({ playing: true, presetId: 'rain-focus' });
  });
});
