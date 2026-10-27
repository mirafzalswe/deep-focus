import { IPC } from '../../shared/ipc';
import type { BlockerStatus, BlockRule } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const blocker = {
  status: () => invoke<BlockerStatus>(IPC.blocker.status),
  rules: () => invoke<BlockRule[]>(IPC.blocker.rules),
  /** pattern — как ввёл пользователь; main нормализует. Неверный домен → ошибка с i18n-ключом в message. */
  saveRule: (r: BlockRule) => invoke<{ rule: BlockRule; warningKey: string | null }>(IPC.blocker.saveRule, r),
  deleteRule: (id: string) => invoke<void>(IPC.blocker.deleteRule, id),
  requestUnlock: () => invoke<BlockerStatus>(IPC.blocker.requestUnlock),
  confirmUnlock: (phrase: string) => invoke<BlockerStatus>(IPC.blocker.confirmUnlock, phrase),
  recheck: () => invoke<BlockerStatus>(IPC.blocker.recheck),
  /** Экран согласия пройден: запомнить согласие и включить блокировку (§4.8.1). */
  giveConsent: () => invoke<BlockerStatus>(IPC.blocker.giveConsent),
  onStatus: (cb: (s: BlockerStatus) => void) => subscribe(IPC.blocker.statusChanged, cb),
};
