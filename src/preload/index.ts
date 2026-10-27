// window.deepFocus — единственный путь renderer к системе. Каждый домен — в api/<domain>.ts.
import { contextBridge } from 'electron';
import { analytics } from './api/analytics';
import { app } from './api/app';
import { audio } from './api/audio';
import { audioEngine } from './api/audioEngine';
import { blocker } from './api/blocker';
import { hotkeys } from './api/hotkeys';
import { settings } from './api/settings';
import { tasks } from './api/tasks';
import { timer } from './api/timer';
import { widget } from './api/widget';

const api = { timer, widget, blocker, audio, audioEngine, tasks, analytics, settings, hotkeys, app };

export type DeepFocusApi = typeof api;

contextBridge.exposeInMainWorld('deepFocus', api);
