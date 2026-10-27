// UpdateService (R150, R158i): проверка обновлений на GitHub Releases через electron-updater.
// autoDownload выключен: скачивание — по кнопке, установка — при выходе из приложения.
import type { UpdateStatus } from '../../shared/types';
import { isSourceConfigured, type UpdateSource } from './source';

/** Часть API electron-updater, которая нужна сервису (в тестах — фейк). */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  setFeedURL(options: { provider: 'github'; owner: string; repo: string }): void;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  on(event: 'update-available' | 'update-not-available' | 'update-downloaded', cb: (info: { version?: string }) => void): unknown;
  on(event: 'error', cb: (err: Error) => void): unknown;
}

export interface UpdateServiceDeps {
  source: UpdateSource;
  /** Приложение установлено (собрано). В режиме разработки обновлять нечего. */
  isPackaged: boolean;
  /** Ленивое создание updater: пока источник не настроен, electron-updater даже не загружается. */
  createUpdater: () => UpdaterLike;
  onStatus?: (status: UpdateStatus) => void;
  log?: (message: string, err?: unknown) => void;
}

export const REASON_NOT_CONFIGURED = 'updates.notConfigured';
export const REASON_DEV = 'updates.devBuild';
export const REASON_ERROR = 'updates.error';
export const REASON_DOWNLOADING = 'updates.downloading';

export class UpdateService {
  private current: UpdateStatus;
  private updater: UpdaterLike | null = null;

  constructor(private readonly deps: UpdateServiceDeps) {
    this.current = this.initialStatus();
  }

  private initialStatus(): UpdateStatus {
    if (!isSourceConfigured(this.deps.source)) return { state: 'disabled', version: null, reasonKey: REASON_NOT_CONFIGURED };
    if (!this.deps.isPackaged) return { state: 'disabled', version: null, reasonKey: REASON_DEV };
    return { state: 'idle', version: null, reasonKey: null };
  }

  status(): UpdateStatus {
    return this.current;
  }

  /** Установка при выходе включена всегда после проверки; метод — явное подтверждение для вызова из main. */
  installOnQuit(): void {
    if (this.updater) this.updater.autoInstallOnAppQuit = true;
  }

  /** Первое нажатие — проверка; если версия найдена, следующее — скачивание. Сеть — только при настроенном источнике. */
  async checkNow(): Promise<UpdateStatus> {
    if (this.current.state === 'disabled' || this.current.state === 'checking') return this.current;
    try {
      const updater = this.ensureUpdater();
      if (this.current.state === 'available') {
        this.set({ state: 'checking', version: this.current.version, reasonKey: REASON_DOWNLOADING });
        await updater.downloadUpdate();
      } else if (this.current.state !== 'downloaded') {
        this.set({ state: 'checking', version: null, reasonKey: null });
        await updater.checkForUpdates();
      }
    } catch (err) {
      this.fail(err);
    }
    return this.current;
  }

  private ensureUpdater(): UpdaterLike {
    if (this.updater) return this.updater;
    const updater = this.deps.createUpdater();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = true;
    updater.setFeedURL({ provider: 'github', owner: this.deps.source.owner, repo: this.deps.source.repo });
    updater.on('update-available', (info) => this.set({ state: 'available', version: info.version ?? null, reasonKey: null }));
    updater.on('update-not-available', () => this.set({ state: 'notAvailable', version: null, reasonKey: null }));
    updater.on('update-downloaded', (info) => this.set({ state: 'downloaded', version: info.version ?? this.current.version, reasonKey: null }));
    updater.on('error', (err) => this.fail(err));
    this.updater = updater;
    return updater;
  }

  private fail(err: unknown): void {
    this.deps.log?.('update check failed', err);
    this.set({ state: 'error', version: null, reasonKey: REASON_ERROR });
  }

  private set(next: UpdateStatus): void {
    this.current = next;
    this.deps.onStatus?.(next);
  }
}
