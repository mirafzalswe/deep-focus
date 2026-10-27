// Библиотека звуков на диске (§5.1, §5.3): встроенные определения + свои звуки пользователя.
// Файл ищется как userData/sounds/<id>.<mp3|ogg|wav|m4a>, затем assets/sounds/<id>.mp3.
// Отдача по df-sound:// — только известных id и только из этих двух папок. Без Electron — тестируется Vitest.
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative } from 'node:path';
import { SOUND_LIBRARY } from '../../shared/defaults';
import type { SoundDef } from '../../shared/types';
import type { Storage } from '../db';

export const SOUND_SCHEME = 'df-sound';
export const AUDIO_EXTENSIONS = ['.mp3', '.ogg', '.wav', '.m4a'] as const;
/** id звука — он же имя файла: только латиница в нижнем регистре, цифры и дефис. */
export const SOUND_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CUSTOM_KEY = 'audio.customSounds';
const MAX_CUSTOM_BYTES = 500 * 1024 * 1024;

export interface SoundRoots {
  /** userData/sounds */
  user: string;
  /** assets/sounds (в сборке — resources/assets/sounds) */
  bundled: string;
}

export interface ResolvedSound {
  path: string;
  /** путь + размер + время изменения: файл заменили — проверка декодирования повторяется */
  stamp: string;
}

export const soundUrl = (id: string): string => `${SOUND_SCHEME}://sound/${id}`;

function isInside(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

function fileStat(path: string): { size: number; mtimeMs: number } | null {
  try {
    const s = statSync(path);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** Путь к файлу для запроса df-sound://sound/<id>; null — запрос не к известному звуку или файла нет. */
export function resolveSoundRequest(url: string, library: SoundLibrary): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${SOUND_SCHEME}:` || parsed.hostname !== 'sound') return null;
  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length !== 1) return null;
  let id: string;
  try {
    id = decodeURIComponent(segments[0]!);
  } catch {
    return null;
  }
  if (!SOUND_ID_PATTERN.test(id)) return null;
  return library.resolve(id)?.path ?? null;
}

export class SoundLibrary {
  constructor(
    private readonly storage: Storage,
    private readonly roots: SoundRoots,
  ) {}

  /** Встроенные звуки и свои (категория custom). */
  defs(): SoundDef[] {
    return [...SOUND_LIBRARY, ...this.custom()];
  }

  get(id: string): SoundDef | undefined {
    return this.defs().find((d) => d.id === id);
  }

  resolve(id: string): ResolvedSound | null {
    const def = this.get(id);
    if (!def || def.source.type !== 'file' || !SOUND_ID_PATTERN.test(id)) return null;
    const candidates = [...this.userCandidates(id), join(this.roots.bundled, `${id}.mp3`)];
    for (const path of candidates) {
      const root = path.startsWith(this.roots.user) ? this.roots.user : this.roots.bundled;
      if (!isInside(root, path)) continue;
      const stat = fileStat(path);
      if (stat) return { path, stamp: `${path}|${stat.size}|${stat.mtimeMs}` };
    }
    return null;
  }

  /** Копирует файл в userData/sounds и добавляет звук в категорию «Свои». */
  addCustom(filePath: string, name: string): SoundDef {
    const ext = this.checkSource(filePath);
    const id = `custom-${randomUUID().slice(0, 8)}`;
    mkdirSync(this.roots.user, { recursive: true });
    copyFileSync(filePath, join(this.roots.user, `${id}${ext}`));
    const def: SoundDef = {
      id,
      nameKey: name.trim().slice(0, 100) || id,
      category: 'custom',
      source: { type: 'file', file: `${id}${ext}` },
    };
    this.storage.kv.set(CUSTOM_KEY, [...this.custom(), def]);
    return def;
  }

  /**
   * Файл для звука из библиотеки (§5.1 «или добавлю кнопкой»): копия userData/sounds/<id>.<ext>;
   * прежние копии этого звука с другими расширениями удаляются, чтобы играл именно новый файл.
   */
  attachFile(id: string, filePath: string): SoundDef {
    const def = this.get(id);
    if (!def || def.source.type !== 'file' || !SOUND_ID_PATTERN.test(id)) throw new Error(`Not a file sound: ${id}`);
    const ext = this.checkSource(filePath);
    mkdirSync(this.roots.user, { recursive: true });
    const target = join(this.roots.user, `${id}${ext}`);
    for (const old of this.userCandidates(id)) if (old !== target) rmSync(old, { force: true });
    copyFileSync(filePath, target);
    return def;
  }

  private checkSource(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    if (!(AUDIO_EXTENSIONS as readonly string[]).includes(ext)) throw new Error(`Unsupported sound file type: ${ext}`);
    const stat = fileStat(filePath);
    if (!stat) throw new Error('Sound file not found');
    if (stat.size > MAX_CUSTOM_BYTES) throw new Error('Sound file is too large');
    return ext;
  }

  private custom(): SoundDef[] {
    const list = this.storage.kv.get<SoundDef[]>(CUSTOM_KEY);
    if (!Array.isArray(list)) return [];
    return list.filter(
      (d) => d && typeof d.id === 'string' && SOUND_ID_PATTERN.test(d.id) && typeof d.nameKey === 'string' && d.category === 'custom',
    );
  }

  private userCandidates(id: string): string[] {
    if (!existsSync(this.roots.user)) return [];
    let names: string[];
    try {
      names = readdirSync(this.roots.user);
    } catch {
      return [];
    }
    const rank = (name: string) => (AUDIO_EXTENSIONS as readonly string[]).indexOf(extname(name).toLowerCase());
    return names
      .filter((n) => rank(n) >= 0 && n.slice(0, -extname(n).length).toLowerCase() === id)
      .sort((a, b) => rank(a) - rank(b))
      .map((n) => join(this.roots.user, n));
  }
}
