import { describe, expect, it } from 'vitest';
import { createWindowsSystemProxy, INTERNET_SETTINGS_KEY, releaseOurPacSync, type ProxySettings, type Runner, type SyncRunner } from './SystemProxy';

const BS = String.fromCharCode(92);
const KEY = ['HKCU', 'Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Internet Settings'].join(BS);
const CONN = `${KEY}${BS}Connections`;

const ORIGINAL: ProxySettings = {
  proxyEnable: 0,
  proxyServer: null,
  proxyOverride: null,
  autoConfigUrl: null,
  defaultConnectionSettings: '46000000030000000100000000000000',
  savedLegacySettings: '46000000030000000100000000000000',
};

/** Фиктивный runner: копия значений реестра в памяти + журнал команд. */
function fakeRunner(initial: ProxySettings, resolveTo = (url: string) => url) {
  const state = { ...initial };
  const calls: string[][] = [];
  const run: Runner = async (file, args, opts) => {
    calls.push([file, ...args]);
    if (file === 'reg.exe') {
      const [op, key, , name] = args;
      const field = {
        AutoConfigURL: 'autoConfigUrl',
        DefaultConnectionSettings: 'defaultConnectionSettings',
        SavedLegacySettings: 'savedLegacySettings',
        ProxyEnable: 'proxyEnable',
        ProxyServer: 'proxyServer',
        ProxyOverride: 'proxyOverride',
      }[name!] as keyof ProxySettings;
      expect(key === KEY || key === CONN).toBe(true);
      if (op === 'add') {
        const data = args[args.indexOf('/d') + 1]!;
        (state as Record<string, unknown>)[field] = field === 'proxyEnable' ? Number(data) : data;
      } else if (op === 'delete') {
        (state as Record<string, unknown>)[field] = null;
      }
      return { stdout: '' };
    }
    const script = args.at(-1)!;
    if (script.includes('Get-ItemProperty')) return { stdout: JSON.stringify(state) };
    if (script.includes('GetSystemWebProxy')) return { stdout: `${resolveTo(opts?.env?.DF_URL ?? '')}\r\n` };
    return { stdout: '' };
  };
  return { run, state, calls };
}

const regCalls = (calls: string[][]) => calls.filter((c) => c[0] === 'reg.exe');
const regWrites = (calls: string[][]) => regCalls(calls).filter((c) => c[1] !== 'query');

/** Синхронный runner для выключения Windows: reg.exe query/add/delete над той же копией реестра. */
function fakeSyncRunner(initial: ProxySettings) {
  const { run, state, calls } = fakeRunner(initial);
  const runSync: SyncRunner = (file, args) => {
    if (file !== 'reg.exe') throw new Error(`unexpected ${file}`);
    if (args[0] !== 'query') {
      void run(file, args);
      return '';
    }
    calls.push([file, ...args]);
    // формат вывода reg.exe query: заголовок ключа, значения с отступом 4 пробела, затем подключи; строки — CRLF
    const CRLF = '\r\n';
    const line = (name: string, type: string, value: string | number | null) =>
      value === null ? '' : `    ${name}    ${type}    ${type === 'REG_DWORD' ? `0x${Number(value).toString(16)}` : value}${CRLF}`;
    const header = (key: string) => key.replace(/^HKCU/, 'HKEY_CURRENT_USER') + CRLF;
    if (args[1] === KEY) {
      return [
        CRLF,
        header(KEY),
        `    User Agent    REG_SZ    Mozilla/4.0 (compatible)${CRLF}`,
        line('ProxyEnable', 'REG_DWORD', state.proxyEnable),
        line('ProxyServer', 'REG_SZ', state.proxyServer),
        line('ProxyOverride', 'REG_SZ', state.proxyOverride),
        line('AutoConfigURL', 'REG_SZ', state.autoConfigUrl),
        CRLF,
        header(CONN),
      ].join('');
    }
    if (args[1] === CONN) {
      return [
        CRLF,
        header(CONN),
        line('SavedLegacySettings', 'REG_BINARY', state.savedLegacySettings),
        line('DefaultConnectionSettings', 'REG_BINARY', state.defaultConnectionSettings),
      ].join('');
    }
    throw new Error(`unexpected key ${args[1]}`);
  };
  return { runSync, state, calls };
}

describe('SystemProxy (Windows)', () => {
  it('ключ — только HKCU Internet Settings', () => {
    expect(INTERNET_SETTINGS_KEY).toBe(KEY);
  });

  it('read: исходные значения из реестра пользователя', async () => {
    const { run } = fakeRunner({ ...ORIGINAL, proxyEnable: 1, proxyServer: 'proxy:3128', proxyOverride: '<local>' });
    expect(await createWindowsSystemProxy(run).read()).toEqual({
      ...ORIGINAL,
      proxyEnable: 1,
      proxyServer: 'proxy:3128',
      proxyOverride: '<local>',
    });
  });

  it('apply: пишет только AutoConfigURL в HKCU и уведомляет WinINET', async () => {
    const { run, state, calls } = fakeRunner(ORIGINAL);
    await createWindowsSystemProxy(run).apply('http://127.0.0.1:5555/deep-focus.pac?v=1');
    expect(state.autoConfigUrl).toBe('http://127.0.0.1:5555/deep-focus.pac?v=1');
    expect(regCalls(calls)).toEqual([
      ['reg.exe', 'add', KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', 'http://127.0.0.1:5555/deep-focus.pac?v=1', '/f'],
    ]);
    const ps = calls.filter((c) => c[0] === 'powershell.exe').map((c) => c.at(-1)!);
    expect(ps.some((s) => s.includes('InternetSetOption') && s.includes('39') && s.includes('37'))).toBe(true);
    expect(JSON.stringify(calls)).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE|hosts|netsh|Set-MpPreference/i);
  });

  it('restore: возвращает ровно исходные значения (AutoConfigURL удалён, двоичные настройки подключения — как были)', async () => {
    const { run, state, calls } = fakeRunner(ORIGINAL);
    const proxy = createWindowsSystemProxy(run);
    await proxy.apply('http://127.0.0.1:5555/deep-focus.pac?v=1');
    // WinINET сам переписывает двоичные настройки подключения после изменения
    state.defaultConnectionSettings = '4600000005000000050000000000';
    state.savedLegacySettings = '4600000005000000050000000000';
    await proxy.restore(ORIGINAL);
    expect(state).toEqual(ORIGINAL);
    expect(JSON.stringify(calls)).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE/i);
  });

  it('restore: исходный чужой AutoConfigURL возвращается значением', async () => {
    const { run, state } = fakeRunner(ORIGINAL);
    const proxy = createWindowsSystemProxy(run);
    await proxy.apply('http://127.0.0.1:5555/deep-focus.pac?v=1');
    await proxy.restore({ ...ORIGINAL, autoConfigUrl: 'http://wpad.corp/wpad.dat' });
    expect(state.autoConfigUrl).toBe('http://wpad.corp/wpad.dat');
  });

  it('restore: если пользователь сам поменял ручной прокси, двоичные настройки не перетираются', async () => {
    const { run, state } = fakeRunner(ORIGINAL);
    const proxy = createWindowsSystemProxy(run);
    await proxy.apply('http://127.0.0.1:5555/deep-focus.pac?v=1');
    state.proxyEnable = 1;
    state.proxyServer = 'new:8080';
    state.defaultConnectionSettings = 'AAAA';
    await proxy.restore(ORIGINAL);
    expect(state.autoConfigUrl).toBeNull();
    expect(state.defaultConnectionSettings).toBe('AAAA');
    expect(state.proxyServer).toBe('new:8080');
  });

  it('restore: чужой AutoConfigURL, поставленный во время сессии (VPN, пользователь), не трогается — ни он, ни двоичные настройки', async () => {
    const { run, state, calls } = fakeRunner(ORIGINAL);
    const proxy = createWindowsSystemProxy(run);
    await proxy.apply('http://127.0.0.1:5555/deep-focus.pac?v=1');
    // VPN поставил свой PAC; WinINET переписал двоичные настройки под него
    state.autoConfigUrl = 'http://vpn.corp/proxy.pac';
    state.defaultConnectionSettings = 'VPNVPN';
    state.savedLegacySettings = 'VPNVPN';
    const before = regWrites(calls).length;
    await proxy.restore(ORIGINAL);
    expect(state.autoConfigUrl).toBe('http://vpn.corp/proxy.pac');
    expect(state.defaultConnectionSettings).toBe('VPNVPN');
    expect(state.savedLegacySettings).toBe('VPNVPN');
    expect(regWrites(calls).length).toBe(before);
  });

  it('restore: нашего PAC уже нет (пользователь убрал его сам) — ничего не пишется', async () => {
    const { run, state, calls } = fakeRunner({ ...ORIGINAL, defaultConnectionSettings: 'USER' });
    await createWindowsSystemProxy(run).restore(ORIGINAL);
    expect(state.defaultConnectionSettings).toBe('USER');
    expect(regWrites(calls)).toEqual([]);
  });

  it('releaseOurPacSync (выключение Windows): синхронно возвращает исходное, только если AutoConfigURL наш', () => {
    const ours = fakeSyncRunner({ ...ORIGINAL, autoConfigUrl: 'http://127.0.0.1:5555/deep-focus.pac?v=1', defaultConnectionSettings: 'CHANGED' });
    expect(releaseOurPacSync(ORIGINAL, ours.runSync)).toBe(true);
    expect(ours.state).toEqual(ORIGINAL);

    const noSnapshot = fakeSyncRunner({ ...ORIGINAL, autoConfigUrl: 'http://127.0.0.1:5555/deep-focus.pac?v=1' });
    expect(releaseOurPacSync(null, noSnapshot.runSync)).toBe(true);
    expect(noSnapshot.state).toEqual(ORIGINAL);

    const foreign = fakeSyncRunner({ ...ORIGINAL, autoConfigUrl: 'http://vpn.corp/proxy.pac', defaultConnectionSettings: 'VPNVPN' });
    expect(releaseOurPacSync(ORIGINAL, foreign.runSync)).toBe(false);
    expect(foreign.state).toEqual({ ...ORIGINAL, autoConfigUrl: 'http://vpn.corp/proxy.pac', defaultConnectionSettings: 'VPNVPN' });
    expect(regWrites(foreign.calls)).toEqual([]);
    expect(JSON.stringify([...ours.calls, ...foreign.calls])).not.toMatch(/HKLM|HKEY_LOCAL_MACHINE/);
  });

  it('resolveProxyFor: адрес передаётся через переменную окружения, а не в тексте команды', async () => {
    const { run, calls } = fakeRunner(ORIGINAL, () => 'http://127.0.0.1:5555/');
    const evil = "https://x.com/'; Remove-Item C:\\ -Recurse; '";
    expect(await createWindowsSystemProxy(run).resolveProxyFor(evil)).toBe('http://127.0.0.1:5555/');
    expect(JSON.stringify(calls)).not.toContain('Remove-Item');
  });
});
