// Общие помощники preload: запрос в main и подписка на рассылку. Только каналы из IPC.
import { ipcRenderer } from 'electron';
import type { IpcChannel } from '../shared/ipc';
import type { Unsubscribe } from '../shared/types';

export function invoke<T>(channel: IpcChannel, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

export function subscribe<T>(channel: IpcChannel, cb: (payload: T) => void): Unsubscribe {
  const listener = (_event: unknown, payload: T) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
