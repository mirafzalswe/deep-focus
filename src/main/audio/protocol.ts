// Протокол df-sound:// для скрытого окна audio: отдаёт только файлы известных звуков
// и только из userData/sounds и assets/sounds (проверка — resolveSoundRequest).
// Схема объявляется привилегированной при импорте модуля — это возможно только до app.ready.
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { protocol } from 'electron';
import { resolveSoundRequest, SOUND_SCHEME, type SoundLibrary } from './library';

protocol.registerSchemesAsPrivileged([
  { scheme: SOUND_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};
// Страница audio загружена с file:// (origin "null") — fetch к df-sound:// для неё кросс-доменный.
const CORS = { 'access-control-allow-origin': '*' };

export function registerSoundProtocol(library: SoundLibrary): void {
  protocol.handle(SOUND_SCHEME, async (request) => {
    const path = resolveSoundRequest(request.url, library);
    if (!path) return new Response(null, { status: 404, headers: CORS });
    try {
      const data = await readFile(path);
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: { ...CORS, 'content-type': MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' },
      });
    } catch {
      return new Response(null, { status: 404, headers: CORS });
    }
  });
}
