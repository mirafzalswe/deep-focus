// Системный прокси текущего пользователя (Windows). Только HKCU, без прав администратора:
// запись — reg.exe в HKCU\…\Internet Settings, уведомление WinINET — InternetSetOption через
// одноразовый PowerShell с P/Invoke, проверка — [System.Net.WebRequest]::GetSystemWebProxy().
// Никаких HKLM, hosts, брандмауэра, Defender, UAC.
import { execFile, execFileSync } from 'node:child_process';
import { isOurPacUrl } from './PacServer';

/** Значения пользователя, которые блокировщик сохраняет до первого изменения и возвращает после. */
export interface ProxySettings {
  proxyEnable: number | null;
  proxyServer: string | null;
  proxyOverride: string | null;
  autoConfigUrl: string | null;
  /** REG_BINARY Connections\DefaultConnectionSettings (hex) — WinINET переписывает его сам после изменения. */
  defaultConnectionSettings: string | null;
  /** REG_BINARY Connections\SavedLegacySettings (hex). */
  savedLegacySettings: string | null;
}

/** Шов для тестов: в Vitest — фейк, в приложении — createWindowsSystemProxy(). */
export interface SystemProxy {
  read(): Promise<ProxySettings>;
  apply(pacUrl: string): Promise<void>;
  restore(saved: ProxySettings): Promise<void>;
  /** Что системный прокси выбирает для url: адрес прокси или сам url (напрямую). */
  resolveProxyFor(url: string): Promise<string>;
}

export type Runner = (file: string, args: string[], opts?: { env?: Record<string, string> }) => Promise<{ stdout: string }>;
/** Синхронный запуск (выключение Windows: асинхронный код может уже не успеть) — stdout. */
export type SyncRunner = (file: string, args: string[]) => string;

const BS = String.fromCharCode(92);
const KEY_PATH = ['Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Internet Settings'].join(BS);
export const INTERNET_SETTINGS_KEY = `HKCU${BS}${KEY_PATH}`;
const CONNECTIONS_KEY = `${INTERNET_SETTINGS_KEY}${BS}Connections`;

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-Command'];

const READ_SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$k = 'HKCU:${BS}${KEY_PATH}'
$p = Get-ItemProperty -LiteralPath $k
$c = Get-ItemProperty -LiteralPath ($k + '${BS}Connections') -ErrorAction SilentlyContinue
function val($o, $n) { if ($null -ne $o -and $o.PSObject.Properties[$n]) { $o.$n } else { $null } }
function hex($b) { if ($null -eq $b) { $null } else { ([BitConverter]::ToString([byte[]]$b)) -replace '-', '' } }
[pscustomobject]@{
  proxyEnable = val $p 'ProxyEnable'
  proxyServer = val $p 'ProxyServer'
  proxyOverride = val $p 'ProxyOverride'
  autoConfigUrl = val $p 'AutoConfigURL'
  defaultConnectionSettings = hex (val $c 'DefaultConnectionSettings')
  savedLegacySettings = hex (val $c 'SavedLegacySettings')
} | ConvertTo-Json -Compress`;

// 39 = INTERNET_OPTION_SETTINGS_CHANGED, 37 = INTERNET_OPTION_REFRESH
const NOTIFY_SCRIPT = `$ErrorActionPreference = 'Stop'
$sig = '[DllImport("wininet.dll", SetLastError = true)] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);'
Add-Type -Namespace DeepFocus -Name WinInet -MemberDefinition $sig
[void][DeepFocus.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
[void][DeepFocus.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)`;

const RESOLVE_SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]$env:DF_URL).AbsoluteUri`;

export const defaultRunner: Runner = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, timeout: 30_000, encoding: 'utf8', env: { ...process.env, ...(opts?.env ?? {}) } },
      (err, stdout) => (err ? reject(err) : resolve({ stdout })),
    );
  });

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function parseProxySettings(json: string): ProxySettings {
  const o = JSON.parse(json.trim() || '{}') as Record<string, unknown>;
  return {
    proxyEnable: num(o.proxyEnable),
    proxyServer: str(o.proxyServer),
    proxyOverride: str(o.proxyOverride),
    autoConfigUrl: str(o.autoConfigUrl),
    defaultConnectionSettings: str(o.defaultConnectionSettings),
    savedLegacySettings: str(o.savedLegacySettings),
  };
}

type RegOp =
  | { op: 'add'; key: string; name: string; type: 'REG_SZ' | 'REG_BINARY'; data: string }
  | { op: 'delete'; key: string; name: string };

const regArgs = (o: RegOp): string[] =>
  o.op === 'add' ? ['add', o.key, '/v', o.name, '/t', o.type, '/d', o.data, '/f'] : ['delete', o.key, '/v', o.name, '/f'];

/**
 * Что записать, чтобы вернуть saved. Трогаем только своё: если сейчас в реестре не наш PAC (его убрали
 * или поставили свой — VPN, пользователь, администратор), ничего не пишем — иначе стёрли бы чужой выбор.
 */
export function restoreOps(cur: ProxySettings, saved: ProxySettings): RegOp[] {
  if (!cur.autoConfigUrl || !isOurPacUrl(cur.autoConfigUrl)) return [];
  const ops: RegOp[] = [
    saved.autoConfigUrl === null
      ? { op: 'delete', key: INTERNET_SETTINGS_KEY, name: 'AutoConfigURL' }
      : { op: 'add', key: INTERNET_SETTINGS_KEY, name: 'AutoConfigURL', type: 'REG_SZ', data: saved.autoConfigUrl },
  ];
  // Двоичные настройки подключения WinINET переписал сам, когда увидел наш PAC. Возвращаем их,
  // только если пользователь за это время не менял ручной прокси (иначе перетёрли бы его выбор).
  const manualUnchanged =
    cur.proxyEnable === saved.proxyEnable && cur.proxyServer === saved.proxyServer && cur.proxyOverride === saved.proxyOverride;
  if (manualUnchanged) {
    for (const [name, field] of [
      ['DefaultConnectionSettings', 'defaultConnectionSettings'],
      ['SavedLegacySettings', 'savedLegacySettings'],
    ] as const) {
      const value = saved[field];
      if (value && cur[field] !== value) ops.push({ op: 'add', key: CONNECTIONS_KEY, name, type: 'REG_BINARY', data: value });
    }
  }
  return ops;
}

/** Значения ключа из вывода `reg.exe query <ключ>` (только сам ключ, без подключей). */
function parseRegQuery(out: string): Map<string, { type: string; data: string }> {
  const values = new Map<string, { type: string; data: string }>();
  let inKey = false;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      // первый заголовок — сам ключ, дальше — подключи
      if (inKey) break;
      inKey = true;
      continue;
    }
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (m) values.set(m[1]!, { type: m[2]!, data: m[3] ?? '' });
  }
  return values;
}

export const defaultSyncRunner: SyncRunner = (file, args) =>
  execFileSync(file, args, { windowsHide: true, timeout: 5000, encoding: 'utf8' });

/**
 * Выключение или выход из Windows (session-end): синхронно вернуть исходные значения, если в реестре наш PAC.
 * Без снимка — только удалить наш AutoConfigURL. WinINET не уведомляется: после входа он читает реестр заново.
 * true — наш PAC был и снят; false — в реестре не наш PAC, ничего не записано.
 */
export function releaseOurPacSync(saved: ProxySettings | null, runSync: SyncRunner = defaultSyncRunner): boolean {
  const main = parseRegQuery(runSync('reg.exe', ['query', INTERNET_SETTINGS_KEY]));
  let conn = new Map<string, { type: string; data: string }>();
  try {
    conn = parseRegQuery(runSync('reg.exe', ['query', CONNECTIONS_KEY]));
  } catch {
    // ключа Connections может не быть
  }
  const sz = (m: typeof main, name: string) => m.get(name)?.data ?? null;
  const dword = main.get('ProxyEnable');
  const cur: ProxySettings = {
    proxyEnable: dword ? Number.parseInt(dword.data, 16) : null,
    proxyServer: sz(main, 'ProxyServer'),
    proxyOverride: sz(main, 'ProxyOverride'),
    autoConfigUrl: sz(main, 'AutoConfigURL'),
    defaultConnectionSettings: sz(conn, 'DefaultConnectionSettings'),
    savedLegacySettings: sz(conn, 'SavedLegacySettings'),
  };
  const ops = restoreOps(cur, saved ?? { ...cur, autoConfigUrl: null });
  for (const op of ops) runSync('reg.exe', regArgs(op));
  return ops.length > 0;
}

export function createWindowsSystemProxy(run: Runner = defaultRunner): SystemProxy {
  const ps = (script: string, env?: Record<string, string>) => run('powershell.exe', [...PS_ARGS, script], env ? { env } : undefined);
  const regAdd = (key: string, name: string, type: 'REG_SZ' | 'REG_BINARY', data: string) =>
    run('reg.exe', regArgs({ op: 'add', key, name, type, data }));
  const notify = () => ps(NOTIFY_SCRIPT);
  const read = async () => parseProxySettings((await ps(READ_SCRIPT)).stdout);

  return {
    read,

    async apply(pacUrl) {
      await regAdd(INTERNET_SETTINGS_KEY, 'AutoConfigURL', 'REG_SZ', pacUrl);
      await notify();
    },

    async restore(saved) {
      const ops = restoreOps(await read(), saved);
      if (ops.length === 0) return;
      for (const op of ops) await run('reg.exe', regArgs(op));
      await notify();
    },

    async resolveProxyFor(url) {
      return (await ps(RESOLVE_SCRIPT, { DF_URL: url })).stdout.trim();
    },
  };
}
