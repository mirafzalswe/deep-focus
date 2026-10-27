// Контекст, который index.ts передаёт в register<Module>(ctx).
// Сервисы модулей регистрируются в ctx.services; тип Services дополняется из папки модуля
// через declaration merging, не трогая этот файл:
//
//   declare module '../context' { interface Services { timer: TimerEngine } }
//
import type { BrowserWindow } from 'electron';
import type { MessageKey, TranslateParams } from '../shared/i18n';
import type { ModuleStatus } from '../shared/types';
import type { Storage } from './db';
import type { Logger } from './logger';
import type { SettingsManager } from './settings/SettingsManager';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- дополняется модулями
export interface Services {}

export interface AppPaths {
  userData: string;
  /** Папка встроенных ресурсов: assets/ в dev, resources/ в собранном приложении. */
  assets: string;
  db: string;
  logs: string;
}

export interface MainContext {
  readonly isDev: boolean;
  readonly paths: AppPaths;
  readonly logger: Logger;
  readonly storage: Storage;
  readonly settings: SettingsManager;
  /** Сервисы модулей: заполняются по мере регистрации; отсутствует — модуль не поднялся. */
  readonly services: Partial<Services>;
  mainWindow(): BrowserWindow | null;
  /** Показать и сфокусировать главное окно (второй запуск, трей, уведомление). */
  showMainWindow(): void;
  /** Разослать событие во все окна. */
  broadcast(channel: string, payload?: unknown): void;
  /** Текст на текущем языке настроек (для уведомлений, диалогов, трея). */
  t(key: MessageKey, params?: TranslateParams): string;
  moduleStatuses(): ModuleStatus[];
}
