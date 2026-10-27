import { describe, expect, it } from 'vitest';
import type { AudioStatus, TimerSnapshot } from '../../shared/types';
import { soundToggle, startPauseCommand } from './actions';

const snap = (over: Partial<TimerSnapshot>): TimerSnapshot =>
  ({ status: 'idle', mode: 'pomodoro', kind: 'focus', ...over }) as TimerSnapshot;

const audio = (over: Partial<AudioStatus>): AudioStatus => ({
  playing: false,
  presetId: null,
  tracks: [],
  masterVolume: 0.8,
  muted: false,
  missing: [],
  error: null,
  ...over,
});

describe('startPauseCommand', () => {
  it('idle → старт в текущем режиме; running → пауза; paused → продолжение', () => {
    expect(startPauseCommand(snap({ status: 'idle', mode: 'stopwatch' }), 15)).toEqual({ type: 'start', mode: 'stopwatch' });
    expect(startPauseCommand(snap({ status: 'running' }), 15)).toEqual({ type: 'pause' });
    expect(startPauseCommand(snap({ status: 'paused' }), 15)).toEqual({ type: 'resume' });
  });

  it('awaiting: Pomodoro — следующий интервал, Deep Work — продление', () => {
    expect(startPauseCommand(snap({ status: 'awaiting', kind: 'shortBreak' }), 15)).toEqual({ type: 'start', mode: 'pomodoro' });
    expect(startPauseCommand(snap({ status: 'awaiting', mode: 'free' }), 15)).toEqual({ type: 'extend', min: 15 });
  });
});

describe('soundToggle', () => {
  it('звук играет → остановить', () => {
    expect(soundToggle(audio({ playing: true, presetId: 'forest' }), 'rain-focus')).toEqual({ type: 'stop' });
  });

  it('тишина → включить последний пресет, иначе свой набор, иначе рабочий пресет', () => {
    expect(soundToggle(audio({ presetId: 'forest' }), 'rain-focus')).toEqual({ type: 'play', target: 'forest' });
    const tracks = [{ soundId: 'rain', enabled: true, volume: 0.5 }];
    expect(soundToggle(audio({ tracks }), 'rain-focus')).toEqual({ type: 'play', target: tracks });
    expect(soundToggle(audio({}), 'rain-focus')).toEqual({ type: 'play', target: 'rain-focus' });
    expect(soundToggle(audio({}), null)).toEqual({ type: 'play', target: 'rain-focus' });
  });
});
