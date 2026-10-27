import { IPC } from '../../shared/ipc';
import type { BlockerStatus, BlockRule } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const blocker = {
  status: () => invoke<BlockerStatus>(IPC.blocker.status),
  rules: () => invoke<BlockRule[]>(IPC.blocker.rules),
  saveRule: (r: BlockRule) => invoke<{ rule: BlockRule; warningKey: string | null }>(IPC.blocker.saveRule, r),
  deleteRule: (id: string) => invoke<void>(IPC.blocker.deleteRule, id),
  requestUnlock: () => invoke<BlockerStatus>(IPC.blocker.requestUnlock),
  confirmUnlock: (phrase: string) => invoke<BlockerStatus>(IPC.blocker.confirmUnlock, phrase),
  recheck: () => invoke<BlockerStatus>(IPC.blocker.recheck),
  onStatus: (cb: (s: BlockerStatus) => void) => subscribe(IPC.blocker.statusChanged, cb),
};
