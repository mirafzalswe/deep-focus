// Только для скрытого окна audio: команды движку от main и ответный статус. Формат команд — Т05.
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import { subscribe } from '../bridge';

export const audioEngine = {
  onCommand: (cb: (command: unknown) => void) => subscribe(IPC.audio.engineCommand, cb),
  reportStatus: (status: unknown) => ipcRenderer.send(IPC.audio.engineStatus, status),
};
