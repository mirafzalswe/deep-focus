// Общие: тема, язык (Т01) и данные. Автозапуск, трей, выход, горячие клавиши, уведомления — Т07.
import { useEffect, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { FileActionResult, Language, Theme } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, Field, Segmented } from '../../../shared/ui';

export default function GeneralTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const [logPath, setLogPath] = useState('');
  const [message, setMessage] = useState<{ key: MessageKey; ok: boolean } | null>(null);

  useEffect(() => {
    void window.deepFocus.app.logPath().then(setLogPath);
  }, []);

  const report = (res: FileActionResult, okKey: MessageKey) => {
    if (res.ok) setMessage({ key: okKey, ok: true });
    else if ('errorKey' in res) setMessage({ key: res.errorKey as MessageKey, ok: false });
  };

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('settings.appearance')}>
        <Field label={t('settings.theme')}>
          <Segmented<Theme>
            label={t('settings.theme')}
            value={settings.general.theme}
            onChange={(theme) => void patch({ general: { theme } })}
            options={[
              { value: 'dark', label: t('settings.themeDark') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'system', label: t('settings.themeSystem') },
            ]}
          />
        </Field>
        <Field label={t('settings.language')}>
          <Segmented<Language>
            label={t('settings.language')}
            value={settings.general.language}
            onChange={(language) => void patch({ general: { language } })}
            options={[
              { value: 'ru', label: t('settings.languageRu') },
              { value: 'en', label: t('settings.languageEn') },
            ]}
          />
        </Field>
      </Card>

      <Card title={t('settings.data')}>
        <p className="mb-4 text-sm text-muted">{t('settings.dataLocalOnly')}</p>
        <Field label={t('settings.logPath')} hint={<span className="font-mono select-text">{logPath}</span>}>
          <Button onClick={() => void window.deepFocus.settings.openDataFolder()}>{t('settings.openDataFolder')}</Button>
        </Field>
        <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
          <Button onClick={async () => report(await window.deepFocus.settings.exportBackup(), 'settings.backupSaved')}>
            {t('settings.exportBackup')}
          </Button>
          <Button onClick={async () => report(await window.deepFocus.settings.importBackup(), 'settings.backupRestored')}>
            {t('settings.importBackup')}
          </Button>
          <span className="flex-1" />
          <Button variant="danger" onClick={() => void window.deepFocus.settings.deleteAllData()}>
            {t('settings.deleteAllData')}
          </Button>
        </div>
        {message && (
          <p role="status" className={`mt-3 text-sm ${message.ok ? 'text-ok' : 'text-danger'}`}>
            {t(message.key)}
          </p>
        )}
      </Card>
    </div>
  );
}
