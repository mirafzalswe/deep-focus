// Сборка PAC-файла. Чистая функция: заблокированные домены (и их поддомены) → заглушка на 127.0.0.1,
// остальное → DIRECT или исходный прокси пользователя. Всё, что попадает в текст PAC, — строковые
// литералы через JSON.stringify; домены перед этим проходят normalizeDomain (мусор отбрасывается).
import { normalizeDomain } from './domain';

export type Upstream = { type: 'direct' } | { type: 'proxy'; server: string; bypass: string[] };

/** JS-литерал строки/массива, безопасный для вставки в код PAC. */
const BS = String.fromCharCode(92);
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const lit = (value: unknown): string =>
  JSON.stringify(value).split(LS).join(BS + 'u2028').split(PS).join(BS + 'u2029');

/** ProxyServer Windows: «host:port» или «http=h:p;https=h:p;socks=h:p» → ответы PAC для http и https. */
function upstreamResults(server: string): { http: string; https: string } {
  const s = server.trim();
  if (!s.includes('=')) return { http: `PROXY ${s}`, https: `PROXY ${s}` };
  const map = new Map<string, string>();
  for (const part of s.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim());
  }
  const socks = map.get('socks');
  const pick = (proto: string) => {
    const v = map.get(proto);
    if (v) return `PROXY ${v}`;
    return socks ? `SOCKS ${socks}` : 'DIRECT';
  };
  return { http: pick('http'), https: pick('https') };
}

export function buildPac(domains: readonly string[], upstream: Upstream, port: number): string {
  const blocked = [
    ...new Set(
      domains.flatMap((d) => {
        const n = normalizeDomain(d);
        return n.ok ? [n.domain] : [];
      }),
    ),
  ];
  const stub = `PROXY 127.0.0.1:${Math.trunc(port)}`;
  const up = upstream.type === 'proxy' ? upstreamResults(upstream.server) : { http: 'DIRECT', https: 'DIRECT' };
  const bypass = upstream.type === 'proxy' ? upstream.bypass.map((b) => b.trim().toLowerCase()).filter(Boolean) : [];
  const bypassLocal = bypass.includes('<local>');
  const bypassPatterns = bypass.filter((b) => b !== '<local>');

  return `// Deep Focus — блокировка сайтов на время фокуса. Создано приложением; удаляется при выключении.
var BLOCKED = ${lit(blocked)};
var STUB = ${lit(stub)};
var UP_HTTP = ${lit(up.http)};
var UP_HTTPS = ${lit(up.https)};
var BYPASS_LOCAL = ${bypassLocal ? 'true' : 'false'};
var BYPASS = ${lit(bypassPatterns)};

function FindProxyForURL(url, host) {
  host = String(host).toLowerCase();
  if (host.charAt(host.length - 1) === ".") host = host.substring(0, host.length - 1);
  for (var i = 0; i < BLOCKED.length; i++) {
    var d = BLOCKED[i];
    if (host === d) return STUB;
    if (host.length > d.length && host.substring(host.length - d.length - 1) === "." + d) return STUB;
  }
  if (UP_HTTP === "DIRECT" && UP_HTTPS === "DIRECT") return "DIRECT";
  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "DIRECT";
  if (BYPASS_LOCAL && isPlainHostName(host)) return "DIRECT";
  for (var j = 0; j < BYPASS.length; j++) {
    if (shExpMatch(host, BYPASS[j])) return "DIRECT";
  }
  return String(url).substring(0, 6).toLowerCase() === "https:" ? UP_HTTPS : UP_HTTP;
}
`;
}
