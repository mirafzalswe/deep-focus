import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../shared/defaults';
import type { AppSettings, BlockContext, BlockerStatus, BlockRule } from '../../shared/types';
import { translateDynamic } from '../../shared/i18n';
import { BlockerController, STRICT_LOCKED_KEY, type BlockerStore, type PacHost } from './BlockerController';
import type { ProxySettings, SystemProxy } from './SystemProxy';

const ORIGINAL: ProxySettings = {
  proxyEnable: 0,
  proxyServer: null,
  proxyOverride: null,
  autoConfigUrl: null,
  defaultConnectionSettings: '4600000003000000010000000000',
  savedLegacySettings: '4600000003000000010000000000',
};

const rule = (pattern: string, patch: Partial<BlockRule> = {}): BlockRule => ({
  id: `r:${pattern}`,
  pattern,
  category: 'custom',
  enabled: true,
  duringFocus: true,
  duringShortBreak: false,
  duringLongBreak: false,
  schedule: null,
  builtin: false,
  ...patch,
});

const T0 = new Date(2026, 9, 26, 10, 0).getTime();
const focus = (patch: Partial<BlockContext> = {}): BlockContext => ({
  timerKind: 'focus',
  timerStatus: 'running',
  now: T0,
  scheduledEnabled: false,
  keepBlockingOnPause: true,
  ...patch,
});
const idle = (): BlockContext => focus({ timerKind: null, timerStatus: 'idle' });

function setup(opts: { registry?: Partial<ProxySettings>; rules?: BlockRule[]; consent?: boolean; blocker?: Partial<AppSettings['blocker']> } = {}) {
  const log: string[] = [];
  const registry: ProxySettings = { ...ORIGINAL, ...opts.registry };
  let clock = T0;
  const fake = {
    resolve: null as null | ((url: string) => string),
    selfCheck: true,
    applyError: null as Error | null,
    restoreError: null as Error | null,
  };
  const proxy: SystemProxy = {
    async read() {
      log.push('read');
      return { ...registry };
    },
    async apply(url) {
      log.push('apply');
      if (fake.applyError) throw fake.applyError;
      registry.autoConfigUrl = url;
      // WinINET переписывает двоичные настройки сам
      registry.defaultConnectionSettings = 'changed-by-wininet';
    },
    async restore(saved) {
      log.push('restore');
      if (fake.restoreError) throw fake.restoreError;
      Object.assign(registry, saved);
    },
    async resolveProxyFor(url) {
      log.push('resolve');
      if (fake.resolve) return fake.resolve(url);
      const m = /^http:\/\/127\.0\.0\.1:(\d+)\//.exec(registry.autoConfigUrl ?? '');
      return m ? `http://127.0.0.1:${m[1]}/` : url;
    },
  };
  let pacText = '';
  let running = false;
  const pac: PacHost = {
    async start() {
      running = true;
      return 5555;
    },
    setPac: (t) => void (pacText = t),
    pacUrl: (v) => `http://127.0.0.1:5555/deep-focus.pac?v=${v}`,
    selfCheck: async () => running && fake.selfCheck,
    async stop() {
      running = false;
    },
  };
  const kv = new Map<string, unknown>();
  if (opts.consent !== false) kv.set('consent', T0);
  const store: BlockerStore = {
    rules: () => opts.rules ?? [rule('youtube.com'), rule('reddit.com', { duringShortBreak: true })],
    getSnapshot: () => (kv.get('snap') as ProxySettings | undefined) ?? null,
    setSnapshot: (s) => {
      log.push('saveSnapshot');
      kv.set('snap', s);
    },
    clearSnapshot: () => void kv.delete('snap'),
    consentGiven: () => kv.has('consent'),
  };
  const settings = { blocker: { ...DEFAULT_SETTINGS.blocker, enabled: true, ...opts.blocker } };
  const failures: string[] = [];
  const controller = new BlockerController({
    proxy,
    pac,
    store,
    now: () => clock,
    settings: () => settings,
    unlockPhrases: ['Я хочу отвлечься', 'I want to be distracted'],
    onFailure: (reasonKey) => failures.push(reasonKey),
  });
  const statuses: BlockerStatus[] = [];
  controller.on('status', (s) => statuses.push(s));
  return {
    controller,
    registry,
    log,
    kv,
    fake,
    failures,
    statuses,
    settings,
    pacText: () => pacText,
    tick: (ms: number) => (clock += ms),
  };
}

describe('BlockerController', () => {
  it('выключено или нет согласия — реестр не трогается вовсе (§4.8.1)', async () => {
    const off = setup({ blocker: { enabled: false } });
    expect((await off.controller.applyFor(focus())).state).toBe('off');
    expect(off.log).toEqual([]);

    const noConsent = setup({ consent: false });
    const s = await noConsent.controller.applyFor(focus());
    expect(s).toMatchObject({ state: 'off', reasonKey: 'blocker.reason.needsConsent' });
    expect(noConsent.log).toEqual([]);
  });

  it('Focus: исходное сохраняется в БД до первого изменения, затем PAC, проверка → active', async () => {
    const t = setup();
    const s = await t.controller.applyFor(focus());
    expect(t.log.indexOf('saveSnapshot')).toBeGreaterThanOrEqual(0);
    expect(t.log.indexOf('saveSnapshot')).toBeLessThan(t.log.indexOf('apply'));
    expect(t.kv.get('snap')).toEqual(ORIGINAL);
    expect(t.registry.autoConfigUrl).toBe(`http://127.0.0.1:5555/deep-focus.pac?v=${T0}`);
    expect(s).toEqual({
      state: 'active',
      reasonKey: null,
      activeDomains: ['reddit.com', 'youtube.com'],
      activeRuleIds: ['r:youtube.com', 'r:reddit.com'],
      verifiedAt: T0,
      strictLocked: false,
      unlockAvailableAt: null,
      consentGiven: true,
    });
    expect(t.pacText()).toContain('"youtube.com"');
    expect(t.controller.status()).toEqual(s);
    expect(t.statuses.at(-1)).toEqual(s);
  });

  it('системное разрешение прокси не указывает на заглушку → error с причиной и уведомлением, не active; всё возвращено (§4.11)', async () => {
    const t = setup();
    t.fake.resolve = (url) => url;
    const s = await t.controller.applyFor(focus());
    expect(s).toMatchObject({ state: 'error', reasonKey: 'blocker.reason.notApplied', verifiedAt: null });
    expect(t.statuses.some((x) => x.state === 'active')).toBe(false);
    expect(t.failures).toEqual(['blocker.reason.notApplied']);
    expect(t.registry).toEqual(ORIGINAL);
    expect(t.kv.has('snap')).toBe(false);
  });

  it('сервер не отдаёт PAC → error serverDown', async () => {
    const t = setup();
    t.fake.selfCheck = false;
    const s = await t.controller.applyFor(focus());
    expect(s).toMatchObject({ state: 'error', reasonKey: 'blocker.reason.serverDown' });
    expect(t.registry).toEqual(ORIGINAL);
  });

  it('сбой записи → error, исключение не выходит наружу (таймер не страдает, §4.15)', async () => {
    const t = setup();
    t.fake.applyError = new Error('reg.exe failed');
    await expect(t.controller.applyFor(focus())).resolves.toMatchObject({ state: 'error', reasonKey: 'blocker.reason.applyFailed' });
    expect(t.failures).toEqual(['blocker.reason.applyFailed']);
    expect(t.registry).toEqual(ORIGINAL);
  });

  it('чужой AutoConfigURL (корпоративный PAC) → unavailable, ничего не меняется (§4.13)', async () => {
    const t = setup({ registry: { autoConfigUrl: 'http://wpad.corp/wpad.dat' } });
    const s = await t.controller.applyFor(focus());
    expect(s).toMatchObject({ state: 'unavailable', reasonKey: 'blocker.reason.foreignPac' });
    expect(t.log).not.toContain('apply');
    expect(t.log).not.toContain('restore');
    expect(t.kv.has('snap')).toBe(false);
    expect(t.registry.autoConfigUrl).toBe('http://wpad.corp/wpad.dat');
  });

  it('VPN/пользователь поставил свой PAC во время сессии → конец сессии не трогает ни его, ни двоичные настройки; снимок снят (§4.12)', async () => {
    const t = setup();
    expect((await t.controller.applyFor(focus())).state).toBe('active');
    t.registry.autoConfigUrl = 'http://vpn.corp/proxy.pac';
    t.registry.defaultConnectionSettings = 'VPN';
    t.log.length = 0;
    const s = await t.controller.applyFor(idle());
    expect(s.state).toBe('off');
    expect(t.registry.autoConfigUrl).toBe('http://vpn.corp/proxy.pac');
    expect(t.registry.defaultConnectionSettings).toBe('VPN');
    expect(t.log).not.toContain('restore');
    expect(t.kv.has('snap')).toBe(false);
  });

  it('смена правил при чужом PAC поверх нашего (снимок есть) → unavailable/foreignPac, чужой PAC не перезаписан (§4.13)', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    t.registry.autoConfigUrl = 'http://vpn.corp/proxy.pac';
    t.log.length = 0;
    const s = await t.controller.applyFor(focus({ timerKind: 'shortBreak' }));
    expect(s).toMatchObject({ state: 'unavailable', reasonKey: 'blocker.reason.foreignPac' });
    expect(t.registry.autoConfigUrl).toBe('http://vpn.corp/proxy.pac');
    expect(t.log).not.toContain('apply');
    expect(t.log).not.toContain('restore');
    expect(t.kv.has('snap')).toBe(false);
  });

  it('restoreOnStartup: снимок есть, но в реестре уже чужой PAC → ничего не пишется, снимок снят', async () => {
    const t = setup({ registry: { autoConfigUrl: 'http://vpn.corp/proxy.pac', defaultConnectionSettings: 'VPN' } });
    t.kv.set('snap', ORIGINAL);
    await t.controller.restoreOnStartup();
    expect(t.registry.autoConfigUrl).toBe('http://vpn.corp/proxy.pac');
    expect(t.registry.defaultConnectionSettings).toBe('VPN');
    expect(t.log).not.toContain('restore');
    expect(t.kv.has('snap')).toBe(false);
  });

  it('ручной ProxyServer пользователя остаётся для прочих сайтов', async () => {
    const t = setup({ registry: { proxyEnable: 1, proxyServer: 'proxy.corp:3128', proxyOverride: '<local>' } });
    expect((await t.controller.applyFor(focus())).state).toBe('active');
    expect(t.pacText()).toContain('PROXY proxy.corp:3128');
    expect(t.registry.proxyServer).toBe('proxy.corp:3128');
  });

  it('Focus → перерыв → конец: правила переключаются, затем исходные настройки возвращаются ровно (§4.9)', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    const brk = await t.controller.applyFor(focus({ timerKind: 'shortBreak' }));
    expect(brk).toMatchObject({ state: 'active', activeDomains: ['reddit.com'] });
    expect(t.pacText()).not.toContain('"youtube.com"');

    const end = await t.controller.applyFor(idle());
    expect(end).toMatchObject({ state: 'off', activeDomains: [], activeRuleIds: [] });
    expect(t.registry).toEqual(ORIGINAL);
    expect(t.kv.has('snap')).toBe(false);
  });

  it('повторный applyFor с тем же набором доменов не переписывает реестр', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    const applies = t.log.filter((x) => x === 'apply').length;
    await t.controller.applyFor(focus({ timerStatus: 'paused' }));
    expect(t.log.filter((x) => x === 'apply').length).toBe(applies);
  });

  it('pattern из базы с мусором не попадает в PAC', async () => {
    const t = setup({ rules: [rule('youtube.com'), rule('x"; return "DIRECT', { id: 'inj' }), rule('*', { id: 'star' })] });
    const s = await t.controller.applyFor(focus());
    expect(s.activeDomains).toEqual(['youtube.com']);
    expect(t.pacText()).not.toContain('return "DIRECT";\n  var');
    expect(t.pacText()).not.toContain('x\\"');
  });

  it('restoreOnStartup: прошлый запуск упал с включённой блокировкой → исходное возвращено', async () => {
    const t = setup({ registry: { autoConfigUrl: 'http://127.0.0.1:4444/deep-focus.pac?v=1', defaultConnectionSettings: 'x' } });
    t.kv.set('snap', ORIGINAL);
    await t.controller.restoreOnStartup();
    expect(t.registry).toEqual(ORIGINAL);
    expect(t.kv.has('snap')).toBe(false);
  });

  it('restoreOnStartup: наш PAC без снимка (снимок потерян) → AutoConfigURL удаляется; чужой не трогается', async () => {
    const t = setup({ registry: { autoConfigUrl: 'http://127.0.0.1:4444/deep-focus.pac?v=1' } });
    await t.controller.restoreOnStartup();
    expect(t.registry.autoConfigUrl).toBeNull();

    const foreign = setup({ registry: { autoConfigUrl: 'http://wpad.corp/wpad.dat' } });
    await foreign.controller.restoreOnStartup();
    expect(foreign.registry.autoConfigUrl).toBe('http://wpad.corp/wpad.dat');
    expect(foreign.log).not.toContain('restore');
  });

  it('cleanup (выход, деинсталлятор) снимает блокировку и возвращает исходное', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    await t.controller.cleanup();
    expect(t.registry).toEqual(ORIGINAL);
    expect(t.controller.status().state).toBe('off');
  });

  it('Standard: «Выключить блокировку» снимает сразу и до конца текущей сессии (§4.6)', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    const s = await t.controller.requestUnlock();
    expect(s).toMatchObject({ state: 'off', reasonKey: 'blocker.reason.pausedByUser' });
    expect(t.registry).toEqual(ORIGINAL);
    // в той же сессии не включается обратно
    expect((await t.controller.applyFor(focus({ timerStatus: 'paused' }))).state).toBe('off');
    // сессия кончилась → следующая блокирует снова
    await t.controller.applyFor(idle());
    expect((await t.controller.applyFor(focus())).state).toBe('active');
  });

  it('Strict: ожидание strictUnlockDelaySec + фраза; до этого блокировка держится (§4.7)', async () => {
    const t = setup({ blocker: { level: 'strict', strictUnlockDelaySec: 60 } });
    const on = await t.controller.applyFor(focus());
    expect(on).toMatchObject({ state: 'active', strictLocked: true, unlockAvailableAt: null });

    const req = await t.controller.requestUnlock();
    expect(req).toMatchObject({ state: 'active', strictLocked: true, unlockAvailableAt: T0 + 60_000 });
    // повторный запрос не сдвигает время
    t.tick(10_000);
    expect((await t.controller.requestUnlock()).unlockAvailableAt).toBe(T0 + 60_000);

    expect((await t.controller.confirmUnlock('Я хочу отвлечься')).state).toBe('active'); // рано
    t.tick(50_000);
    expect((await t.controller.confirmUnlock('не та фраза')).state).toBe('active');
    const off = await t.controller.confirmUnlock('  я хочу ОТВЛЕЧЬСЯ ');
    expect(off).toMatchObject({ state: 'off', strictLocked: false, unlockAvailableAt: null });
    expect(t.registry).toEqual(ORIGINAL);
  });

  it('Strict во время сессии: правила и настройки, снимающие блокировку, отклоняются (§4.7)', async () => {
    const rules = [rule('youtube.com'), rule('reddit.com'), rule('m.youtube.com', { id: 'sub' }), rule('vk.com', { enabled: false })];
    const t = setup({ blocker: { level: 'strict' }, rules });
    expect(await t.controller.applyFor(focus())).toMatchObject({ state: 'active', strictLocked: true });
    const prev = { blocker: t.settings.blocker, timer: { keepBlockingOnPause: true } };
    const edit = (id: string, patch: Partial<BlockRule>) => rules.map((r) => (r.id === id ? { ...r, ...patch } : r));

    // убирают действующий домен — нельзя
    expect(t.controller.allowsRules(edit('r:youtube.com', { enabled: false }))).toBe(false);
    expect(t.controller.allowsRules(edit('r:youtube.com', { duringFocus: false }))).toBe(false);
    expect(t.controller.allowsRules(edit('r:reddit.com', { pattern: 'reddit.org' }))).toBe(false);
    expect(t.controller.allowsRules(edit('r:reddit.com', { schedule: { days: [0], from: '00:00', to: '00:01' } }))).toBe(true); // расписание добавляется к флажкам, а не заменяет их
    expect(t.controller.allowsRules(rules.filter((r) => r.id !== 'r:youtube.com'))).toBe(false);
    // не убирают — можно: другой период, поддомен под действующим доменом, новое правило, включение
    expect(t.controller.allowsRules(edit('r:reddit.com', { duringShortBreak: true }))).toBe(true);
    expect(t.controller.allowsRules(rules.filter((r) => r.id !== 'sub'))).toBe(true);
    expect(t.controller.allowsRules([...rules, rule('twitch.tv')])).toBe(true);
    expect(t.controller.allowsRules(edit('r:vk.com', { enabled: true }))).toBe(true);

    expect(t.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, enabled: false } }, prev)).toBe(false);
    expect(t.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, level: 'standard' } }, prev)).toBe(false);
    expect(t.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, strictUnlockDelaySec: 0 } }, prev)).toBe(false);
    expect(t.controller.allowsSettings({ ...prev, timer: { keepBlockingOnPause: false } }, prev)).toBe(false);
    expect(t.controller.allowsSettings(prev, prev)).toBe(true);
    expect(t.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, scheduledEnabled: true } }, prev)).toBe(true);

    // после снятия по правилам (ожидание + фраза) запрета больше нет
    await t.controller.requestUnlock();
    t.tick(60_000);
    expect((await t.controller.confirmUnlock('Я хочу отвлечься')).strictLocked).toBe(false);
    expect(t.controller.allowsRules(rules.filter((r) => r.id !== 'r:youtube.com'))).toBe(true);
    expect(t.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, level: 'standard' } }, prev)).toBe(true);
  });

  it('отказ Strict показывается пользователю текстом на обоих языках, а не ключом', () => {
    for (const lang of ['ru', 'en'] as const) {
      const text = translateDynamic(lang, STRICT_LOCKED_KEY);
      expect(text, lang).not.toBe(STRICT_LOCKED_KEY);
      expect(text, lang).not.toMatch(/blocker\.invalid/);
    }
    expect(translateDynamic('ru', STRICT_LOCKED_KEY)).not.toBe(translateDynamic('en', STRICT_LOCKED_KEY));
  });

  it('Standard и Strict вне сессии ничего не запрещают', async () => {
    const standard = setup();
    await standard.controller.applyFor(focus());
    const prev = { blocker: standard.settings.blocker, timer: { keepBlockingOnPause: true } };
    expect(standard.controller.allowsRules([])).toBe(true);
    expect(standard.controller.allowsSettings({ ...prev, blocker: { ...prev.blocker, enabled: false } }, prev)).toBe(true);

    const strictIdle = setup({ blocker: { level: 'strict' } });
    await strictIdle.controller.applyFor(idle());
    expect(strictIdle.controller.allowsRules([])).toBe(true);
  });

  it('Strict вне сессии (только расписание) не запирает', async () => {
    const t = setup({
      blocker: { level: 'strict', scheduledEnabled: true },
      rules: [rule('twitch.tv', { duringFocus: false, schedule: { days: [1], from: '09:00', to: '18:00' } })],
    });
    const s = await t.controller.applyFor({ ...idle(), scheduledEnabled: true });
    expect(s).toMatchObject({ state: 'active', strictLocked: false, activeDomains: ['twitch.tv'] });
  });

  it('не удалось вернуть настройки → error restoreFailed, снимок остаётся для следующей попытки', async () => {
    const t = setup();
    await t.controller.applyFor(focus());
    t.fake.restoreError = new Error('reg.exe failed');
    const s = await t.controller.applyFor(idle());
    expect(s).toMatchObject({ state: 'error', reasonKey: 'blocker.reason.restoreFailed' });
    expect(t.kv.has('snap')).toBe(true);
    t.fake.restoreError = null;
    expect((await t.controller.applyFor(idle())).state).toBe('off');
    expect(t.registry).toEqual(ORIGINAL);
    expect(t.kv.has('snap')).toBe(false);
  });

  it('recheck: после сбоя повторяет включение', async () => {
    const t = setup();
    t.fake.selfCheck = false;
    expect((await t.controller.applyFor(focus())).state).toBe('error');
    t.fake.selfCheck = true;
    expect((await t.controller.recheck()).state).toBe('active');
  });
});
