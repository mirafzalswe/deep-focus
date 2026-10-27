// Данные виджета: снимок таймера (источник правды — main), задача, статусы блокировки и звука.
import { useEffect, useState } from 'react';
import type { AudioStatus, BlockerStatus, TimerSnapshot } from '@shared/types';

export interface TimerView {
  snap: TimerSnapshot | null;
  /** Локальное время получения снимка — для плавного хода между рассылками. */
  receivedAt: number;
}

/** Снимок таймера + локальные «часы», чтобы время шло плавно между рассылками main. */
export function useTimer(): { view: TimerView; now: number } {
  const [view, setView] = useState<TimerView>({ snap: null, receivedAt: 0 });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.timer.onState((snap) => setView({ snap, receivedAt: Date.now() }));
    void window.deepFocus.timer.snapshot().then((snap) => {
      if (alive) setView((cur) => (cur.snap ? cur : { snap, receivedAt: Date.now() }));
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const running = view.snap?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  return { view, now };
}

/** Длительность фокуса активного пресета — что покажет виджет до старта. */
export function useIdleFocusMs(activePresetId: string): number | null {
  const [ms, setMs] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    void window.deepFocus.timer.presets().then((presets) => {
      const preset = presets.find((p) => p.id === activePresetId);
      if (alive) setMs(preset ? preset.focusMin * 60_000 : null);
    });
    return () => {
      alive = false;
    };
  }, [activePresetId]);
  return ms;
}

export function useTaskTitle(taskId: string | null, enabled: boolean): string | null {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !taskId) return;
    let alive = true;
    void window.deepFocus.tasks.list().then((tasks) => {
      if (alive) setTitle(tasks.find((t) => t.id === taskId)?.title ?? null);
    });
    return () => {
      alive = false;
    };
  }, [taskId, enabled]);
  return enabled && taskId ? title : null;
}

/** Статусы блокировки и звука — только для расширенного режима. */
export function useStatuses(enabled: boolean): { blocker: BlockerStatus | null; audio: AudioStatus | null } {
  const [blocker, setBlocker] = useState<BlockerStatus | null>(null);
  const [audio, setAudio] = useState<AudioStatus | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const offs = [window.deepFocus.blocker.onStatus(setBlocker), window.deepFocus.audio.onStatus(setAudio)];
    void window.deepFocus.blocker.status().then((s) => alive && setBlocker(s)).catch(() => undefined);
    void window.deepFocus.audio.status().then((s) => alive && setAudio(s)).catch(() => undefined);
    return () => {
      alive = false;
      offs.forEach((off) => off());
    };
  }, [enabled]);
  return { blocker, audio };
}

export interface ClockFace {
  text: string;
  /** 0..1 — доля пройденного интервала; null — без лимита (секундомер, свободный режим). */
  progress: number | null;
}

export function formatDuration(ms: number, roundUp: boolean): string {
  const totalSec = Math.max(0, roundUp ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Что показать на циферблате по снимку и локальному времени. */
export function clockFace(view: TimerView, now: number, idleFocusMs: number | null): ClockFace {
  const snap = view.snap;
  if (!snap || snap.status === 'idle') {
    return { text: idleFocusMs !== null ? formatDuration(idleFocusMs, true) : '--:--', progress: idleFocusMs !== null ? 0 : null };
  }
  const drift = snap.status === 'running' ? Math.max(0, now - view.receivedAt) : 0;
  if (snap.plannedMs !== null && snap.remainingMs !== null) {
    const remaining = Math.max(0, snap.remainingMs - drift);
    return { text: formatDuration(remaining, true), progress: Math.min(1, 1 - remaining / snap.plannedMs) };
  }
  return { text: formatDuration(snap.activeMs + drift, false), progress: null };
}
