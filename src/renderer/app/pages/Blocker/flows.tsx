// Включение блокировки (через экран согласия при первом включении) и строгого режима (через объяснение).
import { useState, type ReactNode } from 'react';
import type { BlockerStatus } from '@shared/types';
import { useSettings } from '../../../shared/settings';
import { ConsentDialog, StrictDialog } from './dialogs';

export function useEnableBlocker(status: BlockerStatus | null): { enable: () => void; dialog: ReactNode } {
  const { patch } = useSettings();
  const [asking, setAsking] = useState(false);
  const enable = () => {
    if (status?.consentGiven) void patch({ blocker: { enabled: true } });
    else setAsking(true);
  };
  const dialog = asking ? (
    <ConsentDialog
      onClose={() => setAsking(false)}
      onAccept={() => {
        setAsking(false);
        void window.deepFocus.blocker.giveConsent();
      }}
    />
  ) : null;
  return { enable, dialog };
}

export function useStrictLevel(): { setLevel: (level: 'standard' | 'strict') => void; dialog: ReactNode } {
  const { patch } = useSettings();
  const [asking, setAsking] = useState(false);
  const setLevel = (level: 'standard' | 'strict') => {
    if (level === 'strict') setAsking(true);
    else void patch({ blocker: { level } });
  };
  const dialog = asking ? (
    <StrictDialog
      onClose={() => setAsking(false)}
      onAccept={() => {
        setAsking(false);
        void patch({ blocker: { level: 'strict' } });
      }}
    />
  ) : null;
  return { setLevel, dialog };
}
