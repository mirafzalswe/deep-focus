// Системный прокси текущего пользователя (Windows). Только HKCU, без прав администратора:
// запись — reg.exe в HKCU\…\Internet Settings, уведомление WinINET — InternetSetOption через
// одноразовый PowerShell с P/Invoke, проверка — [System.Net.WebRequest]::GetSystemWebProxy().
// Никаких HKLM, hosts, брандмауэра, Defender, UAC.
import { execFile } from 'node:child_process';

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

export function createWindowsSystemProxy(run: Runner = defaultRunner): SystemProxy {
  const ps = (script: string, env?: Record<string, string>) => run('powershell.exe', [...PS_ARGS, script], env ? { env } : undefined);
  const regAdd = (key: string, name: string, type: 'REG_SZ' | 'REG_BINARY', data: string) =>
    run('reg.exe', ['add', key, '/v', name, '/t', type, '/d', data, '/f']);
  const regDelete = (key: string, name: string) => run('reg.exe', ['delete', key, '/v', name, '/f']);
  const notify = () => ps(NOTIFY_SCRIPT);
  const read = async () => parseProxySettings((await ps(READ_SCRIPT)).stdout);

  return {
    read,

    async apply(pacUrl) {
      await regAdd(INTERNET_SETTINGS_KEY, 'AutoConfigURL', 'REG_SZ', pacUrl);
      await notify();
    },

    async restore(saved) {
      const cur = await read();
      if (cur.autoConfigUrl !== saved.autoConfigUrl) {
        if (saved.autoConfigUrl === null) await regDelete(INTERNET_SETTINGS_KEY, 'AutoConfigURL');
        else await regAdd(INTERNET_SETTINGS_KEY, 'AutoConfigURL', 'REG_SZ', saved.autoConfigUrl);
      }
      // Двоичные настройки подключения WinINET переписал сам, когда увидел наш PAC. Возвращаем их,
      // только если пользователь за это время не менял ручной прокси (иначе перетёрли бы его выбор).
      const manualUnchanged =
        cur.proxyEnable === saved.proxyEnable && cur.proxyServer === saved.proxyServer && cur.proxyOverride === saved.proxyOverride;
      if (manualUnchanged) {
        if (saved.defaultConnectionSettings && cur.defaultConnectionSettings !== saved.defaultConnectionSettings) {
          await regAdd(CONNECTIONS_KEY, 'DefaultConnectionSettings', 'REG_BINARY', saved.defaultConnectionSettings);
        }
        if (saved.savedLegacySettings && cur.savedLegacySettings !== saved.savedLegacySettings) {
          await regAdd(CONNECTIONS_KEY, 'SavedLegacySettings', 'REG_BINARY', saved.savedLegacySettings);
        }
      }
      await notify();
    },

    async resolveProxyFor(url) {
      return (await ps(RESOLVE_SCRIPT, { DF_URL: url })).stdout.trim();
    },
  };
}
