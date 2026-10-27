import { request } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOurPacUrl, PacServer } from './PacServer';

/** host — заголовок Host: по умолчанию сам сервер (как у браузера, читающего PAC), для прокси-запроса — сайт. */
function get(
  port: number,
  path: string,
  host = `127.0.0.1:${port}`,
): Promise<{ status: number; type: string; nosniff: string | undefined; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', headers: { host } }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          type: String(res.headers['content-type']),
          nosniff: res.headers['x-content-type-options'] as string | undefined,
          body,
        }),
      );
    });
    req.on('error', reject);
    req.end();
  });
}

function rawConnect(port: number, target: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = connect(port, '127.0.0.1', () => sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    let data = '';
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => (data += c));
    sock.on('end', () => resolve(data));
    sock.on('close', () => resolve(data));
    sock.on('error', reject);
  });
}

let server: PacServer | null = null;
afterEach(async () => {
  await server?.stop();
  server = null;
});

describe('PacServer', () => {
  it('слушает 127.0.0.1 на случайном порту и отдаёт текущий PAC', async () => {
    const onError = vi.fn();
    server = new PacServer({ blockedPage: () => '<h1>Заблокировано Deep Focus</h1>', onError });
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
    expect(server.address()).toEqual({ host: '127.0.0.1', port });
    server.setPac('function FindProxyForURL(u, h) { return "DIRECT"; }');
    const url = server.pacUrl(42);
    expect(url).toBe(`http://127.0.0.1:${port}/deep-focus.pac?v=42`);
    expect(isOurPacUrl(url)).toBe(true);
    const res = await get(port, '/deep-focus.pac?v=42');
    expect(res.status).toBe(200);
    expect(res.type).toContain('application/x-ns-proxy-autoconfig');
    expect(res.body).toBe('function FindProxyForURL(u, h) { return "DIRECT"; }');
    expect(await server.selfCheck()).toBe(true);
  });

  it('HTTP-запрос к заблокированному сайту → страница «Заблокировано Deep Focus»; URL никуда не пишется', async () => {
    const onError = vi.fn();
    server = new PacServer({ blockedPage: () => '<h1>Заблокировано Deep Focus</h1>', onError });
    const port = await server.start();
    const res = await get(port, 'http://youtube.com/watch?v=secret-video', 'youtube.com');
    expect(res.status).toBe(403);
    expect(res.type).toContain('text/html');
    expect(res.body).toContain('Заблокировано Deep Focus');
    expect(res.body).not.toContain('secret-video');
    expect(JSON.stringify(onError.mock.calls)).not.toContain('secret-video');
  });

  it('PAC — только с Host 127.0.0.1:<порт> и с nosniff: чужая страница его не прочитает', async () => {
    server = new PacServer({ blockedPage: () => 'blocked' });
    const port = await server.start();
    server.setPac('function FindProxyForURL(u, h) { if (h == "youtube.com") return "PROXY 127.0.0.1:1"; return "PROXY corp:3128"; }');

    const own = await get(port, '/deep-focus.pac?v=1');
    expect(own.status).toBe(200);
    expect(own.nosniff).toBe('nosniff');

    // сайт, угадавший порт (в т. ч. через DNS rebinding), шлёт свой Host
    for (const host of [`evil.example:${port}`, `localhost:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `youtube.com`]) {
      const res = await get(port, '/deep-focus.pac?v=1', host);
      expect(res.status, host).toBe(403);
      expect(res.body, host).not.toContain('FindProxyForURL');
      expect(res.body, host).not.toContain('corp:3128');
      expect(res.nosniff, host).toBe('nosniff');
    }
    expect(await server.selfCheck()).toBe(true);
  });

  it('CONNECT (HTTPS) → отказ, туннель не открывается', async () => {
    server = new PacServer({ blockedPage: () => 'blocked' });
    const port = await server.start();
    const reply = await rawConnect(port, 'youtube.com:443');
    expect(reply).toMatch(/^HTTP\/1\.1 403 /);
  });

  it('прочие адреса → 404; после stop порт закрыт', async () => {
    server = new PacServer({ blockedPage: () => 'blocked' });
    const port = await server.start();
    expect((await get(port, '/other')).status).toBe(404);
    await server.stop();
    server = null;
    await expect(get(port, '/deep-focus.pac')).rejects.toThrow();
  });

  it('isOurPacUrl отличает чужой PAC', () => {
    expect(isOurPacUrl('http://127.0.0.1:5000/deep-focus.pac?v=1')).toBe(true);
    expect(isOurPacUrl('http://127.0.0.1:5000/proxy.pac')).toBe(false);
    expect(isOurPacUrl('http://wpad.corp.local/wpad.dat')).toBe(false);
    expect(isOurPacUrl('http://127.0.0.1.evil.com:5000/deep-focus.pac')).toBe(false);
  });
});
