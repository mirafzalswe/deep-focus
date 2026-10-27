// Рисует значки Deep Focus (кольцо таймера) без внешних зависимостей: node build/make-icons.mjs
// Результат: resources/icon.ico (16..256), resources/icon.png (256), resources/tray/tray-<tone>.png (32).
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources');
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** RGBA-буфер size×size: кольцо (с разрывом-«прогрессом» при arc<1) и необязательная точка; fill — плитка-фон. */
function render(size, { color, dot, arc = 1, tile = null }) {
  const px = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const rOuter = size * (tile ? 0.34 : 0.48);
  const rInner = rOuter * 0.68;
  const rDot = rInner * 0.55;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      let rgba = [0, 0, 0, 0];
      if (tile) {
        // скруглённая плитка
        const half = size / 2 - 1;
        const rad = size * 0.22;
        const qx = Math.abs(x - c) - (half - rad);
        const qy = Math.abs(y - c) - (half - rad);
        const sd = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
        const a = clamp01(0.5 - sd);
        rgba = [...tile, Math.round(255 * a)];
      }
      // угол от 12 часов по часовой стрелке
      let ang = Math.atan2(x - c, -(y - c));
      if (ang < 0) ang += Math.PI * 2;
      const inArc = ang <= arc * Math.PI * 2 || arc >= 1;
      const ring = clamp01(rOuter + 0.5 - d) * clamp01(d - rInner + 0.5) * (inArc ? 1 : 0.28);
      const dotA = dot ? clamp01(rDot + 0.5 - d) : 0;
      const a = Math.max(ring, dotA);
      if (a > 0) {
        const base = rgba[3] / 255;
        const outA = a + base * (1 - a);
        rgba = [0, 1, 2].map((i) => Math.round((color[i] * a + rgba[i] * base * (1 - a)) / outA)).concat(Math.round(outA * 255));
      }
      px.set(rgba, (y * size + x) * 4);
    }
  }
  return px;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(join(root, 'tray'), { recursive: true });

// Основной значок: светлое кольцо с «прогрессом» и точкой на тёмной плитке
const app = { color: [0xd8, 0xe4, 0xf3], dot: true, arc: 0.72, tile: [0x23, 0x2a, 0x34] };
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((s) => png(s, render(s, app)));
const head = Buffer.alloc(6);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const dir = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s;
  e[1] = s === 256 ? 0 : s;
  e.writeUInt16LE(1, 4);
  e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8);
  e.writeUInt32LE(offset, 12);
  offset += images[i].length;
  return e;
});
writeFileSync(join(root, 'icon.ico'), Buffer.concat([head, ...dir, ...images]));
writeFileSync(join(root, 'icon.png'), images[images.length - 1]);

// Значки трея: те же тона, что в интерфейсе (графит, синий, зелёный, янтарный)
const tones = { idle: [0x9a, 0xa3, 0xad], focus: [0x6b, 0x93, 0xc4], break: [0x6f, 0xae, 0x8c], paused: [0xc9, 0xa2, 0x5a] };
for (const [name, color] of Object.entries(tones)) {
  writeFileSync(join(root, 'tray', `tray-${name}.png`), png(32, render(32, { color, dot: name !== 'idle' })));
}
process.stdout.write(`icons written to ${root}
`);
