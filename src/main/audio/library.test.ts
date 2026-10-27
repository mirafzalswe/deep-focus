// Поиск звуковых файлов (§5.1): userData/sounds/<id>.* → assets/sounds/<id>.mp3; df-sound:// не выходит за эти папки.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openStorage, type Storage } from '../db';
import { resolveSoundRequest, SoundLibrary, soundUrl } from './library';

let dir: string;
let roots: { user: string; bundled: string };
let storage: Storage;
let library: SoundLibrary;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'df-sounds-'));
  roots = { user: join(dir, 'userData', 'sounds'), bundled: join(dir, 'assets', 'sounds') };
  mkdirSync(roots.bundled, { recursive: true });
  storage = openStorage(':memory:');
  library = new SoundLibrary(storage, roots);
});

afterEach(() => {
  storage.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (path: string, content = 'x') => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
};

describe('resolve', () => {
  it('нет файла ни в одной папке → null', () => {
    expect(library.resolve('rain')).toBeNull();
  });

  it('assets/sounds/<id>.mp3, если в userData нет', () => {
    put(join(roots.bundled, 'rain.mp3'));
    expect(library.resolve('rain')?.path).toBe(join(roots.bundled, 'rain.mp3'));
  });

  it('userData/sounds/<id>.<любое из mp3/ogg/wav/m4a> важнее assets', () => {
    put(join(roots.bundled, 'rain.mp3'));
    put(join(roots.user, 'rain.ogg'));
    expect(library.resolve('rain')?.path).toBe(join(roots.user, 'rain.ogg'));
  });

  it('в assets ищется только .mp3; чужие расширения в userData не подходят', () => {
    put(join(roots.bundled, 'rain.wav'));
    put(join(roots.user, 'rain.txt'));
    expect(library.resolve('rain')).toBeNull();
  });

  it('генерируемый звук и неизвестный id не имеют файла', () => {
    expect(library.resolve('brown-noise')).toBeNull();
    put(join(roots.bundled, 'nope.mp3'));
    expect(library.resolve('nope')).toBeNull();
  });
});

describe('df-sound:// — только из двух папок', () => {
  beforeEach(() => {
    put(join(roots.bundled, 'rain.mp3'));
    put(join(dir, 'secret.mp3'), 'secret');
    put(join(dir, 'userData', 'secret.mp3'), 'secret');
  });

  it('известный звук отдаётся по своему адресу', () => {
    expect(resolveSoundRequest(soundUrl('rain'), library)).toBe(join(roots.bundled, 'rain.mp3'));
  });

  it.each([
    'df-sound://sound/..%2F..%2Fsecret',
    'df-sound://sound/..%5C..%5Csecret',
    'df-sound://sound/../../secret',
    'df-sound://sound/%2E%2E/secret',
    'df-sound://sound/rain/../../secret',
    'df-sound://..%2Fsecret/rain',
    'df-sound://sound/C:%5Cwindows%5Cwin.ini',
    'df-sound://sound/secret',
    'file:///C:/secret.mp3',
  ])('попытка выйти за папку: %s → отказ', (url) => {
    expect(resolveSoundRequest(url, library)).toBeNull();
  });
});

describe('свои звуки (A01)', () => {
  it('копируются в userData/sounds и видны в категории custom', () => {
    const src = join(dir, 'My Lofi.WAV');
    put(src, 'RIFF-data');
    const def = library.addCustom(src, 'My Lofi');
    expect(def.category).toBe('custom');
    expect(def.nameKey).toBe('My Lofi');
    const resolved = library.resolve(def.id);
    expect(resolved?.path.startsWith(roots.user)).toBe(true);
    expect(readFileSync(resolved!.path, 'utf8')).toBe('RIFF-data');
    expect(library.defs().filter((d) => d.category === 'custom').map((d) => d.id)).toEqual([def.id]);
    // переживает перезапуск: список хранится в базе
    expect(new SoundLibrary(storage, roots).defs().some((d) => d.id === def.id)).toBe(true);
  });

  it('файл для звука библиотеки кнопкой: копия как userData/sounds/<id>.<ext>, прежняя копия заменяется', () => {
    put(join(roots.bundled, 'rain.mp3'));
    put(join(roots.user, 'rain.ogg'), 'old');
    const src = join(dir, 'Downloads', 'Rain Loop.M4A');
    put(src, 'new-rain');
    const def = library.attachFile('rain', src);
    expect(def.id).toBe('rain');
    expect(library.resolve('rain')?.path).toBe(join(roots.user, 'rain.m4a'));
    expect(readFileSync(join(roots.user, 'rain.m4a'), 'utf8')).toBe('new-rain');
    expect(library.defs().filter((d) => d.id === 'rain')).toHaveLength(1);
  });

  it('файл для генерируемого или неизвестного звука не принимается', () => {
    const src = join(dir, 'a.mp3');
    put(src);
    expect(() => library.attachFile('brown-noise', src)).toThrow();
    expect(() => library.attachFile('../x', src)).toThrow();
  });

  it('недопустимое расширение отклоняется', () => {
    const src = join(dir, 'notes.txt');
    put(src);
    expect(() => library.addCustom(src, 'notes')).toThrow();
    expect(library.defs().some((d) => d.category === 'custom')).toBe(false);
  });
});
