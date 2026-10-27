// E2E блокировки (§4) на настоящем реестре текущего пользователя (только HKCU):
//  • согласие → Focus → системное разрешение прокси для youtube.com ведёт на заглушку, заглушка отвечает
//    страницей блокировки / отказом CONNECT; конец сессии → настройки ровно исходные;
//  • сбой приложения с включённой блокировкой → DeepFocus --cleanup возвращает исходное;
//  • правила в интерфейсе: путь → предупреждение, системные/локальные адреса → отказ; реестр не тронут.
// Каждый тест в finally возвращает исходные значения прокси, если они отличаются, и проверяет это.
// Тесты, которые включают блокировку (меняют настоящий прокси пользователя), идут только явно:
//   DF_REAL_REGISTRY=1 npm run e2e   — как SystemProxy.registry.test.ts.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { connect } from 'node:net';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { launchApp, removeUserData, ROOT, tempUserData } from './helpers';

interface ProxyValues {
  proxyEnable: number | null;
  proxyServer: string | null;
  proxyOverride: string | null;
  autoConfigUrl: string | null;
  defaultConnectionSettings: string | null;
  savedLegacySettings: string | null;
}

const BS = String.fromCharCode(92);
const KEY_PATH = ['Software', 'Microsoft', 'Windows', 'CurrentVersion', 'Internet Settings'].join(BS);
const KEY = `HKCU${BS}${KEY_PATH}`;

const ps = (script: string, env: Record<string, string> = {}) =>
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, ...env },
  }).trim();

function readProxy(): ProxyValues {
  const out = ps(`$k = 'HKCU:${BS}${KEY_PATH}'
$p = Get-ItemProperty -LiteralPath $k
$c = Get-ItemProperty -LiteralPath ($k + '${BS}Connections') -ErrorAction SilentlyContinue
function val($o, $n) { if ($null -ne $o -and $o.PSObject.Properties[$n]) { $o.$n } else { $null } }
function hex($b) { if ($null -eq $b) { $null } else { ([BitConverter]::ToString([byte[]]$b)) -replace '-', '' } }
[pscustomobject]@{
  proxyEnable = val $p 'ProxyEnable'; proxyServer = val $p 'ProxyServer'; proxyOverride = val $p 'ProxyOverride'
  autoConfigUrl = val $p 'AutoConfigURL'
  defaultConnectionSettings = hex (val $c 'DefaultConnectionSettings'); savedLegacySettings = hex (val $c 'SavedLegacySettings')
} | ConvertTo-Json -Compress`);
  return JSON.parse(out) as ProxyValues;
}

/** Что выбирает системный прокси Windows для адреса (как в §4.11). */
const systemProxyFor = (url: string) =>
  ps(`[System.Net.WebRequest]::GetSystemWebProxy().GetProxy([Uri]$env:DF_URL).AbsoluteUri`, { DF_URL: url });

const NOTIFY = `$sig = '[DllImport("wininet.dll")] public static extern bool InternetSetOption(IntPtr h, int o, IntPtr b, int l);'
Add-Type -Namespace DeepFocusE2E -Name WinInet -MemberDefinition $sig
[void][DeepFocusE2E.WinInet]::InternetSetOption([IntPtr]::Zero, 39, [IntPtr]::Zero, 0)
[void][DeepFocusE2E.WinInet]::InternetSetOption([IntPtr]::Zero, 37, [IntPtr]::Zero, 0)`;

/** Страховка теста: вернуть исходные значения, если приложение их не вернуло. */
function forceRestore(original: ProxyValues): void {
  const reg = (args: string[]) => execFileSync('reg.exe', args, { stdio: 'ignore' });
  const cur = readProxy();
  if (JSON.stringify(cur) === JSON.stringify(original)) return;
  if (original.autoConfigUrl === null) {
    if (cur.autoConfigUrl !== null) reg(['delete', KEY, '/v', 'AutoConfigURL', '/f']);
  } else reg(['add', KEY, '/v', 'AutoConfigURL', '/t', 'REG_SZ', '/d', original.autoConfigUrl, '/f']);
  for (const [name, value] of [
    ['DefaultConnectionSettings', original.defaultConnectionSettings],
    ['SavedLegacySettings', original.savedLegacySettings],
  ] as const) {
    if (value) reg(['add', `${KEY}${BS}Connections`, '/v', name, '/t', 'REG_BINARY', '/d', value, '/f']);
  }
  ps(NOTIFY);
}

function stubRequest(port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: 'http://youtube.com/watch', headers: { host: 'youtube.com' } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function stubConnect(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1', () => sock.write('CONNECT youtube.com:443 HTTP/1.1\r\nHost: youtube.com:443\r\n\r\n'));
    let data = '';
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => (data += c));
    sock.on('close', () => resolve(data));
    sock.on('error', reject);
  });
}

const portOf = (url: string | null) => Number(/^http:\/\/127\.0\.0\.1:(\d+)\/deep-focus\.pac/.exec(url ?? '')?.[1] ?? NaN);
const blockerStatus = (page: Page) => page.evaluate(() => window.deepFocus.blocker.status());

async function startFocus(page: Page): Promise<void> {
  await page.evaluate(() => window.deepFocus.timer.command({ type: 'start', mode: 'pomodoro', kind: 'focus' }));
}

test.describe.configure({ mode: 'serial' });

/** Меняет настоящие настройки прокси HKCU — только с явного разрешения. */
const REAL_REGISTRY = process.platform === 'win32' && process.env.DF_REAL_REGISTRY === '1';
const REAL_REGISTRY_SKIP = 'меняет настоящий прокси HKCU — запуск только с DF_REAL_REGISTRY=1';

test('согласие → Focus: системный прокси ведёт youtube.com на заглушку; конец сессии → настройки ровно исходные', async () => {
  test.skip(!REAL_REGISTRY, REAL_REGISTRY_SKIP);
  test.setTimeout(180_000);
  const original = readProxy();
  const userData = tempUserData();
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(userData));
    const page = await app.firstWindow();
    await page.evaluate(() => (window.location.hash = '#/blocker'));
    await expect(page.locator('[data-blocker-state]')).toHaveAttribute('data-blocker-state', 'disabled');

    // включено, но без согласия — реестр не трогается даже во время Focus (§4.8.1)
    await page.evaluate(() => window.deepFocus.settings.patch({ blocker: { enabled: true } }));
    await startFocus(page);
    await expect.poll(async () => (await blockerStatus(page)).reasonKey, { timeout: 15_000 }).toBe('blocker.reason.needsConsent');
    await page.waitForTimeout(1500);
    expect(readProxy()).toEqual(original);
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    await page.evaluate(() => window.deepFocus.settings.patch({ blocker: { enabled: false } }));

    // экран согласия → «Включить»
    await page.bringToFront();
    await page.locator('[data-blocker-action="enable"]').click();
    await expect(page.locator('[data-dialog="blocker-consent"]')).toBeVisible();
    expect(readProxy()).toEqual(original);
    await page.locator('[data-blocker-action="consent-accept"]').click();
    await expect(page.locator('[data-blocker-state]')).toHaveAttribute('data-blocker-state', 'off');

    // Focus → блокировка проверена и работает
    await startFocus(page);
    await expect.poll(async () => (await blockerStatus(page)).state, { timeout: 45_000 }).toBe('active');
    const status = await blockerStatus(page);
    expect(status.activeDomains).toContain('youtube.com');
    expect(status.verifiedAt).not.toBeNull();

    const during = readProxy();
    const port = portOf(during.autoConfigUrl);
    expect(port).toBeGreaterThan(0);
    // ручные настройки пользователя не меняются, меняется только своя строка
    expect(during.proxyEnable).toBe(original.proxyEnable);
    expect(during.proxyServer).toBe(original.proxyServer);
    expect(during.proxyOverride).toBe(original.proxyOverride);

    // §4.11: проверка так же, как это видит Windows
    expect(systemProxyFor('https://youtube.com')).toBe(`http://127.0.0.1:${port}/`);
    expect(systemProxyFor('https://www.youtube.com/watch?v=1')).toBe(`http://127.0.0.1:${port}/`);
    expect(systemProxyFor('https://example.com')).toBe('https://example.com/');

    const http = await stubRequest(port);
    expect(http.status).toBe(403);
    expect(http.body).toContain('Deep Focus');
    expect(await stubConnect(port)).toMatch(/^HTTP\/1\.1 403 /);

    // конец сессии — блокировка снята, всё как было
    await page.evaluate(() => window.deepFocus.timer.command({ type: 'stop' }));
    await expect.poll(async () => (await blockerStatus(page)).state, { timeout: 45_000 }).toBe('off');
    expect(readProxy()).toEqual(original);
    expect(systemProxyFor('https://youtube.com')).toBe('https://youtube.com/');
  } finally {
    await app?.close().catch(() => undefined);
    forceRestore(original);
    expect(readProxy()).toEqual(original);
    removeUserData(userData);
  }
});

test('сбой с включённой блокировкой → DeepFocus --cleanup возвращает исходные настройки и выходит', async () => {
  test.skip(!REAL_REGISTRY, REAL_REGISTRY_SKIP);
  test.setTimeout(180_000);
  const original = readProxy();
  const userData = tempUserData();
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(userData));
    const page = await app.firstWindow();
    await page.evaluate(() => window.deepFocus.blocker.giveConsent());
    await startFocus(page);
    await expect.poll(async () => (await blockerStatus(page)).state, { timeout: 45_000 }).toBe('active');
    expect(isNaN(portOf(readProxy().autoConfigUrl))).toBe(false);

    // аварийное завершение всего приложения (вместе с дочерними процессами): блокировка осталась в реестре
    const proc = app.process();
    const exited = new Promise((r) => proc.once('exit', r));
    execFileSync('taskkill', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
    app = null;
    await exited;
    await new Promise((r) => setTimeout(r, 1000));
    expect(readProxy().autoConfigUrl).toMatch(/deep-focus\.pac/);

    // деинсталлятор: DeepFocus.exe --cleanup
    const env: Record<string, string> = {};
    for (const [k, val] of Object.entries(process.env)) {
      if (val !== undefined && k !== 'ELECTRON_RENDERER_URL' && k !== 'ELECTRON_RUN_AS_NODE') env[k] = val;
    }
    env.DEEPFOCUS_USER_DATA = userData;
    const exe = join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(exe, [ROOT, '--cleanup'], { cwd: ROOT, env, stdio: 'ignore' });
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('--cleanup did not exit in time'));
      }, 60_000);
      child.on('exit', (c) => {
        clearTimeout(timer);
        resolve(c);
      });
      child.on('error', reject);
    });
    expect(code).toBe(0);
    expect(readFileSync(join(userData, 'logs', 'deepfocus.log'), 'utf8')).toContain('cleanup requested');
    expect(readProxy()).toEqual(original);
    expect(systemProxyFor('https://youtube.com')).toBe('https://youtube.com/');
  } finally {
    if (app) await app.close().catch(() => undefined);
    forceRestore(original);
    expect(readProxy()).toEqual(original);
    removeUserData(userData);
  }
});

test('правила в интерфейсе: путь → предупреждение, системные и локальные адреса — отказ, Strict объясняется; реестр не тронут', async () => {
  test.setTimeout(120_000);
  const original = readProxy();
  const userData = tempUserData();
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(userData));
    const page = await app.firstWindow();
    await page.evaluate(() => (window.location.hash = '#/blocker'));
    await expect(page.locator('[data-rule-category="social"]')).toBeVisible();
    await expect(page.locator('[data-blocker-limits]')).toContainText('системному прокси');

    const input = page.locator('[data-blocker-add] input[name="pattern"]');
    const add = page.locator('[data-blocker-action="add-rule"]');
    const message = page.locator('[data-blocker-message]');

    await input.fill('https://www.Example.org/some/path');
    await add.click();
    await expect(message).toHaveAttribute('data-blocker-message', 'warn');
    await expect(message).toContainText('example.org');
    await expect(page.locator('[data-rule-pattern="example.org"]')).toBeVisible();

    for (const bad of ['localhost', '192.168.0.1', 'update.microsoft.com', 'youtube.com/shorts']) {
      await input.fill(bad);
      await add.click();
      await expect(message).toHaveAttribute('data-blocker-message', 'danger');
    }
    const rules = await page.evaluate(() => window.deepFocus.blocker.rules());
    expect(rules.filter((r) => !r.builtin).map((r) => r.pattern)).toEqual(['example.org']);

    // Strict: объяснение при включении
    await page.evaluate(() => (window.location.hash = '#/settings/blocker'));
    await page.getByRole('radio', { name: 'Строгий' }).click();
    await expect(page.locator('[data-dialog="blocker-strict"]')).toContainText('трей');
    await page.locator('[data-blocker-action="strict-accept"]').click();
    await expect.poll(() => page.evaluate(() => window.deepFocus.settings.get().then((s) => s.blocker.level))).toBe('strict');

    expect(readProxy()).toEqual(original);
  } finally {
    await app?.close().catch(() => undefined);
    forceRestore(original);
    expect(readProxy()).toEqual(original);
    removeUserData(userData);
  }
});

test('выключение Windows (session-end): блокировщик синхронно проверяет реестр и не трогает то, что не его', async () => {
  const original = readProxy();
  const userData = tempUserData();
  let app: ElectronApplication | null = null;
  try {
    ({ app } = await launchApp(userData));
    // Windows шлёт WM_ENDSESSION каждому окну; Electron превращает его в session-end
    await app.evaluate(({ BrowserWindow }) => {
      for (const w of BrowserWindow.getAllWindows()) w.emit('session-end', { preventDefault() {} });
    });
    const log = () => readFileSync(join(userData, 'logs', 'deepfocus.log'), 'utf8');
    await expect.poll(log).toContain('session end: nothing of ours in proxy settings');
    expect(log().match(/session end:/g)).toHaveLength(1);
    expect(readProxy()).toEqual(original);
  } finally {
    await app?.close().catch(() => undefined);
    expect(readProxy()).toEqual(original);
    removeUserData(userData);
  }
});
