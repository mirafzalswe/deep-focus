// Звуковой движок скрытого окна audio (Web Audio). Исполняет декларативные команды main:
// apply — «вот какие дорожки и с какой громкостью должны звучать», probe — проверить, что файлы декодируются.
// Дорожка = AudioBufferSourceNode (loop) → GainNode → master GainNode → выход.
import type { AudioEngineCommand, AudioEngineReport, EngineSource } from '@shared/types';
import { fileLoop, noiseLoop } from './dsp';

type Apply = Extract<AudioEngineCommand, { type: 'apply' }>;
type Probe = Extract<AudioEngineCommand, { type: 'probe' }>;

/** Смена громкости — плавно, чтобы не было щелчков. */
const GAIN_SMOOTHING_SEC = 0.05;
const TRACK_FADE_SEC = 0.4;
const START_FADE_SEC = 0.4;
const NOISE_SECONDS = 10;

class LoadError extends Error {
  constructor(public readonly reason: 'missing' | 'corrupt') {
    super(reason);
  }
}

interface Voice {
  key: string;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  target: number;
}

/** Плавно к новому значению, отменив незавершённые нарастания (иначе они «перебьют» новое значение). */
function glide(param: AudioParam, value: number, now: number): void {
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.setTargetAtTime(value, now, GAIN_SMOOTHING_SEC);
}

const sourceKey = (s: EngineSource) => (s.type === 'url' ? s.url : `generated:${s.generator}`);

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly voices = new Map<string, Voice>();
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();
  private playing = false;
  private stopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly report: (r: AudioEngineReport) => void) {}

  handle(cmd: AudioEngineCommand): void {
    try {
      if (cmd.type === 'apply') this.apply(cmd);
      else void this.probe(cmd);
    } catch (err) {
      this.report({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Снимок для e2e-проверок (окно скрытое, наружу ничего не отдаёт). */
  debugState() {
    return {
      context: this.ctx?.state ?? 'none',
      playing: this.playing,
      master: this.master?.gain.value ?? 0,
      tracks: [...this.voices].map(([soundId, v]) => ({
        soundId,
        target: v.target,
        gain: v.gain.gain.value,
        loaded: v.source !== null,
        loop: v.source?.loop ?? false,
        duration: v.source?.buffer?.duration ?? 0,
      })),
    };
  }

  private context(): { ctx: AudioContext; master: GainNode } {
    if (!this.ctx || !this.master) {
      this.ctx = new AudioContext({ latencyHint: 'playback' });
      this.master = this.ctx.createGain();
      this.master.gain.value = 0;
      this.master.connect(this.ctx.destination);
    }
    return { ctx: this.ctx, master: this.master };
  }

  private apply(cmd: Apply): void {
    const { ctx, master } = this.context();
    const now = ctx.currentTime;
    const g = master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    if (cmd.playing) {
      if (this.stopTimer) {
        clearTimeout(this.stopTimer);
        this.stopTimer = null;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      g.linearRampToValueAtTime(cmd.masterGain, now + (this.playing ? GAIN_SMOOTHING_SEC : START_FADE_SEC));
      this.playing = true;
      this.syncTracks(cmd.tracks);
      return;
    }
    // Остановка: мастер затухает за fadeMs, затем источники останавливаются и контекст засыпает
    const fadeSec = Math.max(cmd.fadeMs / 1000, 0.02);
    g.linearRampToValueAtTime(0, now + fadeSec);
    if (!this.playing) return;
    this.playing = false;
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this.stopAll(), fadeSec * 1000 + 50);
  }

  private syncTracks(tracks: Apply['tracks']): void {
    const { ctx, master } = this.context();
    const wanted = new Map(tracks.map((t) => [t.soundId, t]));
    for (const [soundId, voice] of this.voices) {
      const t = wanted.get(soundId);
      if (!t || sourceKey(t.source) !== voice.key) this.release(soundId, voice);
    }
    for (const t of tracks) {
      const existing = this.voices.get(t.soundId);
      if (existing) {
        if (existing.source && existing.target !== t.gain) glide(existing.gain.gain, t.gain, ctx.currentTime);
        existing.target = t.gain;
        continue;
      }
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(master);
      const voice: Voice = { key: sourceKey(t.source), gain, source: null, target: t.gain };
      this.voices.set(t.soundId, voice);
      this.buffer(t.source)
        .then((buffer) => {
          if (this.voices.get(t.soundId) !== voice) return; // дорожку уже убрали
          const src = ctx.createBufferSource();
          src.buffer = buffer;
          src.loop = true;
          src.connect(gain);
          src.start();
          voice.source = src;
          const at = ctx.currentTime;
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(voice.target, at + TRACK_FADE_SEC);
        })
        .catch((err: unknown) => {
          if (this.voices.get(t.soundId) === voice) {
            this.voices.delete(t.soundId);
            gain.disconnect();
          }
          this.report({ type: 'trackFailed', soundId: t.soundId, reason: err instanceof LoadError ? err.reason : 'corrupt' });
        });
    }
  }

  private release(soundId: string, voice: Voice): void {
    this.voices.delete(soundId);
    const ctx = this.ctx;
    if (!ctx) return;
    const at = ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(at);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, at);
    voice.gain.gain.linearRampToValueAtTime(0, at + TRACK_FADE_SEC);
    setTimeout(() => {
      voice.source?.stop();
      voice.source?.disconnect();
      voice.gain.disconnect();
    }, TRACK_FADE_SEC * 1000 + 50);
  }

  private stopAll(): void {
    this.stopTimer = null;
    for (const voice of this.voices.values()) {
      voice.source?.stop();
      voice.source?.disconnect();
      voice.gain.disconnect();
    }
    this.voices.clear();
    // Декодированные файлы большие — не держим их в тишине; шумы дешёвые, оставляем
    for (const key of [...this.buffers.keys()]) if (!key.startsWith('generated:')) this.buffers.delete(key);
    void this.ctx?.suspend();
  }

  private buffer(source: EngineSource): Promise<AudioBuffer> {
    const key = sourceKey(source);
    let p = this.buffers.get(key);
    if (!p) {
      p = source.type === 'generated' ? Promise.resolve(this.noiseBuffer(source.generator)) : this.fileBuffer(source.url);
      this.buffers.set(key, p);
      p.catch(() => this.buffers.delete(key)); // исправленный файл пробуем заново
    }
    return p;
  }

  private noiseBuffer(kind: 'white' | 'pink' | 'brown'): AudioBuffer {
    const { ctx } = this.context();
    const left = noiseLoop(kind, ctx.sampleRate, NOISE_SECONDS);
    const right = noiseLoop(kind, ctx.sampleRate, NOISE_SECONDS);
    const buffer = ctx.createBuffer(2, left.length, ctx.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    return buffer;
  }

  private async decode(url: string): Promise<AudioBuffer> {
    const { ctx } = this.context();
    let data: ArrayBuffer;
    try {
      // df-sound:// обслуживает main из двух локальных папок — это не сетевой запрос
      // eslint-disable-next-line no-restricted-globals
      const res = await fetch(url);
      if (!res.ok) throw new LoadError('missing');
      data = await res.arrayBuffer();
    } catch (err) {
      throw err instanceof LoadError ? err : new LoadError('missing');
    }
    try {
      return await ctx.decodeAudioData(data);
    } catch {
      throw new LoadError('corrupt');
    }
  }

  private async fileBuffer(url: string): Promise<AudioBuffer> {
    const { ctx } = this.context();
    const decoded = await this.decode(url);
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const loops = fileLoop(channels, decoded.sampleRate);
    const length = loops[0]?.length ?? 0;
    if (length === 0) throw new LoadError('corrupt'); // одна тишина — играть нечего
    const buffer = ctx.createBuffer(loops.length, length, decoded.sampleRate);
    loops.forEach((ch, i) => buffer.copyToChannel(ch, i));
    return buffer;
  }

  /** Проверка декодирования по одному файлу за раз — без пиков памяти. */
  private async probe(cmd: Probe): Promise<void> {
    const results: { soundId: string; ok: boolean }[] = [];
    for (const item of cmd.items) {
      try {
        await this.decode(item.url);
        results.push({ soundId: item.soundId, ok: true });
      } catch {
        results.push({ soundId: item.soundId, ok: false });
      }
    }
    this.report({ type: 'probeResult', requestId: cmd.requestId, results });
  }
}
