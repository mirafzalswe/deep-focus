// Регистрация IPC-обработчиков с проверкой отправителя и аргументов.
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcChannel } from '../shared/ipc';
import { assertValid, ValidationError, type Check } from './validate';

let trustedOrigins: string[] = [];

/** index.ts задаёт допустимые источники: dev-сервер и file:// собранного приложения. */
export function setTrustedOrigins(origins: string[]): void {
  trustedOrigins = origins;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return trustedOrigins.some((origin) => url.startsWith(origin));
}

/**
 * ipcMain.handle с проверками: отправитель — только наши окна; число и типы аргументов — по checks.
 * Пример: handle<[string]>(IPC.tasks.remove, [v.id()], (id) => ...)
 */
export function handle<A extends unknown[]>(
  channel: IpcChannel,
  checks: { [K in keyof A]: Check },
  fn: (...args: A) => unknown,
): void {
  ipcMain.removeHandler(channel);
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    if (!isTrustedSender(event)) throw new Error(`Untrusted IPC sender for ${channel}`);
    if (args.length > checks.length) throw new ValidationError(`${channel}: too many arguments`);
    (checks as Check[]).forEach((check, i) => assertValid(check, args[i], `${channel}[${i}]`));
    return fn(...(args as A));
  });
}
