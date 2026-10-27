// Локальный сервер блокировки на 127.0.0.1 (случайный свободный порт):
//  • GET /deep-focus.pac — текущий PAC;
//  • прокси-запрос HTTP к заблокированному сайту — страница «Заблокировано Deep Focus» (403);
//  • CONNECT (HTTPS) — отказ 403, туннель не открывается, браузер показывает ошибку соединения.
// Сюда приходят только заблокированные домены (остальное PAC отправляет мимо). Адреса запросов
// не пишутся ни в журнал, ни в базу: в сообщения об ошибках попадает только код ошибки.
import { createServer, get, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

export const PAC_PATH = '/deep-focus.pac';
const HOST = '127.0.0.1';

/** Адрес PAC принадлежит Deep Focus (а не корпоративный/чужой). */
export const isOurPacUrl = (url: string): boolean => /^http:\/\/127\.0\.0\.1:\d{1,5}\/deep-focus\.pac(\?[^#\s]*)?$/i.test(url);

export interface PacServerOptions {
  /** HTML страницы блокировки на текущем языке. */
  blockedPage: () => string;
  onError?: (message: string, err?: unknown) => void;
}

const errCode = (err: unknown) => (err && typeof err === 'object' && 'code' in err ? String(err.code) : 'error');

export class PacServer {
  private server: Server | null = null;
  private pac = 'function FindProxyForURL(url, host) { return "DIRECT"; }\n';
  private readonly sockets = new Set<Socket>();

  constructor(private readonly opts: PacServerOptions) {}

  /** Запускает сервер (повторный вызов — тот же порт). */
  async start(): Promise<number> {
    const addr = this.address();
    if (addr) return addr.port;
    const server = createServer((req, res) => this.onRequest(req, res));
    server.on('connect', (_req: IncomingMessage, socket: Socket) => {
      socket.on('error', () => undefined);
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
    });
    server.on('connection', (s: Socket) => {
      this.sockets.add(s);
      s.on('close', () => this.sockets.delete(s));
    });
    server.on('clientError', (_err, socket) => socket.destroy());
    server.on('error', (err) => this.opts.onError?.(`pac server error: ${errCode(err)}`));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, HOST, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
    return (server.address() as AddressInfo).port;
  }

  address(): { host: string; port: number } | null {
    const a = this.server?.address();
    return a && typeof a === 'object' ? { host: a.address, port: a.port } : null;
  }

  setPac(text: string): void {
    this.pac = text;
  }

  /** Адрес PAC для реестра; ?v= меняется при каждой записи, чтобы браузеры перечитали файл. */
  pacUrl(version: number): string {
    const addr = this.address();
    if (!addr) throw new Error('PAC server is not running');
    return `http://${HOST}:${addr.port}${PAC_PATH}?v=${Math.trunc(version)}`;
  }

  /** Сервер слушает порт и отдаёт ровно текущий PAC. */
  selfCheck(timeoutMs = 3000): Promise<boolean> {
    const addr = this.address();
    if (!addr) return Promise.resolve(false);
    const expected = this.pac;
    return new Promise((resolve) => {
      const req = get({ host: HOST, port: addr.port, path: PAC_PATH, timeout: timeoutMs }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => resolve(res.statusCode === 200 && body === expected));
        res.on('error', () => resolve(false));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(false));
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    for (const s of this.sockets) s.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private onRequest(req: IncomingMessage, res: ServerResponse): void {
    res.on('error', () => undefined);
    const url = req.url ?? '';
    if (req.method === 'GET' && (url === PAC_PATH || url.startsWith(`${PAC_PATH}?`))) {
      res.writeHead(200, {
        'Content-Type': 'application/x-ns-proxy-autoconfig; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(this.pac);
      return;
    }
    // Запрос в форме прокси (абсолютный URL) — это заблокированный сайт по HTTP.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
      let page: string;
      try {
        page = this.opts.blockedPage();
      } catch (err) {
        this.opts.onError?.('blocked page render failed', err);
        page = '<!doctype html><title>Deep Focus</title><h1>Deep Focus</h1>';
      }
      res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'close' });
      res.end(page);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', Connection: 'close' });
    res.end('Not found');
  }
}
