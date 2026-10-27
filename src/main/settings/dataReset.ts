// «Удалить все данные» (§11.3, R140). Две половины:
//  1) requestDeleteAllData — по слову подтверждения: снять блокировку (системный прокси — к исходному),
//     убедиться, что снимок исходных настроек больше не нужен, остановить сессию и звук, поставить метку, перезапуск;
//  2) deleteAllDataIfRequested — при следующем запуске, до открытия базы: удалить базу и свои звуки.
// Удаляются только известные имена внутри userData; путь проверяется перед удалением.
import { lstat, readdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import type { DeleteDataResult } from '../../shared/types';

const MARKER = '.delete-all-data';
const SOUNDS_DIR = 'sounds';

export const deleteMarkerPath = (userData: string) => join(userData, MARKER);

export function isConfirmWord(input: string, words: readonly string[]): boolean {
  const norm = (s: string) => s.trim().toLocaleUpperCase();
  const typed = norm(input);
  return typed !== '' && words.some((w) => norm(w) === typed);
}

export interface DeleteAllDeps {
  /** Слова подтверждения на всех языках интерфейса. */
  confirmWords: readonly string[];
  /** Выключить блокировку в настройках, чтобы она не включилась снова до выхода; возвращает отмену. */
  disableBlocker(): () => void;
  /** Снять блокировку: вернуть системный прокси к исходному, остановить PAC-сервер. */
  releaseBlocker(): Promise<void>;
  /** Снимок исходных настроек прокси больше не хранится (возврат подтверждён). */
  proxyRestored(): boolean;
  /** Остановить сессию и звук. */
  stopActivity(): void;
  /** Метка «удалить при следующем запуске» в userData. */
  writeMarker(): Promise<void>;
  /** Перезапуск приложения. */
  restart(): void;
}

export async function requestDeleteAllData(word: string, deps: DeleteAllDeps): Promise<DeleteDataResult> {
  if (!isConfirmWord(word, deps.confirmWords)) return { ok: false, errorKey: 'settings.deleteWrongWord' };
  const undo = deps.disableBlocker();
  await deps.releaseBlocker();
  if (!deps.proxyRestored()) {
    // В базе — единственная копия исходных настроек прокси: удалять её нельзя.
    undo();
    return { ok: false, errorKey: 'settings.deleteProxyNotRestored' };
  }
  deps.stopActivity();
  await deps.writeMarker();
  deps.restart();
  return { ok: true };
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;

/** child лежит строго внутри parent (не равен ему и не выходит за него). */
function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..');
}

/** Папка данных — не корень диска, не домашняя папка пользователя и не её предок. */
export function isSafeUserDataDir(dir: string, home: string = homedir()): boolean {
  if (!isAbsolute(dir)) return false;
  const norm = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p));
  const target = norm(dir);
  const userHome = norm(home);
  if (target === norm(parse(target).root)) return false;
  return target !== userHome && !isInside(target, userHome);
}

/**
 * Вызывается index.ts до открытия базы. Метки нет — null. Есть — удаляет из userData базу
 * (`<db>`, `<db>-wal/-shm/-journal`, `<db>.corrupt-*`) и папку своих звуков, затем метку; возвращает удалённые имена.
 * Небезопасная папка данных или база вне неё — исключение, ничего не удалено.
 */
export async function deleteAllDataIfRequested(userData: string, dbPath: string, home: string = homedir()): Promise<string[] | null> {
  if (!isSafeUserDataDir(userData, home)) throw new Error(`refusing to delete data: unsafe userData directory ${userData}`);
  const root = resolve(userData);
  const marker = deleteMarkerPath(root);
  try {
    await readFile(marker);
  } catch {
    return null;
  }
  if (!samePath(dirname(resolve(dbPath)), root)) throw new Error(`refusing to delete data: database ${dbPath} is outside ${root}`);

  const dbName = basename(dbPath);
  const isTarget = (name: string) =>
    name === SOUNDS_DIR || name === dbName || name.startsWith(`${dbName}-`) || name.startsWith(`${dbName}.corrupt-`);

  const deleted: string[] = [];
  for (const name of (await readdir(root)).filter(isTarget)) {
    const full = join(root, name);
    if (!isInside(root, full)) continue;
    const info = await lstat(full);
    // Ссылка (symlink/junction) удаляется сама, без обхода того, на что указывает.
    await rm(full, { recursive: info.isDirectory() && !info.isSymbolicLink(), force: true, maxRetries: 3 });
    deleted.push(name);
  }
  await rm(marker, { force: true });
  return deleted;
}
