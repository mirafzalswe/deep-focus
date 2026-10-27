import { IPC } from '../../shared/ipc';
import type { SessionOutcome, TimerCommand, TimerPreset, TimerSnapshot } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const timer = {
  command: (cmd: TimerCommand) => invoke<TimerSnapshot>(IPC.timer.command, cmd),
  snapshot: () => invoke<TimerSnapshot>(IPC.timer.snapshot),
  presets: () => invoke<TimerPreset[]>(IPC.timer.presets),
  savePreset: (p: TimerPreset) => invoke<TimerPreset>(IPC.timer.savePreset, p),
  deletePreset: (id: string) => invoke<boolean>(IPC.timer.deletePreset, id),
  setOutcome: (sessionId: string, outcome: SessionOutcome) => invoke<void>(IPC.timer.setOutcome, sessionId, outcome),
  onState: (cb: (snap: TimerSnapshot) => void) => subscribe(IPC.timer.state, cb),
};
