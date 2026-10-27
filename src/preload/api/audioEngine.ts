// Только для скрытого окна audio: команды движку от main и ответный статус.
// main принимает статус лишь от webContents окна движка (src/main/audio/engineHost.ts).
import { ipcRenderer } from 'electron';
import { IPC } from '../../shared/ipc';
import type { AudioEngineCommand, AudioEngineReport } from '../../shared/types';
import { subscribe } from '../bridge';

export const audioEngine = {
  onCommand: (cb: (command: AudioEngineCommand) => void) => subscribe(IPC.audio.engineCommand, cb),
  reportStatus: (report: AudioEngineReport) => ipcRenderer.send(IPC.audio.engineStatus, report),
};
