// Снимок таймера из main и команды. Источник правды — main; здесь только отображение.
import { useCallback, useEffect, useState } from 'react';
import type { TimerCommand, TimerPreset, TimerSnapshot } from '@shared/types';

export function useTimerSnapshot(): TimerSnapshot | null {
  const [snap, setSnap] = useState<TimerSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.timer.onState((next) => setSnap(next));
    void window.deepFocus.timer.snapshot().then((s) => {
      if (alive) setSnap((cur) => cur ?? s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snap;
}

export function sendTimer(cmd: TimerCommand): Promise<TimerSnapshot> {
  return window.deepFocus.timer.command(cmd);
}

export function useTimerPresets(): { presets: TimerPreset[]; reload: () => Promise<void> } {
  const [presets, setPresets] = useState<TimerPreset[]>([]);
  const reload = useCallback(async () => {
    setPresets(await window.deepFocus.timer.presets());
  }, []);
  useEffect(() => {
    let alive = true;
    void window.deepFocus.timer.presets().then((list) => {
      if (alive) setPresets(list);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { presets, reload };
}

/** 1500000 → «25:00», 3725000 → «1:02:05». Обратный отсчёт округляется вверх, прямой — вниз. */
export function formatClock(ms: number, roundUp: boolean): string {
  const total = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Целое 1–480 из поля ввода, иначе null. */
export function parseMinutes(text: string, max = 480): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 1 && n <= max ? n : null;
}
