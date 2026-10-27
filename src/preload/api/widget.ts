import { IPC } from '../../shared/ipc';
import type { Anchor } from '../../shared/types';
import { invoke, subscribe } from '../bridge';

export const widget = {
  show: () => invoke<void>(IPC.widget.show),
  hide: () => invoke<void>(IPC.widget.hide),
  toggle: () => invoke<void>(IPC.widget.toggle),
  setClickThrough: (on: boolean) => invoke<void>(IPC.widget.setClickThrough, on),
  setAlwaysOnTop: (on: boolean) => invoke<void>(IPC.widget.setAlwaysOnTop, on),
  snapTo: (anchor: Anchor) => invoke<void>(IPC.widget.snapTo, anchor),
  isVisible: () => invoke<boolean>(IPC.widget.isVisible),
  /** Только окно виджета: контекстное меню (режим, угол, поверх окон, click-through, скрыть). */
  showMenu: () => invoke<void>(IPC.widget.showMenu),
  /** Только окно виджета: размер от уголка ресайза, main ограничивает минимумом режима. */
  resize: (width: number, height: number) => invoke<void>(IPC.widget.resize, width, height),
  onVisibility: (cb: (visible: boolean) => void) => subscribe(IPC.widget.visibilityChanged, cb),
};
