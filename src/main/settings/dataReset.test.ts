import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, parse } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  deleteAllDataIfRequested,
  deleteMarkerPath,
  isConfirmWord,
  isSafeUserDataDir,
  requestDeleteAllData,
  type DeleteAllDeps,
} from './dataReset';

function fakeDeps(over: Partial<DeleteAllDeps> = {}) {
  const calls: string[] = [];
  const deps: DeleteAllDeps = {
    confirmWords: ['УДАЛИТЬ', 'DELETE'],
    disableBlocker: () => {
      calls.push('disableBlocker');
      return () => calls.push('undoDisableBlocker');
    },
    releaseBlocker: async () => void calls.push('releaseBlocker'),
    proxyRestored: () => (calls.push('proxyRestored?'), true),
    stopActivity: () => void calls.push('stopActivity'),
    writeMarker: async () => void calls.push('writeMarker'),
    restart: () => void calls.push('restart'),
    ...over,
  };
  return { deps, calls };
}

describe('isConfirmWord', () => {
  it('слово на любом языке словаря, без учёта регистра и пробелов по краям', () => {
    expect(isConfirmWord(' удалить ', ['УДАЛИТЬ', 'DELETE'])).toBe(true);
    expect(isConfirmWord('delete', ['УДАЛИТЬ', 'DELETE'])).toBe(true);
    expect(isConfirmWord('удали', ['УДАЛИТЬ', 'DELETE'])).toBe(false);
    expect(isConfirmWord('', ['УДАЛИТЬ', 'DELETE'])).toBe(false);
  });
});

describe('requestDeleteAllData', () => {
  it('неверное слово — ничего не происходит', async () => {
    const { deps, calls } = fakeDeps();
    expect(await requestDeleteAllData('да', deps)).toEqual({ ok: false, errorKey: 'settings.deleteWrongWord' });
    expect(calls).toEqual([]);
  });

  it('сначала снимается блокировка и проверяется возврат прокси, потом метка удаления и перезапуск', async () => {
    const { deps, calls } = fakeDeps();
    expect(await requestDeleteAllData('УДАЛИТЬ', deps)).toEqual({ ok: true });
    expect(calls).toEqual(['disableBlocker', 'releaseBlocker', 'proxyRestored?', 'stopActivity', 'writeMarker', 'restart']);
  });

  it('прокси не вернулся к исходному — данные (со снимком исходных настроек) не удаляются', async () => {
    const { deps, calls } = fakeDeps({ proxyRestored: () => false });
    expect(await requestDeleteAllData('DELETE', deps)).toEqual({ ok: false, errorKey: 'settings.deleteProxyNotRestored' });
    expect(calls).toEqual(['disableBlocker', 'releaseBlocker', 'undoDisableBlocker']);
  });
});

describe('isSafeUserDataDir', () => {
  it('корень диска, домашняя папка и её предки — не папка данных приложения', () => {
    const home = homedir();
    expect(isSafeUserDataDir(parse(home).root, home)).toBe(false);
    expect(isSafeUserDataDir(home, home)).toBe(false);
    expect(isSafeUserDataDir(dirname(home), home)).toBe(false);
    expect(isSafeUserDataDir('relative\\dir', home)).toBe(false);
    expect(isSafeUserDataDir(join(home, 'AppData', 'Roaming', 'Deep Focus'), home)).toBe(true);
  });
});

describe('deleteAllDataIfRequested', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function makeTree() {
    const root = mkdtempSync(join(tmpdir(), 'df-reset-'));
    dirs.push(root);
    const userData = join(root, 'Deep Focus');
    mkdirSync(join(userData, 'sounds'), { recursive: true });
    mkdirSync(join(userData, 'logs'));
    for (const f of ['deepfocus.db', 'deepfocus.db-wal', 'deepfocus.db-shm', 'deepfocus.db.corrupt-20261027-101010']) {
      writeFileSync(join(userData, f), 'x');
    }
    writeFileSync(join(userData, 'sounds', 'custom-1.mp3'), 'x');
    writeFileSync(join(userData, 'logs', 'deepfocus.log'), 'x');
    writeFileSync(join(userData, 'other.txt'), 'x');
    writeFileSync(join(root, 'outside.db'), 'x');
    return { root, userData, db: join(userData, 'deepfocus.db') };
  }

  it('без метки ничего не удаляет', async () => {
    const { userData, db } = makeTree();
    expect(await deleteAllDataIfRequested(userData, db)).toBeNull();
    expect(readdirSync(userData).sort()).toEqual(
      ['deepfocus.db', 'deepfocus.db-shm', 'deepfocus.db-wal', 'deepfocus.db.corrupt-20261027-101010', 'logs', 'other.txt', 'sounds'],
    );
  });

  it('по метке удаляет базу (с -wal/-shm и повреждёнными копиями), свои звуки и метку; остальное не трогает', async () => {
    const { root, userData, db } = makeTree();
    writeFileSync(deleteMarkerPath(userData), '1');
    const deleted = await deleteAllDataIfRequested(userData, db);
    expect(deleted?.sort()).toEqual(['deepfocus.db', 'deepfocus.db-shm', 'deepfocus.db-wal', 'deepfocus.db.corrupt-20261027-101010', 'sounds']);
    expect(readdirSync(userData).sort()).toEqual(['logs', 'other.txt']);
    expect(existsSync(join(root, 'outside.db'))).toBe(true);
  });

  it('база вне папки данных или небезопасная папка — отказ без удаления', async () => {
    const { root, userData, db } = makeTree();
    writeFileSync(deleteMarkerPath(userData), '1');
    await expect(deleteAllDataIfRequested(userData, join(root, 'outside.db'))).rejects.toThrow(/outside/);
    expect(existsSync(join(root, 'outside.db'))).toBe(true);
    expect(existsSync(db)).toBe(true);
    await expect(deleteAllDataIfRequested(homedir(), join(homedir(), 'deepfocus.db'))).rejects.toThrow(/unsafe/);
  });
});
