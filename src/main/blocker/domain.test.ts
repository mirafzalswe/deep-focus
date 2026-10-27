import { describe, expect, it } from 'vitest';
import { BUILTIN_BLOCK_RULES } from '../../shared/defaults';
import { isBlockRule } from '../settings/schema';
import { normalizeDomain } from './domain';

const ok = (domain: string, warningKey: string | null = null) => ({ ok: true, domain, warningKey });
const bad = (reasonKey: string) => ({ ok: false, reasonKey });

describe('normalizeDomain', () => {
  it('убирает схему, www., порт, регистр и завершающую точку', () => {
    expect(normalizeDomain('YouTube.com')).toEqual(ok('youtube.com'));
    expect(normalizeDomain('  https://www.YouTube.com  ')).toEqual(ok('youtube.com'));
    expect(normalizeDomain('http://reddit.com:8080')).toEqual(ok('reddit.com'));
    expect(normalizeDomain('reddit.com.')).toEqual(ok('reddit.com'));
    expect(normalizeDomain('https://youtube.com/')).toEqual(ok('youtube.com'));
    expect(normalizeDomain('*.tiktok.com')).toEqual(ok('tiktok.com'));
    expect(normalizeDomain('web.telegram.org')).toEqual(ok('web.telegram.org'));
  });

  it('адрес с путём или запросом → домен + предупреждение «заблокирую весь домен» (§4.2)', () => {
    expect(normalizeDomain('https://youtube.com/shorts')).toEqual(ok('youtube.com', 'blocker.warn.pathIgnored'));
    expect(normalizeDomain('instagram.com/reels?x=1')).toEqual(ok('instagram.com', 'blocker.warn.pathIgnored'));
    expect(normalizeDomain('https://user:pw@www.vk.com:443/feed#top')).toEqual(ok('vk.com', 'blocker.warn.pathIgnored'));
  });

  it('домен на кириллице → punycode', () => {
    expect(normalizeDomain('https://пример.рф/страница')).toEqual(ok('xn--e1afmkfd.xn--p1ai', 'blocker.warn.pathIgnored'));
  });

  it('отклоняет пустое и не-домен', () => {
    expect(normalizeDomain('')).toEqual(bad('blocker.invalid.empty'));
    expect(normalizeDomain('   ')).toEqual(bad('blocker.invalid.empty'));
    expect(normalizeDomain('youtube')).toEqual(bad('blocker.invalid.format'));
    expect(normalizeDomain('you tube.com')).toEqual(bad('blocker.invalid.format'));
    expect(normalizeDomain('x"; return "DIRECT')).toEqual(bad('blocker.invalid.format'));
    expect(normalizeDomain('ex*ample.com')).toEqual(bad('blocker.invalid.format'));
    expect(normalizeDomain('-bad-.com')).toEqual(bad('blocker.invalid.format'));
    expect(normalizeDomain(`${'a'.repeat(64)}.com`)).toEqual(bad('blocker.invalid.format'));
  });

  it('отклоняет localhost и IP-адреса (§4.14)', () => {
    expect(normalizeDomain('localhost')).toEqual(bad('blocker.invalid.local'));
    expect(normalizeDomain('http://localhost:3000/app')).toEqual(bad('blocker.invalid.local'));
    expect(normalizeDomain('api.localhost')).toEqual(bad('blocker.invalid.local'));
    expect(normalizeDomain('printer.local')).toEqual(bad('blocker.invalid.local'));
    expect(normalizeDomain('127.0.0.1')).toEqual(bad('blocker.invalid.ip'));
    expect(normalizeDomain('http://192.168.1.10:8080/')).toEqual(bad('blocker.invalid.ip'));
    expect(normalizeDomain('[::1]')).toEqual(bad('blocker.invalid.ip'));
    expect(normalizeDomain('http://[2001:db8::1]/x')).toEqual(bad('blocker.invalid.ip'));
  });

  it('отклоняет домены Microsoft и Windows Update со всеми поддоменами (§4.14)', () => {
    for (const d of [
      'microsoft.com',
      'login.microsoft.com',
      'https://www.microsoft.com/ru-ru',
      'windowsupdate.com',
      'download.windowsupdate.com',
      'windows.com',
      'update.windows.com',
      'msftconnecttest.com',
      'www.msftconnecttest.com',
    ]) {
      expect(normalizeDomain(d), d).toEqual(bad('blocker.invalid.system'));
    }
    // похожие, но чужие домены — не системные
    expect(normalizeDomain('notmicrosoft.com')).toEqual(ok('notmicrosoft.com'));
  });
});

describe('isBlockRule (импорт бэкапа): pattern — только уже нормализованный домен', () => {
  const base = {
    id: 'r',
    pattern: 'youtube.com',
    category: 'custom',
    enabled: true,
    duringFocus: true,
    duringShortBreak: false,
    duringLongBreak: false,
    schedule: null,
    builtin: false,
  };
  it('нормализованный домен проходит; кавычки, *, путь, схема, IP — нет', () => {
    expect(isBlockRule(base)).toBe(true);
    for (const r of BUILTIN_BLOCK_RULES) expect(isBlockRule(r), r.pattern).toBe(true);
    for (const pattern of ['x"; return "DIRECT', '*', 'https://youtube.com', 'youtube.com/shorts', 'YouTube.com', '127.0.0.1', 'microsoft.com']) {
      expect(isBlockRule({ ...base, pattern }), pattern).toBe(false);
    }
  });
});
