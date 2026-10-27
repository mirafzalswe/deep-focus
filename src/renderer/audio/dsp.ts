// Чистая обработка сэмплов для звукового движка (без Web Audio — тестируется Vitest).
// Шумы (§5.2): белый — равномерный; розовый — фильтр Пола Келлета; коричневый — интегрированный белый с утечкой.
// Петли (§5.5): хвост сигнала равномощно вплетается в начало, поэтому последний сэмпл петли переходит в
// первый так же гладко, как соседние сэмплы исходника — щелчка на стыке нет.

export type NoiseKind = 'white' | 'pink' | 'brown';
/** Сэмплы на собственном ArrayBuffer — их принимает AudioBuffer.copyToChannel. */
export type Samples = Float32Array<ArrayBuffer>;

/** Порог тишины по краям файла: −60 dBFS. */
export const SILENCE_THRESHOLD = 0.001;
/** Кроссфейд петли из файла, с. */
export const FILE_CROSSFADE_SEC = 1.5;
/** Кроссфейд петли шума, с. */
const NOISE_CROSSFADE_SEC = 0.5;
const PEAK_LIMIT = 0.95;

/** Детерминированный генератор [0, 1) (mulberry32) — для тестов и воспроизводимости. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rawNoise(kind: NoiseKind, length: number, warmup: number, rnd: () => number): Samples {
  const out = new Float32Array(length);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0; // prettier-ignore
  let brown = 0;
  for (let i = -warmup; i < length; i++) {
    const w = rnd() * 2 - 1;
    let v: number;
    if (kind === 'white') v = w * 0.5;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      v = brown * 3.5;
    }
    if (i >= 0) out[i] = v;
  }
  return out;
}

/**
 * Петля длиной loopLength из samples (нужно loopLength + fadeLength сэмплов):
 * первые fadeLength сэмплов — равномощная смесь начала (нарастает) и продолжения после конца петли (затухает).
 */
export function makeSeamlessLoop(samples: Float32Array, loopLength: number, fadeLength: number): Samples {
  if (samples.length < loopLength + fadeLength) throw new Error('makeSeamlessLoop: not enough samples');
  const out = samples.slice(0, loopLength);
  for (let i = 0; i < fadeLength; i++) {
    const t = (i / fadeLength) * (Math.PI / 2);
    out[i] = samples[i]! * Math.sin(t) + samples[loopLength + i]! * Math.cos(t);
  }
  return out;
}

function limitPeak(x: Samples): Samples {
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  if (peak > PEAK_LIMIT) {
    const k = PEAK_LIMIT / peak;
    for (let i = 0; i < x.length; i++) x[i] = x[i]! * k;
  }
  return x;
}

/** Бесшовная петля шума заданной длины (по умолчанию 10 с). */
export function noiseLoop(kind: NoiseKind, sampleRate: number, seconds = 10, rnd: () => number = Math.random): Samples {
  const length = Math.round(sampleRate * seconds);
  const fade = Math.min(Math.round(sampleRate * NOISE_CROSSFADE_SEC), Math.floor(length / 4));
  const raw = rawNoise(kind, length + fade, sampleRate, rnd);
  return limitPeak(makeSeamlessLoop(raw, length, fade));
}

/** Диапазон [start, end) без тишины по краям (по всем каналам). Полная тишина — {0, 0}. */
export function trimSilence(channels: Float32Array[], threshold = SILENCE_THRESHOLD): { start: number; end: number } {
  const length = Math.min(...channels.map((c) => c.length));
  const loud = (i: number) => channels.some((c) => Math.abs(c[i]!) > threshold);
  let start = 0;
  while (start < length && !loud(start)) start++;
  if (start === length) return { start: 0, end: 0 };
  let end = length;
  while (end > start && !loud(end - 1)) end--;
  return { start, end };
}

/** Петля из декодированного файла: обрезка тишины + кроссфейд ~1.5 с (не длиннее трети звучания). */
export function fileLoop(channels: Float32Array[], sampleRate: number, crossfadeSec = FILE_CROSSFADE_SEC): Samples[] {
  const { start, end } = trimSilence(channels);
  const length = end - start;
  if (length < 3) return channels.map((c) => c.slice(start, end));
  const fade = Math.min(Math.round(sampleRate * crossfadeSec), Math.floor(length / 3));
  return channels.map((c) => makeSeamlessLoop(c.subarray(start, end), length - fade, fade));
}

// ── Сигнал начала и конца интервала ──────────────────────────────────────
// Мягкий «колокольчик»: синус с плавной атакой и экспоненциальным затуханием.
// Старт — два восходящих тона (до → соль), конец — три нисходящих (соль → ми → до).

export interface SignalNote {
  /** частота, Гц */
  freq: number;
  /** начало от момента сигнала, с */
  at: number;
  /** нарастание до пика, с — без резкой атаки (щелчка) */
  attack: number;
  /** затухание до тишины после пика, с */
  decay: number;
  /** пик относительно громкости сигнала */
  peak: number;
}

const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;

const note = (freq: number, at: number, decay: number, peak = 1): SignalNote => ({ freq, at, attack: 0.025, decay, peak });

export function signalNotes(kind: 'start' | 'end'): SignalNote[] {
  return kind === 'start'
    ? [note(C5, 0, 0.45, 0.9), note(G5, 0.18, 0.6)]
    : [note(G5, 0, 0.4), note(E5, 0.2, 0.4, 0.95), note(C5, 0.4, 0.75, 0.9)];
}

/** Полная длительность сигнала, с. */
export function signalLength(kind: 'start' | 'end'): number {
  return Math.max(...signalNotes(kind).map((n) => n.at + n.attack + n.decay));
}
