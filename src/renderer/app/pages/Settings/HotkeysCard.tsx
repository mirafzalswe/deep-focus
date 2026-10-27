// Настройки → Общие → Горячие клавиши (§8.2, §8.3): поле записи сочетания для каждого из пяти действий.
// Проверка и регистрация — в main (hotkeys.assign); отказ оставляет прежнее сочетание рабочим.
import { useEffect, useState, type KeyboardEvent } from 'react';
import { DEFAULT_SETTINGS } from '@shared/defaults';
import { translateDynamic } from '@shared/i18n';
import type { HotkeyAction, HotkeyResult } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, cx } from '../../../shared/ui';
import { acceleratorFromEvent } from './accelerator';

const ACTIONS: readonly HotkeyAction[] = ['startPause', 'toggleWidget', 'toggleClickThrough', 'endSession', 'toggleSound'];

function useHotkeyResults(): HotkeyResult[] {
  const [results, setResults] = useState<HotkeyResult[]>([]);
  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.hotkeys.onResults(setResults);
    void window.deepFocus.hotkeys.results().then((r) => alive && setResults(r));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return results;
}

/** Общий редактор сочетания: клик — запись, Esc — отмена, уход фокуса — отмена. */
export function HotkeyField({ action, value, result }: { action: HotkeyAction; value: string; result: HotkeyResult | undefined }) {
  const t = useT();
  const { settings } = useSettings();
  const lang = settings.general.language;
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<{ key: string; ok: boolean } | null>(null);

  const stop = (assigned: boolean) => {
    setRecording(false);
    if (!assigned) void window.deepFocus.hotkeys.setRecording(false);
  };

  useEffect(() => () => void window.deepFocus.hotkeys.setRecording(false), []);

  const assign = async (accel: string) => {
    const res = await window.deepFocus.hotkeys.assign(action, accel);
    setMessage(res.reasonKey ? { key: res.reasonKey, ok: false } : { key: 'system.hotkeys.saved', ok: true });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) return stop(false);
    const accel = acceleratorFromEvent(e);
    if (accel === null) return; // ждём основную клавишу
    stop(true);
    void assign(accel);
  };

  const notWorking = result && !result.registered && result.reasonKey && result.accelerator === value && value !== '';

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0" data-hotkey={action}>
      <div className="min-w-0">
        <div className="text-sm text-fg">{t(`system.hotkeys.action.${action}`)}</div>
        {message && (
          <div role="status" data-hotkey-message className={cx('mt-0.5 text-xs', message.ok ? 'text-ok' : 'text-danger')}>
            {translateDynamic(lang, message.key)}
          </div>
        )}
        {!message && notWorking && (
          <div className="mt-0.5 text-xs text-warn" data-hotkey-warning>
            {t('system.hotkeys.notRegistered', { reason: translateDynamic(lang, result.reasonKey ?? '') })}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          data-hotkey-value={value}
          aria-label={t(`system.hotkeys.action.${action}`)}
          onClick={() => {
            setMessage(null);
            setRecording(true);
            void window.deepFocus.hotkeys.setRecording(true);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => recording && stop(false)}
          className={cx(
            'min-w-44 rounded-lg border px-3 py-1.5 text-left font-mono text-sm transition-colors',
            recording ? 'border-accent bg-accent/10 text-fg' : 'border-line bg-surface-2 text-fg hover:border-faint',
          )}
        >
          {recording ? t('system.hotkeys.recording') : value || <span className="text-faint">{t('system.hotkeys.off')}</span>}
        </button>
        <Button variant="ghost" disabled={value === ''} onClick={() => void assign('')} data-hotkey-clear>
          {t('system.hotkeys.clear')}
        </Button>
        <Button
          variant="ghost"
          disabled={value === DEFAULT_SETTINGS.hotkeys[action]}
          onClick={() => void assign(DEFAULT_SETTINGS.hotkeys[action])}
        >
          {t('system.hotkeys.reset')}
        </Button>
      </div>
    </div>
  );
}

export function HotkeysCard() {
  const t = useT();
  const { settings } = useSettings();
  const results = useHotkeyResults();
  return (
    <Card title={t('system.hotkeys.title')}>
      <p className="mb-3 text-sm text-muted">{t('system.hotkeys.hint')}</p>
      <div className="divide-y divide-line">
        {ACTIONS.map((action) => (
          <HotkeyField key={action} action={action} value={settings.hotkeys[action]} result={results.find((r) => r.action === action)} />
        ))}
      </div>
    </Card>
  );
}
