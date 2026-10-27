// Модуль blocker: BlockerController + PacServer + SystemProxy (Windows), IPC, связь с таймером,
// планировщик расписаний, восстановление при запуске, снятие при выходе и по --cleanup (деинсталлятор).
import { app, BrowserWindow } from 'electron';
import { translate } from '../../shared/i18n';
import { ru } from '../../shared/i18n/ru';
import { en } from '../../shared/i18n/en';
import { IPC } from '../../shared/ipc';
import type { BlockContext, BlockRule } from '../../shared/types';
import type { MainContext } from '../context';
import { handle } from '../ipc';
import { v, type Check } from '../validate';
import { blockedPageHtml } from './blockedPage';
import { BlockerController, STRICT_LOCKED_KEY, type BlockerStore } from './BlockerController';
import { normalizeDomain } from './domain';
import { PacServer } from './PacServer';
import { createWindowsSystemProxy, releaseOurPacSync, type ProxySettings, type SystemProxy } from './SystemProxy';

declare module '../context' {
  interface Services {
    blocker: BlockerController;
  }
}

/** Ключи kv: исходные настройки прокси (до первого изменения) и время согласия (§4.8.1). */
export const SNAPSHOT_KEY = 'blocker.proxySnapshot';
export const CONSENT_KEY = 'blocker.consentAt';

/** Аргумент командной строки деинсталлятора: вернуть настройки прокси и выйти. */
export const CLEANUP_ARG = '--cleanup';

const hhmm = v.str({ pattern: /^([01]\d|2[0-3]):[0-5]\d$/ });
/** Правило из окна: pattern — как ввёл пользователь (нормализуется здесь). */
const isRuleInput: Check = v.object({
  id: v.id(),
  pattern: v.str({ min: 1, max: 2000 }),
  category: v.oneOf('social', 'video', 'messenger', 'news', 'entertainment', 'custom'),
  enabled: v.bool(),
  duringFocus: v.bool(),
  duringShortBreak: v.bool(),
  duringLongBreak: v.bool(),
  schedule: v.nullable(v.object({ days: v.array(v.int(0, 6), { max: 7 }), from: hhmm, to: hhmm })),
  builtin: v.bool(),
} satisfies Record<keyof BlockRule, Check>);

/** Ошибка правила для окна: message — i18n-ключ причины. */
export class BlockRuleError extends Error {
  constructor(public readonly reasonKey: string) {
    super(reasonKey);
    this.name = 'BlockRuleError';
  }
}

/** Strict во время сессии: изменение сняло бы блокировку (§4.7). message — i18n-ключ. */
export class StrictLockedError extends Error {
  constructor() {
    super(STRICT_LOCKED_KEY);
    this.name = 'StrictLockedError';
  }
}

const unsupportedProxy: SystemProxy = {
  read: () => Promise.reject(new Error('system proxy is supported on Windows only')),
  apply: () => Promise.reject(new Error('system proxy is supported on Windows only')),
  restore: () => Promise.reject(new Error('system proxy is supported on Windows only')),
  resolveProxyFor: () => Promise.reject(new Error('system proxy is supported on Windows only')),
};

export async function registerBlocker(ctx: MainContext): Promise<void> {
  const { storage, settings, logger } = ctx;
  const onError = (message: string, err?: unknown) => logger.error('blocker', message, err);

  const store: BlockerStore = {
    rules: () => storage.blockRules.list(),
    getSnapshot: () => storage.kv.get<ProxySettings>(SNAPSHOT_KEY),
    setSnapshot: (s) => storage.kv.set(SNAPSHOT_KEY, s),
    clearSnapshot: () => storage.kv.delete(SNAPSHOT_KEY),
    consentGiven: () => storage.kv.get<number>(CONSENT_KEY) !== null,
  };

  const pac = new PacServer({
    blockedPage: () => {
      const lang = settings.get().general.language;
      return blockedPageHtml({
        lang,
        title: translate(lang, 'blocker.blockedPage.title'),
        body: translate(lang, 'blocker.blockedPage.body'),
      });
    },
    onError,
  });

  const controller = new BlockerController({
    proxy: process.platform === 'win32' ? createWindowsSystemProxy() : unsupportedProxy,
    pac,
    store,
    now: () => Date.now(),
    settings: () => settings.get(),
    unlockPhrases: [ru.blocker.strict.phrase, en.blocker.strict.phrase],
    onError,
    onFailure: (reasonKey) => notifyFailure(reasonKey),
  });
  ctx.services.blocker = controller;

  /** Уведомление «Ошибка блокировки» — через Notifier (Т07): он сам смотрит notifications.*. */
  function notifyFailure(reasonKey: string): void {
    const notifier = ctx.services.notifier;
    if (notifier) notifier.notify('blockerError', { reasonKey });
    else logger.warn('blocker', `failure not notified (notify module is down): ${reasonKey}`);
  }

  /** Контекст блокировки из текущего снимка таймера и настроек. */
  const currentContext = (): BlockContext => {
    const snap = ctx.services.timer?.snapshot();
    const s = settings.get();
    const status = snap?.status ?? 'idle';
    return {
      timerKind: snap && (status === 'running' || status === 'paused') ? snap.kind : null,
      timerStatus: status,
      now: Date.now(),
      scheduledEnabled: s.blocker.scheduledEnabled,
      keepBlockingOnPause: s.timer.keepBlockingOnPause,
    };
  };
  const reapply = () => void controller.applyFor(currentContext());

  // ── деинсталлятор: DeepFocus.exe --cleanup → вернуть настройки и выйти ──
  if (process.argv.includes(CLEANUP_ARG)) {
    await controller.restoreOnStartup();
    await pac.stop();
    logger.info('blocker', 'cleanup requested: proxy settings restored');
    app.exit(0);
    return;
  }

  controller.on('status', (s) => ctx.broadcast(IPC.blocker.statusChanged, s));

  // Хвост прошлого сбоя чинится первым (очередь контроллера), затем — блокировка по текущему состоянию.
  void controller.restoreOnStartup();
  reapply();

  ctx.services.timer?.on('state', reapply);
  settings.on('change', (next, prev) => {
    if (
      JSON.stringify(next.blocker) !== JSON.stringify(prev.blocker) ||
      next.timer.keepBlockingOnPause !== prev.timer.keepBlockingOnPause
    ) {
      reapply();
    }
  });

  // Расписания: пересчёт в начале каждой минуты.
  let minuteTimer: NodeJS.Timeout | null = null;
  const scheduleNextMinute = () => {
    minuteTimer = setTimeout(() => {
      reapply();
      scheduleNextMinute();
    }, 60_000 - (Date.now() % 60_000) + 50);
    minuteTimer.unref();
  };
  scheduleNextMinute();

  // Выход из приложения всегда снимает блокировку (§4.7, §4.12).
  let cleanedUp = false;
  app.on('will-quit', (event) => {
    if (minuteTimer) clearTimeout(minuteTimer);
    if (cleanedUp) return;
    if (!store.getSnapshot()) {
      cleanedUp = true;
      void pac.stop();
      return;
    }
    event.preventDefault();
    const limit = new Promise<void>((resolve) => setTimeout(resolve, 15_000));
    void Promise.race([controller.cleanup(), limit]).finally(() => {
      cleanedUp = true;
      app.quit();
    });
  });
  // Выключение или выход из Windows: will-quit может не наступить, а наш адрес PAC в HKCU остался бы
  // висеть (порт потом может занять чужой процесс). Снимаем его синхронно — только если он наш.
  let sessionEnded = false;
  const onSessionEnd = () => {
    if (sessionEnded || process.platform !== 'win32') return;
    sessionEnded = true;
    if (minuteTimer) clearTimeout(minuteTimer);
    try {
      const released = releaseOurPacSync(store.getSnapshot());
      store.clearSnapshot();
      cleanedUp = true;
      logger.info('blocker', released ? 'session end: proxy settings restored' : 'session end: nothing of ours in proxy settings');
    } catch (err) {
      // снимок остаётся — restoreOnStartup вернёт настройки при следующем запуске
      logger.error('blocker', 'session end: restoring proxy settings failed', err);
    }
  };
  for (const win of BrowserWindow.getAllWindows()) win.on('session-end', onSessionEnd);
  app.on('browser-window-created', (_event, win) => win.on('session-end', onSessionEnd));

  // Деинсталлятор при запущенном приложении: второй экземпляр с --cleanup.
  app.on('second-instance', (_event, argv) => {
    if (!argv.includes(CLEANUP_ARG)) return;
    void controller.cleanup().finally(() => app.quit());
  });

  // ── IPC ──
  handle<[]>(IPC.blocker.status, [], () => controller.status());
  handle<[]>(IPC.blocker.rules, [], () => storage.blockRules.list());
  handle<[BlockRule]>(IPC.blocker.saveRule, [isRuleInput], (input) => {
    const n = normalizeDomain(input.pattern);
    if (!n.ok) throw new BlockRuleError(n.reasonKey);
    const existing = storage.blockRules.get(input.id);
    const duplicate = storage.blockRules.list().find((r) => r.id !== input.id && r.pattern === n.domain);
    if (duplicate) throw new BlockRuleError('blocker.invalid.duplicate');
    const rule: BlockRule = { ...input, pattern: n.domain, builtin: existing?.builtin ?? false };
    if (rule.builtin && existing && existing.pattern !== rule.pattern) throw new BlockRuleError('blocker.invalid.builtinPattern');
    const list = storage.blockRules.list();
    const next = existing ? list.map((r) => (r.id === rule.id ? rule : r)) : [...list, rule];
    if (!controller.allowsRules(next)) throw new BlockRuleError(STRICT_LOCKED_KEY);
    storage.blockRules.upsert(rule);
    reapply();
    return { rule, warningKey: n.warningKey };
  });
  handle<[string]>(IPC.blocker.deleteRule, [v.id()], (id) => {
    const existing = storage.blockRules.get(id);
    if (existing?.builtin) throw new BlockRuleError('blocker.invalid.builtinDelete');
    if (!controller.allowsRules(storage.blockRules.list().filter((r) => r.id !== id))) throw new BlockRuleError(STRICT_LOCKED_KEY);
    storage.blockRules.remove(id);
    reapply();
  });
  handle<[]>(IPC.blocker.requestUnlock, [], () => controller.requestUnlock());
  handle<[string]>(IPC.blocker.confirmUnlock, [v.str({ max: 500 })], (phrase) => controller.confirmUnlock(phrase));
  handle<[]>(IPC.blocker.recheck, [], () => controller.recheck(currentContext()));
  handle<[]>(IPC.blocker.giveConsent, [], async () => {
    if (!store.consentGiven()) storage.kv.set(CONSENT_KEY, Date.now());
    if (!settings.get().blocker.enabled) settings.patch({ blocker: { enabled: true } });
    return controller.applyFor(currentContext());
  });
}
