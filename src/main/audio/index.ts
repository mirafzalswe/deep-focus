// './protocol' объявляет схему df-sound привилегированной при импорте — до app.ready.
import './protocol';

export { registerAudio } from './ipc';
export { AudioController } from './AudioController';
export type { EnginePort, TimerEventsSource } from './AudioController';
