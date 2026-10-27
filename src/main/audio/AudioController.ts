// AudioController (§5): единственный источник правды о звуке. Держит состав микса, общую громкость,
// mute и приглушение на перерыве; движку (скрытое окно audio) шлёт декларативную команду apply —
// «вот что должно звучать». Сам Web Audio и декодирование — в renderer/audio. Без Electron — тестируется Vitest.
import type {
  AppSettings,
  AudioEngineCommand,
  AudioEngineReport,
  AudioStatus,
  SoundAvailability,
  SoundDef,
  SoundPreset,
  TimerSnapshot,
  TimerStatus,
  TrackState,
  Unsubscribe,
} from '../../shared/types';
import { TypedEmitter } from '../events';
import { soundUrl, type ResolvedSound, type SoundLibrary } from './library';

export interface EnginePort {
  send(cmd: AudioEngineCommand): void;
}

export interface TimerEventsSource {
  on(event: 'sessionStarted' | 'state', listener: (snap: TimerSnapshot) => void): Unsubscribe;
}

export interface AudioControllerDeps {
  engine: EnginePort;
  library: Pick<SoundLibrary, 'defs' | 'get' | 'resolve' | 'addCustom' | 'attachFile'>;
  presets: { get(id: string): SoundPreset | null | undefined };
  settings: { get(): AppSettings['sound']; patch(p: Partial<AppSettings['sound']>): void };
  /** сколько ждать ответа движка на проверку файлов, мс */
  probeTimeoutMs?: number;
}

export interface AudioEvents {
  status: (s: AudioStatus) => void;
}

interface Mix {
  tracks: TrackState[];
  presetId: string | null;
  presetLevel: number;
  playing: boolean;
}

type ProbeResults = Extract<AudioEngineReport, { type: 'probeResult' }>['results'];

export class AudioController extends TypedEmitter<AudioEvents> {
  private mix: Mix = { tracks: [], presetId: null, presetLevel: 1, playing: false };
  private muted = false;
  /** перерыв с breakBehavior = lower */
  private lowered = false;
  /** звук включила сессия (autoStartOnSession) — её остановка его и гасит */
  private autoStarted = false;
  /** что играло до перерыва (stop/switch) — вернуть к следующему Focus */
  private beforeBreak: Mix | null = null;
  private error: string | null = null;
  private readonly corrupt = new Set<string>();
  private readonly verified = new Set<string>();
  private readonly probes = new Map<number, (results: ProbeResults | null) => void>();
  private nextProbeId = 1;
  private verifying: Promise<void> | null = null;

  constructor(private readonly deps: AudioControllerDeps) {
    super();
  }

  // ── Команды ────────────────────────────────────────────────────────────

  /** Пресет по id или свой набор дорожек. Неизвестный пресет — ошибка. */
  play(presetOrTracks: string | TrackState[]): AudioStatus {
    if (typeof presetOrTracks === 'string') this.load(this.preset(presetOrTracks));
    else this.mix = { tracks: presetOrTracks.map((t) => ({ ...t })), presetId: null, presetLevel: 1, playing: true };
    this.mix.playing = true;
    this.resetSessionEffects();
    return this.push();
  }

  /** Остановка; по умолчанию — затуханием fadeOutMs. */
  stop(opts: { fade?: boolean } = {}): AudioStatus {
    this.mix.playing = false;
    this.resetSessionEffects();
    return this.push(opts.fade === false ? 0 : this.deps.settings.get().fadeOutMs);
  }

  /** Громкость и включатель дорожки; новая дорожка добавляется в микс, включение в тишине запускает звук. */
  setTrack(soundId: string, patch: { enabled?: boolean; volume?: number }): AudioStatus {
    if (!this.deps.library.get(soundId)) throw new Error(`Unknown sound: ${soundId}`);
    const existing = this.mix.tracks.find((t) => t.soundId === soundId);
    if (existing) Object.assign(existing, stripUndefined(patch));
    else this.mix.tracks.push({ soundId, enabled: patch.enabled ?? false, volume: patch.volume ?? 0.5 });
    if (patch.enabled === true && !this.mix.playing) {
      this.mix.playing = true;
      this.resetSessionEffects();
    }
    return this.push();
  }

  /** Общая громкость (хранится в настройках). */
  setMaster(volume: number): AudioStatus {
    this.deps.settings.patch({ masterVolume: volume });
    return this.push();
  }

  toggleMute(): AudioStatus {
    this.muted = !this.muted;
    return this.push();
  }

  /** Перерыв начался: stop / continue / switch / lower по настройке (§5.10). */
  applyBreakBehavior(): AudioStatus {
    const s = this.deps.settings.get();
    if (!this.mix.playing) return this.status();
    switch (s.breakBehavior) {
      case 'continue':
        return this.status();
      case 'stop':
        this.beforeBreak = this.beforeBreak ?? cloneMix(this.mix);
        this.mix.playing = false;
        this.lowered = false;
        return this.push(s.fadeOutMs);
      case 'switch': {
        const rest = s.breakPresetId ? this.deps.presets.get(s.breakPresetId) : null;
        if (!rest) return this.status();
        this.beforeBreak = this.beforeBreak ?? cloneMix(this.mix);
        this.load(rest);
        this.mix.playing = true;
        this.lowered = false;
        return this.push();
      }
      case 'lower':
        this.lowered = true;
        return this.push();
    }
  }

  /** Перерыв кончился / начался Focus: рабочий профиль (autoStartOnSession) или то, что играло до перерыва. */
  applyFocusBehavior(): AudioStatus {
    const s = this.deps.settings.get();
    const wasLowered = this.lowered;
    this.lowered = false;
    const work = s.autoStartOnSession && s.workPresetId ? this.deps.presets.get(s.workPresetId) : null;
    if (!work && !this.beforeBreak && !wasLowered) return this.status();
    if (work) {
      // уже играет этот профиль — правки дорожек пользователя не сбрасываем
      if (!(this.mix.playing && this.mix.presetId === work.id)) this.load(work);
      this.mix.playing = true;
      this.autoStarted = true;
      this.beforeBreak = null;
    } else if (this.beforeBreak) {
      this.mix = this.beforeBreak;
      this.beforeBreak = null;
    }
    return this.push();
  }

  /** Сессия остановлена (таймер → idle): звук сессии гаснет затуханием, ручной возвращается как был. */
  private onSessionStopped(): void {
    if (this.autoStarted) {
      this.stop({ fade: true });
      return;
    }
    if (!this.lowered && !this.beforeBreak) return;
    if (this.beforeBreak && this.mix.playing) this.mix = this.beforeBreak;
    this.beforeBreak = null;
    this.lowered = false;
    this.push();
  }

  /** Подписка на TimerEngine: sessionStarted (Focus / перерыв) и state (остановка сессии). */
  bindTimer(timer: TimerEventsSource): Unsubscribe {
    let last: TimerStatus = 'idle';
    const offs = [
      timer.on('sessionStarted', (snap) => {
        if (snap.kind === 'focus') this.applyFocusBehavior();
        else this.applyBreakBehavior();
      }),
      timer.on('state', (snap) => {
        if (snap.status === 'idle' && last !== 'idle') this.onSessionStopped();
        last = snap.status;
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  /** Настройки звука изменились извне (вкладка Settings, импорт) — переслать движку. */
  refresh(): AudioStatus {
    return this.push();
  }

  // ── Библиотека и доступность ──────────────────────────────────────────

  availability(): SoundAvailability[] {
    return this.deps.library.defs().map((d) => this.availabilityOf(d));
  }

  library(): (SoundDef & SoundAvailability)[] {
    return this.deps.library.defs().map((d) => ({ ...d, ...this.availabilityOf(d) }));
  }

  addCustomSound(filePath: string, name: string): SoundDef {
    const def = this.deps.library.addCustom(filePath, name);
    this.emitStatus();
    return def;
  }

  /** Файл для звука библиотеки (userData/sounds/<id>.<ext>); если дорожка в миксе — сразу зазвучит. */
  attachFile(soundId: string, filePath: string): SoundDef {
    const def = this.deps.library.attachFile(soundId, filePath);
    this.push();
    return def;
  }

  /**
   * Проверка декодирования файлов движком (§5.12). Каждый файл (путь+размер+время) проверяется один раз;
   * нет файлов для проверки — движок не поднимается.
   */
  verify(): Promise<void> {
    this.verifying ??= this.runVerify().finally(() => (this.verifying = null));
    return this.verifying;
  }

  private async runVerify(): Promise<void> {
    const items: { soundId: string; url: string; stamp: string }[] = [];
    for (const def of this.deps.library.defs()) {
      const r = def.source.type === 'file' ? this.deps.library.resolve(def.id) : null;
      if (r && !this.verified.has(r.stamp) && !this.corrupt.has(r.stamp))
        items.push({ soundId: def.id, url: soundUrl(def.id), stamp: r.stamp });
    }
    if (items.length === 0) return;
    const requestId = this.nextProbeId++;
    const results = await new Promise<ProbeResults | null>((resolve) => {
      const timer = setTimeout(() => {
        this.probes.delete(requestId);
        resolve(null);
      }, this.deps.probeTimeoutMs ?? 10_000);
      this.probes.set(requestId, (r) => {
        clearTimeout(timer);
        this.probes.delete(requestId);
        resolve(r);
      });
      this.deps.engine.send({ type: 'probe', requestId, items: items.map(({ soundId, url }) => ({ soundId, url })) });
    });
    if (!results) return;
    let changed = false;
    for (const { soundId, ok } of results) {
      const item = items.find((i) => i.soundId === soundId);
      if (!item) continue;
      if (ok) this.verified.add(item.stamp);
      else {
        this.corrupt.add(item.stamp);
        changed = true;
      }
    }
    if (changed) this.push();
  }

  /** Ответ движка; отправитель уже проверен вызывающим. */
  handleEngineReport(report: AudioEngineReport): void {
    switch (report.type) {
      case 'ready':
        if (this.error) {
          this.error = null;
          this.emitStatus();
        }
        return;
      case 'trackFailed': {
        const r = this.deps.library.resolve(report.soundId);
        if (report.reason === 'corrupt' && r) this.corrupt.add(r.stamp);
        this.push();
        return;
      }
      case 'probeResult':
        this.probes.get(report.requestId)?.(report.results);
        return;
      case 'error':
        this.error = report.message;
        this.emitStatus();
        return;
    }
  }

  /** Окно движка не поднялось или падает снова и снова. */
  setEngineError(message: string | null): void {
    this.error = message;
    this.emitStatus();
  }

  status(): AudioStatus {
    return {
      playing: this.mix.playing,
      presetId: this.mix.presetId,
      tracks: this.mix.tracks.map((t) => ({ ...t })),
      masterVolume: this.deps.settings.get().masterVolume,
      muted: this.muted,
      missing: this.mix.tracks.filter((t) => t.enabled && !this.playable(t.soundId)).map((t) => t.soundId),
      error: this.error,
    };
  }

  /** Последняя команда apply — для повторной отправки пересозданному окну движка. */
  engineCommand(fadeMs = 0): AudioEngineCommand {
    const s = this.deps.settings.get();
    const level = this.muted ? 0 : s.masterVolume * this.mix.presetLevel * (this.lowered ? s.lowerFactor : 1);
    const tracks: Extract<AudioEngineCommand, { type: 'apply' }>['tracks'] = [];
    for (const t of this.mix.tracks) {
      const def = this.deps.library.get(t.soundId);
      if (!t.enabled || !def || !this.playable(t.soundId)) continue;
      const source =
        def.source.type === 'generated'
          ? { type: 'generated' as const, generator: def.source.generator }
          : { type: 'url' as const, url: soundUrl(def.id) };
      tracks.push({ soundId: t.soundId, source, gain: t.volume });
    }
    return { type: 'apply', playing: this.mix.playing, masterGain: level, fadeMs: this.mix.playing ? 0 : fadeMs, tracks };
  }

  // ── Внутреннее ─────────────────────────────────────────────────────────

  private preset(id: string): SoundPreset {
    const p = this.deps.presets.get(id);
    if (!p) throw new Error(`Unknown sound preset: ${id}`);
    return p;
  }

  private load(p: SoundPreset): void {
    this.mix = { tracks: p.tracks.map((t) => ({ ...t })), presetId: p.id, presetLevel: p.masterVolume, playing: this.mix.playing };
  }

  private resetSessionEffects(): void {
    this.lowered = false;
    this.autoStarted = false;
    this.beforeBreak = null;
  }

  private resolved(def: SoundDef): ResolvedSound | null {
    return def.source.type === 'file' ? this.deps.library.resolve(def.id) : null;
  }

  private availabilityOf(def: SoundDef): SoundAvailability {
    if (def.source.type === 'generated') return { id: def.id, available: true, path: null };
    const r = this.resolved(def);
    if (!r) return { id: def.id, available: false, path: null };
    return { id: def.id, available: !this.corrupt.has(r.stamp), path: r.path };
  }

  private playable(soundId: string): boolean {
    const def = this.deps.library.get(soundId);
    return def !== undefined && this.availabilityOf(def).available;
  }

  private push(fadeMs = 0): AudioStatus {
    this.deps.engine.send(this.engineCommand(fadeMs));
    return this.emitStatus();
  }

  private emitStatus(): AudioStatus {
    const s = this.status();
    this.emit('status', s);
    return s;
  }
}

const cloneMix = (m: Mix): Mix => ({ ...m, tracks: m.tracks.map((t) => ({ ...t })) });

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
