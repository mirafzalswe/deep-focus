import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { buildPac, type Upstream } from './pac';

/** Минимальная среда PAC (как в браузере): shExpMatch, isPlainHostName. */
function pacEnv() {
  return {
    isPlainHostName: (host: string) => !host.includes('.'),
    shExpMatch: (str: string, pattern: string) => {
      const re = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
      return re.test(str);
    },
  };
}

function compile(pac: string): (url: string) => string {
  const env: Record<string, unknown> = pacEnv();
  runInNewContext(pac, env, { timeout: 1000 });
  const fn = env.FindProxyForURL as (url: string, host: string) => string;
  expect(typeof fn).toBe('function');
  return (url) => fn(url, new URL(url).hostname);
}

const DIRECT: Upstream = { type: 'direct' };
const STUB = 'PROXY 127.0.0.1:5555';

describe('buildPac', () => {
  it('заблокированный домен и все его поддомены → заглушка; прочее → DIRECT', () => {
    const find = compile(buildPac(['youtube.com', 'web.telegram.org'], DIRECT, 5555));
    expect(find('https://youtube.com/')).toBe(STUB);
    expect(find('https://www.youtube.com/watch?v=1')).toBe(STUB);
    expect(find('http://m.youtube.com/')).toBe(STUB);
    expect(find('https://WWW.YOUTUBE.COM/')).toBe(STUB);
    expect(find('https://web.telegram.org/k/')).toBe(STUB);
    expect(find('https://telegram.org/')).toBe('DIRECT');
    expect(find('https://notyoutube.com/')).toBe('DIRECT');
    expect(find('https://youtube.com.example.org/')).toBe('DIRECT');
    expect(find('https://example.com/')).toBe('DIRECT');
  });

  it('пустой список — всё DIRECT', () => {
    const find = compile(buildPac([], DIRECT, 5555));
    expect(find('https://youtube.com/')).toBe('DIRECT');
  });

  it('исходный ручной прокси пользователя сохраняется для незаблокированных сайтов (§4.13)', () => {
    const up: Upstream = { type: 'proxy', server: 'proxy.corp:3128', bypass: ['*.corp.local', '<local>', '10.*'] };
    const find = compile(buildPac(['youtube.com'], up, 5555));
    expect(find('https://youtube.com/')).toBe(STUB);
    expect(find('https://example.com/')).toBe('PROXY proxy.corp:3128');
    expect(find('http://intranet/')).toBe('DIRECT');
    expect(find('http://wiki.corp.local/')).toBe('DIRECT');
    expect(find('http://10.1.2.3/')).toBe('DIRECT');
  });

  it('прокси по протоколам (http=…;https=…;socks=…)', () => {
    const up: Upstream = { type: 'proxy', server: 'http=hp:80;https=sp:443;socks=sk:1080', bypass: [] };
    const find = compile(buildPac([], up, 5555));
    expect(find('http://example.com/')).toBe('PROXY hp:80');
    expect(find('https://example.com/')).toBe('PROXY sp:443');
  });

  it('домены экранируются: строка из базы не может внедрить код в PAC', () => {
    const evil = 'x"; return "DIRECT';
    const pac = buildPac(['youtube.com', evil, 'a.com"]; FindProxyForURL = 0; //', '*'], DIRECT, 5555);
    const find = compile(pac);
    expect(find('https://youtube.com/')).toBe(STUB);
    expect(find('https://x/')).toBe('DIRECT');
    expect(find('https://example.com/')).toBe('DIRECT');
    // мусор отброшен целиком: в PAC только нормализованные домены
    expect(pac).not.toContain('return "DIRECT";\n  var');
    expect(pac).not.toContain('FindProxyForURL = 0');
  });

  it('upstream экранируется так же', () => {
    const up: Upstream = { type: 'proxy', server: 'p:1"; return "X', bypass: ['"; return "Y'] };
    const find = compile(buildPac([], up, 5555));
    expect(find('https://example.com/')).toBe('PROXY p:1"; return "X');
  });
});
