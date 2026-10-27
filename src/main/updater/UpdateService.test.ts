import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { UpdateService, type UpdaterLike } from './UpdateService';
import { isSourceConfigured, UPDATE_OWNER, UPDATE_REPO } from './source';

type Handler = (arg: never) => void;

function fakeUpdater(opts: { available?: string | null; failCheck?: boolean } = {}) {
  const handlers = new Map<string, Handler>();
  const calls: string[] = [];
  const emit = (event: string, arg?: unknown) => handlers.get(event)?.(arg as never);
  const updater: UpdaterLike = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    setFeedURL: () => calls.push('setFeedURL'),
    checkForUpdates: async () => {
      calls.push('check');
      if (opts.failCheck) throw new Error('net down');
      if (opts.available) emit('update-available', { version: opts.available });
      else emit('update-not-available', {});
    },
    downloadUpdate: async () => {
      calls.push('download');
      emit('update-downloaded', { version: opts.available });
    },
    on: ((event: string, cb: Handler) => handlers.set(event, cb)) as UpdaterLike['on'],
  };
  return { updater, calls };
}

const configured = { owner: 'someone', repo: 'deep-focus' };

describe('UpdateService', () => {
  it('источник не настроен: «выключено», updater не создаётся, сети нет', async () => {
    let created = 0;
    const service = new UpdateService({
      source: { owner: UPDATE_OWNER, repo: UPDATE_REPO },
      isPackaged: true,
      createUpdater: () => {
        created++;
        return fakeUpdater().updater;
      },
    });
    expect(service.status()).toEqual({ state: 'disabled', version: null, reasonKey: 'updates.notConfigured' });
    expect(await service.checkNow()).toEqual({ state: 'disabled', version: null, reasonKey: 'updates.notConfigured' });
    expect(created).toBe(0);
  });

  it('настроен: проверка находит версию, скачивание — только вторым нажатием, установка при выходе включена', async () => {
    const fake = fakeUpdater({ available: '9.9.9' });
    const service = new UpdateService({ source: configured, isPackaged: true, createUpdater: () => fake.updater });
    expect(service.status().state).toBe('idle');
    expect(await service.checkNow()).toEqual({ state: 'available', version: '9.9.9', reasonKey: null });
    expect(fake.calls).toEqual(['setFeedURL', 'check']);
    expect(fake.updater.autoDownload).toBe(false);
    expect(fake.updater.autoInstallOnAppQuit).toBe(true);
    expect(await service.checkNow()).toEqual({ state: 'downloaded', version: '9.9.9', reasonKey: null });
    expect(fake.calls).toEqual(['setFeedURL', 'check', 'download']);
  });

  it('настроен, новой версии нет → notAvailable', async () => {
    const service = new UpdateService({ source: configured, isPackaged: true, createUpdater: () => fakeUpdater().updater });
    expect((await service.checkNow()).state).toBe('notAvailable');
  });

  it('ошибка сети не выбрасывается, статус error и запись в журнал', async () => {
    const logs: string[] = [];
    const service = new UpdateService({
      source: configured,
      isPackaged: true,
      createUpdater: () => fakeUpdater({ failCheck: true }).updater,
      log: (m) => logs.push(m),
    });
    expect(await service.checkNow()).toEqual({ state: 'error', version: null, reasonKey: 'updates.error' });
    expect(logs).toHaveLength(1);
  });

  it('режим разработки (не установлено) — выключено даже при настроенном источнике', async () => {
    let created = 0;
    const service = new UpdateService({
      source: configured,
      isPackaged: false,
      createUpdater: () => {
        created++;
        return fakeUpdater().updater;
      },
    });
    expect((await service.checkNow()).reasonKey).toBe('updates.devBuild');
    expect(created).toBe(0);
  });
});

describe('источник обновлений', () => {
  it('заглушки не считаются настроенными, настоящие имена — считаются', () => {
    expect(isSourceConfigured({ owner: '[GITHUB_OWNER]', repo: '[GITHUB_REPO]' })).toBe(false);
    expect(isSourceConfigured({ owner: 'me', repo: '' })).toBe(false);
    expect(isSourceConfigured({ owner: 'me', repo: 'deep-focus' })).toBe(true);
  });

  it('electron-builder.yml публикует в тот же owner/repo, что и приложение', () => {
    const yml = readFileSync(resolve(__dirname, '../../../electron-builder.yml'), 'utf8');
    expect(yml).toContain(`owner: '${UPDATE_OWNER}'`);
    expect(yml).toContain(`repo: '${UPDATE_REPO}'`);
  });
});
