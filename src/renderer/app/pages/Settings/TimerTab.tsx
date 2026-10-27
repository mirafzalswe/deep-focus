// Настройки → Таймер: активный пресет и его длительности, автопереключение, продление свободного режима.
import { useState } from 'react';
import { useSettings, useT } from '../../../shared/settings';
import { Card, Field } from '../../../shared/ui';
import { MinutesInput, Toggle } from '../Timer/controls';
import { PresetForm } from '../Timer/PresetEditor';
import { parseMinutes, useTimerPresets } from '../Timer/useTimer';

export default function TimerTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const { presets, reload } = useTimerPresets();
  const timer = settings.timer;
  const active = presets.find((p) => p.id === timer.activePresetId) ?? presets[0];
  const [extend, setExtend] = useState(String(timer.freeExtendMin));
  const extendInvalid = parseMinutes(extend) === null;

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('timer.settings.durations')}>
        <Field label={t('timer.settings.activePreset')}>
          <select
            aria-label={t('timer.settings.activePreset')}
            value={active?.id ?? ''}
            onChange={(e) => void patch({ timer: { activePresetId: e.target.value } })}
            className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
          >
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        {active && (
          <div className="mt-3 border-t border-line pt-4">
            <PresetForm key={`${active.id}:${JSON.stringify(active)}`} preset={active} onSaved={() => void reload()} />
          </div>
        )}
      </Card>

      <Card title={t('timer.settings.behavior')}>
        <Field label={t('timer.settings.autoSwitch')} hint={t('timer.settings.autoSwitchHint')}>
          <Toggle
            label={t('timer.settings.autoSwitch')}
            checked={timer.autoSwitch}
            onChange={(autoSwitch) => void patch({ timer: { autoSwitch } })}
          />
        </Field>
        <Field label={t('timer.settings.autoStartNextCycle')} hint={t('timer.settings.autoStartNextCycleHint')}>
          <Toggle
            label={t('timer.settings.autoStartNextCycle')}
            checked={timer.autoStartNextCycle}
            disabled={!timer.autoSwitch}
            onChange={(autoStartNextCycle) => void patch({ timer: { autoStartNextCycle } })}
          />
        </Field>
        <Field label={t('timer.settings.keepBlockingOnPause')}>
          <Toggle
            label={t('timer.settings.keepBlockingOnPause')}
            checked={timer.keepBlockingOnPause}
            onChange={(keepBlockingOnPause) => void patch({ timer: { keepBlockingOnPause } })}
          />
        </Field>
        <Field
          label={t('timer.settings.freeExtendMin')}
          hint={extendInvalid ? <span className="text-danger">{t('timer.settings.invalidMinutes')}</span> : t('timer.settings.freeExtendMinHint')}
        >
          <MinutesInput
            name="freeExtendMin"
            label={t('timer.settings.freeExtendMin')}
            value={extend}
            invalid={extendInvalid}
            onChange={(v) => {
              setExtend(v);
              const min = parseMinutes(v);
              if (min !== null) void patch({ timer: { freeExtendMin: min } });
            }}
          />
        </Field>
      </Card>
    </div>
  );
}
