// Данные звука в главном окне: статус микшера (рассылка audio:statusChanged), библиотека с доступностью, пресеты.
import { useCallback, useEffect, useState } from 'react';
import type { AudioStatus, SoundAvailability, SoundDef, SoundPreset } from '@shared/types';

export type LibraryItem = SoundDef & SoundAvailability;
export type Availability = 'available' | 'missing' | 'corrupt';

export const availabilityOf = (s: SoundAvailability): Availability =>
  s.available ? 'available' : s.path === null ? 'missing' : 'corrupt';

export function useAudioStatus(): AudioStatus | null {
  const [status, setStatus] = useState<AudioStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.audio.onStatus(setStatus);
    void window.deepFocus.audio.status().then((s) => alive && setStatus((cur) => cur ?? s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

export function useSoundPresets(): { presets: SoundPreset[]; reload: () => Promise<void> } {
  const [presets, setPresets] = useState<SoundPreset[]>([]);
  const reload = useCallback(async () => setPresets(await window.deepFocus.audio.presets()), []);
  useEffect(() => {
    let alive = true;
    void window.deepFocus.audio.presets().then((list) => alive && setPresets(list));
    return () => {
      alive = false;
    };
  }, []);
  return { presets, reload };
}

/** Библиотека перечитывается при открытии и когда меняется список недоступных дорожек (файл повреждён и т.п.). */
export function useSoundLibrary(missingKey: string): { library: LibraryItem[] | null; reload: () => Promise<void> } {
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const reload = useCallback(async () => setLibrary(await window.deepFocus.audio.library()), []);
  useEffect(() => {
    let alive = true;
    void window.deepFocus.audio.library().then((list) => alive && setLibrary(list));
    return () => {
      alive = false;
    };
  }, [missingKey]);
  return { library, reload };
}
