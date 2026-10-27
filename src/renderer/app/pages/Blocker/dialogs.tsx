// Диалоги блокировки: согласие на изменение системного прокси (§4.8.1) и объяснение строгого режима (§4.7).
import { useEffect, useRef, type ReactNode } from 'react';
import { useT } from '../../../shared/settings';
import { Button } from '../../../shared/ui';

export function Dialog({
  title,
  children,
  onClose,
  actions,
  name,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  actions: ReactNode;
  name: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-dialog={name}
        className="max-h-full w-full max-w-lg overflow-auto rounded-xl border border-line bg-surface p-6 shadow-[var(--df-shadow)] outline-none"
      >
        <h2 className="font-display text-lg font-semibold text-fg">{title}</h2>
        <div className="mt-3 text-sm text-muted">{children}</div>
        <div className="mt-6 flex justify-end gap-2">{actions}</div>
      </div>
    </div>
  );
}

function Section({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="mt-4">
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-faint">{title}</h3>
      <ul className="flex list-disc flex-col gap-1.5 pl-5">
        {items.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </div>
  );
}

export function ConsentDialog({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      name="blocker-consent"
      title={t('blocker.consent.title')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" data-blocker-action="consent-accept" onClick={onAccept}>
            {t('blocker.consent.accept')}
          </Button>
        </>
      }
    >
      <p>{t('blocker.consent.lead')}</p>
      <Section title={t('blocker.consent.changes')} items={[t('blocker.consent.change1'), t('blocker.consent.change2'), t('blocker.consent.change3')]} />
      <Section title={t('blocker.consent.restore')} items={[t('blocker.consent.restore1')]} />
    </Dialog>
  );
}

export function StrictDialog({ onAccept, onClose }: { onAccept: () => void; onClose: () => void }) {
  const t = useT();
  return (
    <Dialog
      name="blocker-strict"
      title={t('blocker.strict.explainTitle')}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" data-blocker-action="strict-accept" onClick={onAccept}>
            {t('blocker.strict.explainAccept')}
          </Button>
        </>
      }
    >
      <p>{t('blocker.strict.explainLead')}</p>
      <Section
        title={t('blocker.strict.explainAvailable')}
        items={[t('blocker.strict.available1'), t('blocker.strict.available2'), t('blocker.strict.available3')]}
      />
    </Dialog>
  );
}
