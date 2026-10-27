import { IPC } from '../../shared/ipc';
import type { Anchor } from '../../shared/types';
import { invoke } from '../bridge';

export const widget = {
  show: () => invoke<void>(IPC.widget.show),
  hide: () => invoke<void>(IPC.widget.hide),
  toggle: () => invoke<void>(IPC.widget.toggle),
  setClickThrough: (on: boolean) => invoke<void>(IPC.widget.setClickThrough, on),
  setAlwaysOnTop: (on: boolean) => invoke<void>(IPC.widget.setAlwaysOnTop, on),
  snapTo: (anchor: Anchor) => invoke<void>(IPC.widget.snapTo, anchor),
};
