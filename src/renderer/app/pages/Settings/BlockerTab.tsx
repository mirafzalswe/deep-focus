// Настройки → Блокировка сайтов: включение (через согласие), уровень Standard/Strict (через объяснение),
// ожидание снятия Strict, режим расписаний. Пока Strict запирает блокировку, эти настройки недоступны.
import { useState } from 'react';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, Field, Segmented } from '../../../shared/ui';
import { useEnableBlocker, useStrictLevel } from '../Blocker/flows';
import { useBlockerStatus } from '../Blocker/useBlocker';
import { TextInput, Toggle } from '../Timer/controls';

const parseDelay = (s: string): number | null => {
  if (!/^\d{1,4}$/.test(s.trim())) return null;
  const n = Number(s);
  return n >= 0 && n <= 3600 ? n : null;
};

export default function BlockerTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const blocker = settings.blocker;
  const status = useBlockerStatus();
  const { enable, dialog: consentDialog } = useEnableBlocker(status);
  const { setLevel, dialog: strictDialog } = useStrictLevel();
  const [delay, setDelay] = useState(String(blocker.strictUnlockDelaySec));
  const delayInvalid = parseDelay(delay) === null;
  const locked = status?.strictLocked ?? false;
  const lockedHint = locked ? t('blocker.strict.lockedSetting') : undefined;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <Field label={t('blocker.settings.enabled')} hint={lockedHint ?? t('blocker.settings.enabledHint')}>
          <Toggle
            label={t('blocker.settings.enabled')}
            checked={blocker.enabled && (status?.consentGiven ?? false)}
            disabled={locked}
            onChange={(on) => (on ? enable() : void patch({ blocker: { enabled: false } }))}
          />
        </Field>
        <Field label={t('blocker.settings.level')} hint={lockedHint ?? t('blocker.settings.levelHint')}>
          <fieldset disabled={locked} className="disabled:opacity-50">
            <Segmented
              label={t('blocker.settings.level')}
              value={blocker.level}
              onChange={setLevel}
              options={[
                { value: 'standard', label: t('blocker.settings.standard') },
                { value: 'strict', label: t('blocker.settings.strictLevel') },
              ]}
            />
          </fieldset>
        </Field>
        <Field
          label={t('blocker.settings.delay')}
          hint={delayInvalid ? <span className="text-danger">{t('blocker.settings.invalidDelay')}</span> : t('blocker.settings.delayHint')}
        >
          <TextInput
            name="strictUnlockDelaySec"
            inputMode="numeric"
            aria-label={t('blocker.settings.delay')}
            value={delay}
            invalid={delayInvalid}
            disabled={locked}
            onChange={(e) => {
              setDelay(e.target.value);
              const sec = parseDelay(e.target.value);
              if (sec !== null) void patch({ blocker: { strictUnlockDelaySec: sec } });
            }}
            className="w-24 text-right tabular-nums"
          />
        </Field>
        {/* Strict во время сессии: выключение расписаний может снять действующий домен — main его отклонит;
            включить можно всегда (блокировка только добавляется) */}
        <Field
          label={t('blocker.settings.scheduled')}
          hint={(locked && blocker.scheduledEnabled ? lockedHint : undefined) ?? t('blocker.settings.scheduledHint')}
        >
          <Toggle
            label={t('blocker.settings.scheduled')}
            checked={blocker.scheduledEnabled}
            disabled={locked && blocker.scheduledEnabled}
            onChange={(scheduledEnabled) => void patch({ blocker: { scheduledEnabled } })}
          />
        </Field>
      </Card>
      <Card>
        <Field label={t('blocker.settings.openRules')}>
          <Button onClick={() => (window.location.hash = '#/blocker')}>{t('blocker.settings.openRulesAction')}</Button>
        </Field>
      </Card>
      {consentDialog}
      {strictDialog}
    </div>
  );
}
