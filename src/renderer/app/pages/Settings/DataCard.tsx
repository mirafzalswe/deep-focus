// Настройки → Общие → Данные (§11.3, §11.4): где лежат данные и журнал, открыть папку, резервная копия,
// «Удалить все данные» с подтверждением вводом слова (проверяет и выполняет main).
import { useEffect, useState } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { FileActionResult } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, Card, Field } from '../../../shared/ui';

const inputClass =
  'rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent focus:outline-none';

function DeleteAllData() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const expected = t('settings.deleteConfirmWord');
  const matches = word.trim().toLocaleUpperCase() === expected.toLocaleUpperCase();

  if (!open) {
    return (
      <Button variant="danger" data-action="delete-all-data" onClick={() => setOpen(true)}>
        {t('settings.deleteAllData')}
      </Button>
    );
  }

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.deepFocus.settings.deleteAllData(word);
      if (!res.ok) setError(res.errorKey as MessageKey);
    } catch {
      setError('common.error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 w-full rounded-lg border border-danger/40 bg-danger/5 p-4" data-delete-panel>
      <p className="text-sm text-fg">{t('settings.deleteAllDataConfirm')}</p>
      <label className="mt-3 block text-xs text-muted" htmlFor="delete-word">
        {t('settings.deleteTypeWord', { word: expected })}
      </label>
      <form
        className="mt-1.5 flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (matches && !busy) void submit();
        }}
      >
        <input
          id="delete-word"
          data-delete-word
          autoComplete="off"
          spellCheck={false}
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={expected}
          className={`${inputClass} w-48 font-mono`}
        />
        <Button type="submit" variant="danger" disabled={!matches || busy} data-action="delete-confirm">
          {t('settings.deleteConfirmButton')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
            setWord('');
            setError(null);
          }}
        >
          {t('common.cancel')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger" data-delete-error={error}>
          {t(error)}
        </p>
      )}
    </div>
  );
}

export function DataCard() {
  const t = useT();
  const [paths, setPaths] = useState({ data: '', log: '' });
  const [message, setMessage] = useState<{ key: MessageKey; ok: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void Promise.all([window.deepFocus.app.dataPath(), window.deepFocus.app.logPath()]).then(([data, log]) => {
      if (alive) setPaths({ data, log });
    });
    return () => {
      alive = false;
    };
  }, []);

  const report = (res: FileActionResult, okKey: MessageKey) => {
    if (res.ok) setMessage({ key: okKey, ok: true });
    else if ('errorKey' in res) setMessage({ key: res.errorKey as MessageKey, ok: false });
  };

  return (
    <Card title={t('settings.data')}>
      <p className="mb-4 text-sm text-muted">{t('settings.dataLocalOnly')}</p>
      <Field label={t('settings.dataPath')} hint={<span className="font-mono select-text break-all" data-path="data">{paths.data}</span>}>
        <Button onClick={() => void window.deepFocus.settings.openDataFolder()}>{t('settings.openDataFolder')}</Button>
      </Field>
      <Field label={t('settings.logPath')} hint={<span className="font-mono select-text break-all" data-path="log">{paths.log}</span>}>
        <span />
      </Field>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button data-action="export-backup" onClick={async () => report(await window.deepFocus.settings.exportBackup(), 'settings.backupSaved')}>
          {t('settings.exportBackup')}
        </Button>
        <Button data-action="import-backup" onClick={async () => report(await window.deepFocus.settings.importBackup(), 'settings.backupRestored')}>
          {t('settings.importBackup')}
        </Button>
        <span className="flex-1" />
        <DeleteAllData />
      </div>
      {message && (
        <p role="status" data-backup-message={message.ok ? 'ok' : 'error'} className={`mt-3 text-sm ${message.ok ? 'text-ok' : 'text-danger'}`}>
          {t(message.key)}
        </p>
      )}
    </Card>
  );
}
