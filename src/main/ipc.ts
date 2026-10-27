// Регистрация IPC-обработчиков с проверкой отправителя и аргументов.
import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { IpcChannel } from '../shared/ipc';
import { assertValid, ValidationError, type Check } from './validate';

/** Пока index.ts не задал проверку, не доверяем никому. */
let isTrustedUrl: (url: string) => boolean = () => false;

/**
 * index.ts задаёт, чьи запросы выполнять: только собственные страницы renderer/{app,widget,audio}/index.html
 * (windows.isAppPageUrl). Не «любой file://»: перетащенный в окно .html получил бы весь window.deepFocus.
 */
export function setTrustedSender(check: (url: string) => boolean): void {
  isTrustedUrl = check;
}

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? '';
  return url !== '' && isTrustedUrl(url);
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
