// Чистая обработка звука движка (§5.2, §5.5): шумы без файлов, петли без щелчка на стыке, обрезка тишины.
import { describe, expect, it } from 'vitest';
import { fileLoop, makeSeamlessLoop, noiseLoop, seededRandom, trimSilence } from './dsp';

const RATE = 8000;

function maxStep(x: Float32Array): number {
  let m = 0;
  for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i]! - x[i - 1]!));
  return m;
}
/** Скачок на стыке петли: последний сэмпл → первый. */
const wrapStep = (x: Float32Array) => Math.abs(x[0]! - x[x.length - 1]!);
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length);

describe('генераторы шума', () => {
  it.each(['white', 'pink', 'brown'] as const)('%s: 10 с, без клиппинга, слышимый уровень', (kind) => {
    const loop = noiseLoop(kind, RATE, 10, seededRandom(1));
    expect(loop.length).toBe(10 * RATE);
    expect(peak(loop)).toBeLessThanOrEqual(1);
    expect(rms(loop)).toBeGreaterThan(0.03);
  });

  it.each(['white', 'pink', 'brown'] as const)('%s: стык петли не больше обычного шага между сэмплами', (kind) => {
    const loop = noiseLoop(kind, RATE, 10, seededRandom(7));
    expect(wrapStep(loop)).toBeLessThanOrEqual(maxStep(loop));
  });

  it('коричневый шум низкочастотный: шаги между сэмплами заметно меньше, чем у белого', () => {
    const brown = noiseLoop('brown', RATE, 2, seededRandom(3));
    const white = noiseLoop('white', RATE, 2, seededRandom(3));
    const meanStep = (x: Float32Array) => x.reduce((s, v, i) => (i ? s + Math.abs(v - x[i - 1]!) : 0), 0) / x.length;
    expect(meanStep(brown)).toBeLessThan(meanStep(white) / 5);
  });
});

describe('петля из файла', () => {
  it('тишина в начале и конце обрезается по порогу', () => {
    const ch = new Float32Array(1000 + 3000 + 500);
    for (let i = 1000; i < 4000; i++) ch[i] = 0.5 * Math.sin(i / 7);
    ch[1000] = 0.2; // первый слышимый сэмпл
    ch[3999] = 0.2; // последний слышимый сэмпл
    expect(trimSilence([ch, new Float32Array(ch.length)])).toEqual({ start: 1000, end: 4000 });
  });

  it('полная тишина — пустой диапазон', () => {
    expect(trimSilence([new Float32Array(100)])).toEqual({ start: 0, end: 0 });
  });

  it('кроссфейд конца в начало: стык гладкий там, где у сырого сигнала был скачок', () => {
    // синус с нецелым числом периодов: «в лоб» зацикленный даёт резкий скачок на стыке
    const raw = Float32Array.from({ length: RATE * 5 }, (_, i) => 0.8 * Math.sin((2 * Math.PI * 3.3 * i) / RATE + 0.4));
    expect(wrapStep(raw)).toBeGreaterThan(10 * maxStep(raw));
    const fade = Math.round(1.5 * RATE);
    const loop = makeSeamlessLoop(raw, raw.length - fade, fade);
    expect(loop.length).toBe(raw.length - fade);
    expect(wrapStep(loop)).toBeLessThanOrEqual(maxStep(raw) * 1.01);
  });

  it('fileLoop: обрезка тишины + кроссфейд ~1.5 с на всех каналах', () => {
    const len = RATE * 6;
    const make = (phase: number) => {
      const ch = new Float32Array(RATE + len + RATE); // 1 с тишины с обеих сторон
      for (let i = 0; i < len; i++) ch[RATE + i] = 0.5 * Math.sin((2 * Math.PI * 2.7 * i) / RATE + phase);
      return ch;
    };
    const loops = fileLoop([make(0.3), make(1.1)], RATE);
    expect(loops).toHaveLength(2);
    for (const loop of loops) {
      // длина: звучащая часть минус кроссфейд 1.5 с (± пара сэмплов порога)
      expect(Math.abs(loop.length - (len - 1.5 * RATE))).toBeLessThan(RATE * 0.01);
      expect(wrapStep(loop)).toBeLessThanOrEqual(maxStep(loop) * 1.05);
    }
  });

  it('короткий файл: кроссфейд не длиннее трети звучания', () => {
    const ch = Float32Array.from({ length: RATE }, (_, i) => 0.5 * Math.sin(i / 3));
    const [loop] = fileLoop([ch], RATE);
    expect(loop!.length).toBeGreaterThanOrEqual(Math.floor((RATE * 2) / 3) - 2);
  });
});
