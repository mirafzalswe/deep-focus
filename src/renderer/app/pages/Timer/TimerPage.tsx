// Раздел «Таймер»: выбор режима и пресета, редактор пресетов, свой интервал, секундомер, свободный Deep Work.
import { useState, type ReactNode } from 'react';
import type { TimerCommand } from '@shared/types';
import { useT } from '../../../shared/settings';
import { Button, Card, PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { MinutesInput, Toggle } from './controls';
import { PresetList } from './PresetEditor';
import { parseMinutes, sendTimer, useTimerPresets, useTimerSnapshot } from './useTimer';

function ModeCard({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        <p className="mt-0.5 text-sm text-muted">{hint}</p>
      </div>
      {children}
    </Card>
  );
}

export default function TimerPage({ navigate }: PageProps) {
  const t = useT();
  const snap = useTimerSnapshot();
  const { presets, reload } = useTimerPresets();
  const [customMin, setCustomMin] = useState('30');
  const [freeMin, setFreeMin] = useState('90');
  const [freeUnlimited, setFreeUnlimited] = useState(false);
  const [invalid, setInvalid] = useState<'custom' | 'free' | null>(null);

  const busy = snap?.status === 'running' || snap?.status === 'paused';
  const start = async (cmd: Extract<TimerCommand, { type: 'start' }>) => {
    await sendTimer(cmd);
    navigate('home');
  };

  const startButton = (onClick: () => void, action: string) => (
    <Button variant="primary" disabled={busy} data-timer-start={action} onClick={onClick}>
      {t('timer.actions.start')}
    </Button>
  );

  return (
    <>
      <PageHeader title={t('timer.title')} subtitle={t('timer.subtitle')} />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <ModeCard title={t('timer.modes.pomodoro')} hint={t('timer.modeHints.pomodoro')}>
          <PresetList presets={presets} reload={reload} />
          <div className="mt-5 flex justify-end border-t border-line pt-4">
            {startButton(() => void start({ type: 'start', mode: 'pomodoro', kind: 'focus' }), 'pomodoro')}
          </div>
        </ModeCard>

        <div className="flex flex-col gap-5">
          <ModeCard title={t('timer.custom.title')} hint={t('timer.custom.hint')}>
            <div className="flex items-center justify-between gap-3">
              <MinutesInput
                name="customMin"
                label={t('timer.custom.minutes')}
                value={customMin}
                invalid={invalid === 'custom'}
                onChange={(v) => {
                  setCustomMin(v);
                  setInvalid(null);
                }}
              />
              {startButton(() => {
                const min = parseMinutes(customMin);
                if (!min) return setInvalid('custom');
                void start({ type: 'start', mode: 'pomodoro', kind: 'focus', plannedMin: min });
              }, 'custom')}
            </div>
            {invalid === 'custom' && <p className="mt-2 text-sm text-danger">{t('timer.settings.invalidMinutes')}</p>}
          </ModeCard>

          <ModeCard title={t('timer.free.title')} hint={t('timer.modeHints.free')}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span>{t('timer.free.length')}</span>
                <MinutesInput
                  name="freeMin"
                  label={t('timer.free.length')}
                  value={freeMin}
                  disabled={freeUnlimited}
                  invalid={invalid === 'free'}
                  onChange={(v) => {
                    setFreeMin(v);
                    setInvalid(null);
                  }}
                />
              </label>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span>{t('timer.free.unlimited')}</span>
                <Toggle label={t('timer.free.unlimited')} checked={freeUnlimited} onChange={setFreeUnlimited} />
              </div>
              {invalid === 'free' && <p className="text-sm text-danger">{t('timer.settings.invalidMinutes')}</p>}
              <div className="flex justify-end">
                {startButton(() => {
                  if (freeUnlimited) return void start({ type: 'start', mode: 'free', plannedMin: null });
                  const min = parseMinutes(freeMin);
                  if (!min) return setInvalid('free');
                  void start({ type: 'start', mode: 'free', plannedMin: min });
                }, 'free')}
              </div>
            </div>
          </ModeCard>

          <ModeCard title={t('timer.modes.stopwatch')} hint={t('timer.modeHints.stopwatch')}>
            <div className="flex justify-end">
              {startButton(() => void start({ type: 'start', mode: 'stopwatch' }), 'stopwatch')}
            </div>
          </ModeCard>
        </div>
      </div>
    </>
  );
}
