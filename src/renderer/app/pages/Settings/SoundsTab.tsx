// Настройки → Звуки (§5.8–5.10, §5.6): профили для работы и отдыха, автозапуск с сессией,
// поведение на перерыве, громкость на перерыве, затухание при остановке.
import type { AppSettings } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Card, Field, Segmented } from '../../../shared/ui';
import { useSoundPresets } from '../Sounds/useAudio';
import { VolumeSlider } from '../Sounds/VolumeSlider';
import { Toggle } from '../Timer/controls';

type BreakBehavior = AppSettings['sound']['breakBehavior'];
const BEHAVIORS: BreakBehavior[] = ['stop', 'continue', 'switch', 'lower'];
const NONE = '';

const selectClass = 'rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg';

export default function SoundsTab() {
  const t = useT();
  const { settings, patch } = useSettings();
  const { presets } = useSoundPresets();
  const sound = settings.sound;
  const set = (p: Partial<AppSettings['sound']>) => void patch({ sound: p });

  const presetSelect = (name: 'workPresetId' | 'breakPresetId', label: string) => (
    <select
      aria-label={label}
      name={name}
      value={sound[name] ?? NONE}
      onChange={(e) => set({ [name]: e.target.value === NONE ? null : e.target.value })}
      className={selectClass}
    >
      <option value={NONE}>{t('sounds.settings.none')}</option>
      {presets.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );

  const fadeSec = sound.fadeOutMs / 1000;

  return (
    <div className="flex flex-col gap-5">
      <Card title={t('sounds.settings.profiles')}>
        <Field label={t('sounds.settings.workPreset')}>{presetSelect('workPresetId', t('sounds.settings.workPreset'))}</Field>
        <Field label={t('sounds.settings.breakPreset')}>{presetSelect('breakPresetId', t('sounds.settings.breakPreset'))}</Field>
        <Field label={t('sounds.settings.autoStart')} hint={t('sounds.settings.autoStartHint')}>
          <Toggle
            label={t('sounds.settings.autoStart')}
            checked={sound.autoStartOnSession}
            onChange={(autoStartOnSession) => set({ autoStartOnSession })}
          />
        </Field>
      </Card>

      <Card title={t('sounds.settings.breakTitle')}>
        <Field
          label={t('sounds.settings.breakBehavior')}
          hint={
            sound.breakBehavior === 'switch' ? (
              sound.breakPresetId ? (
                t('sounds.settings.switchHint')
              ) : (
                <span className="text-warn">{t('sounds.settings.switchNeedsPreset')}</span>
              )
            ) : undefined
          }
        >
          <Segmented
            label={t('sounds.settings.breakBehavior')}
            value={sound.breakBehavior}
            options={BEHAVIORS.map((b) => ({ value: b, label: t(`sounds.settings.behavior.${b}`) }))}
            onChange={(breakBehavior) => set({ breakBehavior })}
          />
        </Field>
        {sound.breakBehavior === 'lower' && (
          <Field label={t('sounds.settings.lowerFactor')}>
            <div className="flex items-center gap-3">
              <VolumeSlider
                label={t('sounds.settings.lowerFactor')}
                value={sound.lowerFactor}
                onChange={(lowerFactor) => set({ lowerFactor })}
                className="w-44"
              />
              <span className="w-10 text-right font-mono text-sm text-muted tabular-nums">{Math.round(sound.lowerFactor * 100)}%</span>
            </div>
          </Field>
        )}
      </Card>

      <Card title={t('sounds.settings.playback')}>
        <Field label={t('sounds.settings.fadeOut')}>
          <div className="flex items-center gap-3">
            <input
              type="range"
              name="fadeOutMs"
              aria-label={t('sounds.settings.fadeOut')}
              min={0}
              max={10}
              step={0.5}
              value={fadeSec}
              onChange={(e) => set({ fadeOutMs: Math.round(Number(e.target.value) * 1000) })}
              className="w-44 accent-[var(--df-accent)]"
            />
            <span className="w-12 text-right font-mono text-sm text-muted tabular-nums">
              {t('sounds.settings.fadeOutValue', { sec: fadeSec.toFixed(1) })}
            </span>
          </div>
        </Field>
      </Card>
    </div>
  );
}
