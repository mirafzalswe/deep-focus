// Нормализация домена правила блокировки: «что ввёл пользователь» → целый домен без схемы, пути и порта.
// Чистая функция; используется при сохранении правила, при сборке PAC и при выборе активных доменов.
// Блокируется всегда домен целиком вместе с поддоменами (решение пользователя: «1) да»).
import { domainToASCII } from 'node:url';

export type NormalizeResult =
  | { ok: true; domain: string; warningKey: string | null }
  | { ok: false; reasonKey: string };

/** Домены, которые блокировщик не трогает никогда (§4.14): система и обновления Windows. */
export const SYSTEM_DOMAINS: readonly string[] = ['microsoft.com', 'windowsupdate.com', 'windows.com', 'msftconnecttest.com'];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const TLD = /^([a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const fail = (reasonKey: string): NormalizeResult => ({ ok: false, reasonKey });

/** Домен равен base или является его поддоменом. */
export const isSameOrSubdomain = (domain: string, base: string): boolean =>
  domain === base || domain.endsWith(`.${base}`);

export function normalizeDomain(input: string): NormalizeResult {
  let s = input.trim().toLowerCase();
  if (!s) return fail('blocker.invalid.empty');

  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // путь, запрос, фрагмент — отбрасываются; блокируется весь домен
  const cut = s.search(/[/?#]/);
  let rest = '';
  if (cut >= 0) {
    rest = s.slice(cut);
    s = s.slice(0, cut);
  }
  const at = s.lastIndexOf('@');
  if (at >= 0) s = s.slice(at + 1);

  if (s.startsWith('[') || (s.match(/:/g)?.length ?? 0) > 1) return fail('blocker.invalid.ip');
  s = s.replace(/:\d{1,5}$/, '');
  s = s.replace(/\.$/, '');
  s = s.replace(/^\*\./, '');
  if (!s) return fail('blocker.invalid.empty');
  if (IPV4.test(s)) return fail('blocker.invalid.ip');
  if (s === 'localhost' || s.endsWith('.localhost') || s.endsWith('.local')) return fail('blocker.invalid.local');

  if (/[^\x21-\x7e]/.test(s) && !/\s/.test(s)) {
    const ascii = domainToASCII(s);
    if (!ascii) return fail('blocker.invalid.format');
    s = ascii;
  }
  if (s.startsWith('www.')) s = s.slice(4);

  const labels = s.split('.');
  if (s.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || !TLD.test(labels.at(-1)!)) {
    return fail('blocker.invalid.format');
  }
  if (SYSTEM_DOMAINS.some((base) => isSameOrSubdomain(s, base))) return fail('blocker.invalid.system');

  const hasPath = rest !== '' && rest !== '/';
  return { ok: true, domain: s, warningKey: hasPath ? 'blocker.warn.pathIgnored' : null };
}

/** Строка уже является нормализованным доменом, допустимым для правила. */
export function isNormalizedDomain(pattern: string): boolean {
  const n = normalizeDomain(pattern);
  return n.ok && n.domain === pattern;
}
