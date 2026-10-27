// Настройки → Общие → Обновления (Т08): версия, «Проверить обновления», скачивание по кнопке.
// Пока источник (GitHub) не настроен, main отвечает «выключено» и сетевых запросов нет.
import { useEffect, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { UpdateStatus } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, Card, Field } from '../../../shared/ui';

export function UpdatesCard() {
  const t = useT();
  const [version, setVersion] = useState('');
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.deepFocus.app.version(), window.deepFocus.app.updateStatus()]).then(([v, s]) => {
      if (!alive) return;
      setVersion(v);
      setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const run = async () => {
    setBusy(true);
    try {
      setStatus(await window.deepFocus.app.checkUpdates());
    } finally {
      setBusy(false);
    }
  };

  const message = (s: UpdateStatus): MessageKey | null => {
    if (s.reasonKey) return s.reasonKey as MessageKey;
    switch (s.state) {
      case 'notAvailable':
        return 'updates.upToDate';
      case 'available':
        return 'updates.available';
      case 'downloaded':
        return 'updates.downloaded';
      default:
        return null;
    }
  };
  const shown = status ? message(status) : null;
  const label = status?.state === 'available' ? t('updates.download', { version: status.version ?? '' }) : t('updates.check');
  const disabled = busy || status?.state === 'checking' || status?.state === 'downloaded';

  return (
    <Card title={t('updates.title')}>
      <Field label={`Deep Focus ${version}`} hint={shown && status ? <span data-update-message={status.state}>{t(shown, { version: status.version ?? '' })}</span> : undefined}>
        <Button data-action="check-updates" disabled={disabled} onClick={() => void run()}>
          {busy ? t('updates.checking') : label}
        </Button>
      </Field>
    </Card>
  );
}
