// BlockerController — единственный владелец блокировки: правила → домены → PAC → системный прокси
// пользователя (HKCU) → проверка. Без Electron: зависимости приходят снаружи (фейки в тестах).
//
// Гарантии:
//  • без включённой функции и согласия (§4.8.1) реестр не трогается;
//  • исходные значения прокси сохраняются в БД ДО первого изменения и возвращаются ровно такими;
//  • статус 'active' — только после проверки: сервер отдаёт PAC, значение записалось, системное
//    разрешение прокси для заблокированного домена указывает на заглушку; иначе 'error' с причиной;
//  • ни один метод не бросает наружу — сбой блокировки не трогает таймер и звук (§4.15).
import type { AppSettings, BlockContext, BlockerStatus, BlockRule } from '../../shared/types';
import { TypedEmitter } from '../events';
import { buildPac, type Upstream } from './pac';
import { isOurPacUrl } from './PacServer';
import { activeDomainsFor, activeRulesFor } from './rules';
import type { ProxySettings, SystemProxy } from './SystemProxy';

export interface BlockerStore {
  rules(): BlockRule[];
  getSnapshot(): ProxySettings | null;
  setSnapshot(s: ProxySettings): void;
  clearSnapshot(): void;
  consentGiven(): boolean;
}

/** Локальный сервер PAC/заглушки (PacServer в приложении). */
export interface PacHost {
  start(): Promise<number>;
  setPac(text: string): void;
  pacUrl(version: number): string;
  selfCheck(): Promise<boolean>;
  stop(): Promise<void>;
}

export interface BlockerDeps {
  proxy: SystemProxy;
  pac: PacHost;
  store: BlockerStore;
  now(): number;
  settings(): { blocker: AppSettings['blocker'] };
  /** Фразы снятия Strict (на всех языках); сравнение без регистра и лишних пробелов. */
  unlockPhrases: string[];
  onError?(message: string, err?: unknown): void;
  /** Блокировка не заработала: уведомление «Ошибка блокировки» (вызывается на переходе в error). */
  onFailure?(reasonKey: string): void;
}

export const REASON = {
  needsConsent: 'blocker.reason.needsConsent',
  pausedByUser: 'blocker.reason.pausedByUser',
  foreignPac: 'blocker.reason.foreignPac',
  serverDown: 'blocker.reason.serverDown',
  registryNotWritten: 'blocker.reason.registryNotWritten',
  notApplied: 'blocker.reason.notApplied',
  applyFailed: 'blocker.reason.applyFailed',
  restoreFailed: 'blocker.reason.restoreFailed',
} as const;

const samePhrase = (a: string, b: string) =>
  a.trim().replace(/\s+/g, ' ').toLocaleLowerCase() === b.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

const inSession = (ctx: BlockContext | null) =>
  ctx !== null && ctx.timerKind !== null && (ctx.timerStatus === 'running' || ctx.timerStatus === 'paused');

function upstreamOf(s: ProxySettings): Upstream {
  if (s.proxyEnable === 1 && s.proxyServer) {
    return { type: 'proxy', server: s.proxyServer, bypass: (s.proxyOverride ?? '').split(';').filter(Boolean) };
  }
  return { type: 'direct' };
}

class VerifyError extends Error {
  constructor(public readonly reasonKey: string) {
    super(reasonKey);
  }
}

export class BlockerController extends TypedEmitter<{ status: (s: BlockerStatus) => void }> {
  private current: BlockerStatus;
  private lastCtx: BlockContext | null = null;
  /** Наш PAC сейчас в реестре: для каких доменов. */
  private applied: { domains: string[] } | null = null;
  /** Пользователь снял блокировку до конца текущего периода блокировки. */
  private override = false;
  private unlockAvailableAt: number | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: BlockerDeps) {
    super();
    this.current = this.make('off', null);
  }

  status(): BlockerStatus {
    return this.current;
  }

  /** Пересчитать и применить блокировку для контекста таймера/расписания. */
  applyFor(ctx: BlockContext): Promise<BlockerStatus> {
    return this.serial(async () => {
      this.lastCtx = ctx;
      await this.reconcile(false);
      return this.current;
    });
  }

  /** Снять всё и вернуть исходные настройки (функция выключена). */
  deactivate(): Promise<BlockerStatus> {
    return this.serial(async () => {
      if (await this.release()) this.set(this.make('off', null));
      return this.current;
    });
  }

  /**
   * «Выключить блокировку». Standard или вне сессии — сразу, до конца текущего периода.
   * Strict во время сессии — запускает ожидание strictUnlockDelaySec; снять можно через confirmUnlock.
   */
  requestUnlock(): Promise<BlockerStatus> {
    return this.serial(async () => {
      if (!this.current.strictLocked) {
        this.override = true;
        await this.reconcile(false);
      } else if (this.unlockAvailableAt === null) {
        this.unlockAvailableAt = this.deps.now() + this.deps.settings().blocker.strictUnlockDelaySec * 1000;
        this.set({ ...this.current, unlockAvailableAt: this.unlockAvailableAt });
      }
      return this.current;
    });
  }

  confirmUnlock(phrase: string): Promise<BlockerStatus> {
    return this.serial(async () => {
      if (this.current.strictLocked) {
        const ready = this.unlockAvailableAt !== null && this.deps.now() >= this.unlockAvailableAt;
        if (!ready || !this.deps.unlockPhrases.some((p) => samePhrase(p, phrase))) return this.current;
      }
      this.override = true;
      this.unlockAvailableAt = null;
      await this.reconcile(false);
      return this.current;
    });
  }

  /** Перепроверить механизм; после сбоя — попробовать включить снова. */
  recheck(ctx?: BlockContext): Promise<BlockerStatus> {
    return this.serial(async () => {
      if (ctx) this.lastCtx = ctx;
      await this.reconcile(true);
      return this.current;
    });
  }

  /** При запуске: если прошлый запуск упал с включённой блокировкой — вернуть исходные настройки. */
  restoreOnStartup(): Promise<void> {
    return this.serial(async () => {
      try {
        const snap = this.deps.store.getSnapshot();
        if (snap) {
          await this.restoreTo(snap);
          return;
        }
        const cur = await this.deps.proxy.read();
        if (cur.autoConfigUrl && isOurPacUrl(cur.autoConfigUrl)) {
          await this.deps.proxy.restore({ ...cur, autoConfigUrl: null });
        }
      } catch (err) {
        this.deps.onError?.('restore on startup failed', err);
      }
    });
  }

  /** Выход из приложения и деинсталлятор (--cleanup): снять блокировку, вернуть всё, остановить сервер. */
  cleanup(): Promise<void> {
    return this.serial(async () => {
      this.override = false;
      this.unlockAvailableAt = null;
      const restored = await this.release();
      await this.deps.pac.stop().catch((err: unknown) => this.deps.onError?.('pac server stop failed', err));
      if (restored) this.set(this.make('off', null));
    });
  }

  // ── внутреннее ──────────────────────────────────────────────────────────

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run.catch((err: unknown) => {
      this.deps.onError?.('blocker operation failed', err);
      return this.current as T;
    });
  }

  private async reconcile(force: boolean): Promise<void> {
    const ctx = this.lastCtx;
    const { blocker } = this.deps.settings();
    const consent = this.deps.store.consentGiven();
    if (!ctx || !blocker.enabled || !consent) {
      this.override = false;
      this.unlockAvailableAt = null;
      if (await this.release()) this.set(this.make('off', blocker.enabled && !consent ? REASON.needsConsent : null));
      return;
    }

    const rules = this.deps.store.rules();
    const domains = activeDomainsFor(rules, ctx);
    const ruleIds = activeRulesFor(rules, ctx).map((r) => r.id);

    if (domains.length === 0) {
      // период блокировки кончился: снятие пользователем и ожидание Strict больше не действуют
      this.override = false;
      this.unlockAvailableAt = null;
      if (await this.release()) this.set(this.make('off', null));
      return;
    }
    if (this.override) {
      if (await this.release()) this.set(this.make('off', REASON.pausedByUser));
      return;
    }

    const strictLocked = blocker.level === 'strict' && inSession(ctx);
    const unchanged =
      this.applied !== null && this.current.state === 'active' && this.applied.domains.join('\n') === domains.join('\n');
    if (unchanged && !force) {
      this.set({ ...this.current, activeRuleIds: ruleIds, strictLocked, unlockAvailableAt: strictLocked ? this.unlockAvailableAt : null });
      return;
    }
    await this.engage(domains, ruleIds, strictLocked);
  }

  private async engage(domains: string[], ruleIds: string[], strictLocked: boolean): Promise<void> {
    const { proxy, pac, store } = this.deps;
    try {
      let snap = store.getSnapshot();
      if (!snap) {
        const cur = await proxy.read();
        if (cur.autoConfigUrl && !isOurPacUrl(cur.autoConfigUrl)) {
          this.set({ ...this.make('unavailable', REASON.foreignPac), activeDomains: domains, activeRuleIds: ruleIds });
          return;
        }
        // наш PAC без снимка — хвост сбоя с потерянным снимком: исходно PAC не было
        snap = cur.autoConfigUrl ? { ...cur, autoConfigUrl: null } : cur;
        store.setSnapshot(snap); // до первого изменения
      }

      const port = await pac.start();
      pac.setPac(buildPac(domains, upstreamOf(snap), port));
      const url = pac.pacUrl(this.deps.now());
      this.applied = { domains };
      await proxy.apply(url);

      if (!(await pac.selfCheck())) throw new VerifyError(REASON.serverDown);
      if ((await proxy.read()).autoConfigUrl !== url) throw new VerifyError(REASON.registryNotWritten);
      const resolved = await proxy.resolveProxyFor(`https://${domains[0]}/`);
      if (resolved.replace(/\/$/, '') !== `http://127.0.0.1:${port}`) throw new VerifyError(REASON.notApplied);

      this.set({
        state: 'active',
        reasonKey: null,
        activeDomains: domains,
        activeRuleIds: ruleIds,
        verifiedAt: this.deps.now(),
        strictLocked,
        unlockAvailableAt: strictLocked ? this.unlockAvailableAt : null,
        consentGiven: true,
      });
    } catch (err) {
      const reasonKey = err instanceof VerifyError ? err.reasonKey : REASON.applyFailed;
      this.deps.onError?.(`blocking failed: ${reasonKey}`, err instanceof VerifyError ? undefined : err);
      // никакого ложного 'active': возвращаем всё как было
      if (await this.release()) this.fail(reasonKey, domains, ruleIds);
    }
  }

  /**
   * Убрать наш PAC и вернуть исходное (если мы что-то меняли). Без снимка — ничего не трогаем.
   * false — вернуть не удалось: статус error, снимок остаётся для следующей попытки.
   */
  private async release(): Promise<boolean> {
    this.applied = null;
    const snap = this.deps.store.getSnapshot();
    if (!snap) return true;
    try {
      await this.restoreTo(snap);
      return true;
    } catch (err) {
      this.deps.onError?.('restore failed', err);
      this.fail(REASON.restoreFailed, [], []);
      return false;
    }
  }

  private async restoreTo(snap: ProxySettings): Promise<void> {
    await this.deps.proxy.restore(snap);
    const after = await this.deps.proxy.read();
    if (after.autoConfigUrl !== snap.autoConfigUrl) throw new Error('AutoConfigURL was not restored');
    this.deps.store.clearSnapshot();
  }

  private fail(reasonKey: string, domains: string[], ruleIds: string[]): void {
    const isNew = this.current.state !== 'error' || this.current.reasonKey !== reasonKey;
    this.set({ ...this.make('error', reasonKey), activeDomains: domains, activeRuleIds: ruleIds });
    if (isNew) this.deps.onFailure?.(reasonKey);
  }

  private make(state: BlockerStatus['state'], reasonKey: string | null): BlockerStatus {
    return {
      state,
      reasonKey,
      activeDomains: [],
      activeRuleIds: [],
      verifiedAt: null,
      strictLocked: false,
      unlockAvailableAt: null,
      consentGiven: this.deps.store.consentGiven(),
    };
  }

  private set(next: BlockerStatus): void {
    const changed = JSON.stringify(next) !== JSON.stringify(this.current);
    this.current = next;
    if (changed) this.emit('status', next);
  }

  protected override onListenerError(err: unknown): void {
    this.deps.onError?.('status listener failed', err);
  }
}
