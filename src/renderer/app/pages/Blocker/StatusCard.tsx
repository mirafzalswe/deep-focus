// Состояние блокировки: честный статус с причиной, кнопки «Выключить» / «Проверить снова», снятие Strict.
import { useState } from 'react';
import type { BlockerStatus } from '@shared/types';
import { translateDynamic } from '@shared/i18n';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, cx } from '../../../shared/ui';
import { TextInput } from '../Timer/controls';
import { formatCountdown, useNow } from './useBlocker';

type Tone = 'ok' | 'danger' | 'warn' | 'faint';

const TONE: Record<Tone, string> = {
  ok: 'bg-ok',
  danger: 'bg-danger',
  warn: 'bg-warn',
  faint: 'bg-faint',
};

export function StatusCard({ status, onEnable }: { status: BlockerStatus | null; onEnable: () => void }) {
  const t = useT();
  const { settings } = useSettings();
  const lang = settings.general.language;
  const enabled = settings.blocker.enabled && (status?.consentGiven ?? false);
  const state = status?.state ?? 'off';

  const tone: Tone = !enabled ? 'faint' : state === 'active' ? 'ok' : state === 'error' ? 'danger' : state === 'unavailable' ? 'warn' : 'faint';
  const title = !enabled ? t('blocker.state.disabled') : t(`blocker.state.${state}`);
  const reason = status?.reasonKey && (enabled || status.reasonKey === 'blocker.reason.needsConsent')
    ? translateDynamic(lang, status.reasonKey)
    : null;

  return (
    <Card title={t('blocker.statusCard')}>
      <div className="flex flex-wrap items-start justify-between gap-4" data-blocker-state={enabled ? state : 'disabled'}>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', TONE[tone])} aria-hidden />
            <span className="text-base font-semibold text-fg">{title}</span>
          </div>
          {reason && (
            <p className={cx('mt-2 text-sm', state === 'error' ? 'text-danger' : 'text-muted')} data-blocker-reason={status?.reasonKey ?? ''}>
              {reason}
            </p>
          )}
          {enabled && state === 'active' && status && (
            <p className="mt-2 text-sm text-muted">
              {t('blocker.activeCount', { count: status.activeDomains.length })}
              {status.verifiedAt !== null && (
                <> · {t('blocker.verifiedAt', { time: new Date(status.verifiedAt).toLocaleTimeString(lang) })}</>
              )}
            </p>
          )}
          {enabled && state === 'off' && !reason && <p className="mt-2 text-sm text-muted">{t('blocker.offHint')}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {!enabled && (
            <Button variant="primary" data-blocker-action="enable" onClick={onEnable}>
              {t('blocker.actions.enable')}
            </Button>
          )}
          {enabled && (state === 'error' || state === 'unavailable') && (
            <Button data-blocker-action="recheck" onClick={() => void window.deepFocus.blocker.recheck()}>
              {t('blocker.actions.recheck')}
            </Button>
          )}
          {enabled && state === 'active' && !status?.strictLocked && (
            <Button variant="danger" data-blocker-action="turn-off" title={t('blocker.actions.turnOffHint')} onClick={() => void window.deepFocus.blocker.requestUnlock()}>
              {t('blocker.actions.turnOff')}
            </Button>
          )}
        </div>
      </div>

      {enabled && state === 'active' && status?.strictLocked && <StrictUnlock status={status} />}

      <p className="mt-4 border-t border-line pt-3 text-xs text-muted">{t('blocker.openTabsHint')}</p>
    </Card>
  );
}

function StrictUnlock({ status }: { status: BlockerStatus }) {
  const t = useT();
  const now = useNow(500);
  const [phrase, setPhrase] = useState('');
  const [wrong, setWrong] = useState(false);
  const at = status.unlockAvailableAt;
  const ready = at !== null && now >= at;

  const confirm = async () => {
    const next = await window.deepFocus.blocker.confirmUnlock(phrase);
    setWrong(next.strictLocked);
  };

  return (
    <div className="mt-4 rounded-lg border border-line bg-surface-2 p-4" data-blocker-strict>
      <p className="text-sm text-fg">{t('blocker.strict.locked')}</p>
      {at === null && (
        <Button className="mt-3" data-blocker-action="unlock" onClick={() => void window.deepFocus.blocker.requestUnlock()}>
          {t('blocker.actions.unlock')}
        </Button>
      )}
      {at !== null && !ready && (
        <p className="mt-2 text-sm tabular-nums text-muted" data-blocker-countdown>
          {t('blocker.strict.waiting', { time: formatCountdown(at - now) })}
        </p>
      )}
      {ready && (
        <form
          className="mt-3 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void confirm();
          }}
        >
          <label className="w-full text-sm text-muted" htmlFor="blocker-phrase">
            {t('blocker.strict.typePhrase', { phrase: t('blocker.strict.phrase') })}
          </label>
          <TextInput
            id="blocker-phrase"
            aria-label={t('blocker.strict.phraseLabel')}
            value={phrase}
            invalid={wrong}
            autoComplete="off"
            onChange={(e) => {
              setPhrase(e.target.value);
              setWrong(false);
            }}
            className="min-w-0 flex-1"
          />
          <Button type="submit" variant="danger" data-blocker-action="confirm-unlock" disabled={!phrase.trim()}>
            {t('blocker.actions.confirmUnlock')}
          </Button>
          {wrong && <p className="w-full text-xs text-danger">{t('blocker.strict.wrongPhrase')}</p>}
        </form>
      )}
    </div>
  );
}
