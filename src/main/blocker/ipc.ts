// ЗАГЛУШКА Т01 → заполняет Т04 (BlockerController + PacServer + SystemProxy).
// Пока ничего не трогает в системе: статус всегда 'off'.
import { IPC } from '../../shared/ipc';
import type { BlockerStatus, BlockRule } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { isBlockRule } from '../settings/schema';
import { v } from '../validate';

const offStatus = (): BlockerStatus => ({
  state: 'off',
  reasonKey: null,
  activeDomains: [],
  activeRuleIds: [],
  verifiedAt: null,
  strictLocked: false,
  unlockAvailableAt: null,
});

export function registerBlocker(ctx: MainContext): void {
  const { storage } = ctx;
  handle<[]>(IPC.blocker.status, [], offStatus);
  handle<[]>(IPC.blocker.rules, [], () => storage.blockRules.list());
  handle<[BlockRule]>(IPC.blocker.saveRule, [isBlockRule], (rule) => {
    storage.blockRules.upsert(rule);
    return { rule, warningKey: null };
  });
  handle<[string]>(IPC.blocker.deleteRule, [v.id()], (id) => {
    storage.blockRules.remove(id);
  });
  handle<[]>(IPC.blocker.requestUnlock, [], offStatus);
  handle<[string]>(IPC.blocker.confirmUnlock, [v.str({ max: 500 })], offStatus);
  handle<[]>(IPC.blocker.recheck, [], offStatus);
}
