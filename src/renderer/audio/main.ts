// Скрытое окно audio: команды приходят только из main (audioEngine.onCommand), ответы — reportStatus.
import { AudioEngine } from './engine';

const api = window.deepFocus.audioEngine;
const engine = new AudioEngine((report) => api.reportStatus(report));

// Снимок состояния для e2e-проверок (окно скрытое; в остальные окна не попадает)
(window as unknown as { __dfAudio: () => ReturnType<AudioEngine['debugState']> }).__dfAudio = () => engine.debugState();

window.addEventListener('error', (e) => api.reportStatus({ type: 'error', message: String(e.message).slice(0, 1000) }));
window.addEventListener('unhandledrejection', (e) =>
  api.reportStatus({ type: 'error', message: String(e.reason).slice(0, 1000) }),
);

api.onCommand((cmd) => engine.handle(cmd));
api.reportStatus({ type: 'ready' });
