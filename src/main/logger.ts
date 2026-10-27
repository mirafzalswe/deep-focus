// Локальный журнал технических ошибок: userData/logs/deepfocus.log, ротация 1 МБ × 3 (§12.1).
// Только технические сообщения — никаких URL, посещённых адресов и пользовательских данных.
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

export interface Logger {
  readonly path: string;
  error(scope: string, msg: string, err?: unknown): void;
  warn(scope: string, msg: string, err?: unknown): void;
  info(scope: string, msg: string, err?: unknown): void;
}

export interface LoggerOptions {
  /** Максимальный размер одного файла. По умолчанию 1 МБ. */
  maxBytes?: number;
  /** Сколько файлов хранить, включая текущий. По умолчанию 3. */
  maxFiles?: number;
  /** Дублировать в консоль (dev). */
  console?: boolean;
}

function formatError(err: unknown): string {
  if (err === undefined) return '';
  if (err instanceof Error) return `\n    ${(err.stack ?? `${err.name}: ${err.message}`).replace(/\n/g, '\n    ')}`;
  try {
    return `\n    ${JSON.stringify(err)}`;
  } catch {
    return `\n    ${String(err)}`;
  }
}

export function createLogger(userDataDir: string, opts: LoggerOptions = {}): Logger {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const maxFiles = Math.max(1, opts.maxFiles ?? 3);
  const dir = join(userDataDir, 'logs');
  const path = join(dir, 'deepfocus.log');

  const rotate = () => {
    const oldest = `${path}.${maxFiles - 1}`;
    if (existsSync(oldest)) rmSync(oldest, { force: true });
    for (let i = maxFiles - 2; i >= 1; i--) {
      const from = `${path}.${i}`;
      if (existsSync(from)) renameSync(from, `${path}.${i + 1}`);
    }
    if (maxFiles > 1) renameSync(path, `${path}.1`);
    else rmSync(path, { force: true });
  };

  const write = (level: 'ERROR' | 'WARN' | 'INFO', scope: string, msg: string, err?: unknown) => {
    const line = `${new Date().toISOString()} ${level} [${scope}] ${msg}${formatError(err)}\n`;
    if (opts.console) (level === 'ERROR' ? console.error : console.log)(line.trimEnd());
    try {
      mkdirSync(dir, { recursive: true });
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > maxBytes) rotate();
      appendFileSync(path, line, 'utf8');
    } catch {
      // Журнал не должен ронять приложение: если диск недоступен — молча пропускаем запись.
    }
  };

  return {
    path,
    error: (scope, msg, err) => write('ERROR', scope, msg, err),
    warn: (scope, msg, err) => write('WARN', scope, msg, err),
    info: (scope, msg, err) => write('INFO', scope, msg, err),
  };
}
