// Проверка на настоящем реестре текущего пользователя. Запускается только явно:
//   DF_REAL_REGISTRY=1 npx vitest run src/main/blocker/SystemProxy.registry.test.ts
// В finally возвращает исходные значения и проверяет, что они совпали.
import { describe, expect, it } from 'vitest';
import { buildPac } from './pac';
import { PacServer } from './PacServer';
import { createWindowsSystemProxy } from './SystemProxy';

const enabled = process.platform === 'win32' && process.env.DF_REAL_REGISTRY === '1';

describe.runIf(enabled)('SystemProxy на реальном реестре HKCU', () => {
  it('apply → системное разрешение прокси указывает на заглушку; restore → ровно исходное', { timeout: 60_000 }, async () => {
    const proxy = createWindowsSystemProxy();
    const original = await proxy.read();
    const server = new PacServer({ blockedPage: () => 'blocked' });
    try {
      const port = await server.start();
      server.setPac(buildPac(['youtube.com'], { type: 'direct' }, port));
      await proxy.apply(server.pacUrl(Date.now()));
      expect(await proxy.resolveProxyFor('https://youtube.com/')).toBe(`http://127.0.0.1:${port}/`);
      expect(await proxy.resolveProxyFor('https://www.youtube.com/watch')).toBe(`http://127.0.0.1:${port}/`);
      expect(await proxy.resolveProxyFor('https://example.com/')).toBe('https://example.com/');

      await proxy.restore(original);
      expect(await proxy.read()).toEqual(original);
      expect(await proxy.resolveProxyFor('https://youtube.com/')).toBe('https://youtube.com/');
    } finally {
      if (JSON.stringify(await proxy.read()) !== JSON.stringify(original)) await proxy.restore(original);
      await server.stop();
      expect(await proxy.read()).toEqual(original);
    }
  });
});
