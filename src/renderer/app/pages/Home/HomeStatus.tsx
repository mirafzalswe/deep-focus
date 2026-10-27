// Home (§10.2): выбор звукового профиля и статус блокировки — по одной строке, без второстепенных настроек.
import { useEffect, useState } from 'react';
import { translateDynamic } from '@shared/i18n';
import type { ModuleStatus } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, Card, cx } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { useBlockerStatus } from '../Blocker/useBlocker';
import { useAudioStatus, useSoundPresets } from '../Sounds/useAudio';

const FALLBACK_PRESET = 'rain-focus';

export function SoundProfileCard() {
  const t = useT();
  const { settings, patch } = useSettings();
  const status = useAudioStatus();
  const { presets } = useSoundPresets();
  const selected = status?.presetId ?? settings.sound.workPresetId ?? FALLBACK_PRESET;
  const playing = status?.playing ?? false;
  const audio = window.deepFocus.audio;

  return (
    <Card title={t('system.home.sound')} className="flex-1">
      <div className="flex flex-wrap items-center gap-3" data-home-sound data-audio-playing={playing ? 'true' : 'false'}>
        <select
          aria-label={t('system.home.soundPreset')}
          value={selected}
          onChange={(e) => {
            const id = e.target.value;
            // Выбранный профиль становится рабочим (для автозапуска с сессией); если звук идёт — переключается сразу.
            void patch({ sound: { workPresetId: id } });
            if (playing) void audio.play(id);
          }}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <Button
          variant={playing ? 'secondary' : 'primary'}
          data-home-sound-toggle
          onClick={() => void (playing ? audio.stop() : audio.play(selected))}
        >
          {playing ? t('system.home.stop') : t('system.home.play')}
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">{playing ? t('system.home.soundPlaying') : t('system.home.soundSilent')}</p>
    </Card>
  );
}

const TONE = { ok: 'bg-ok', danger: 'bg-danger', warn: 'bg-warn', faint: 'bg-faint' } as const;

export function BlockerStatusCard({ navigate }: Pick<PageProps, 'navigate'>) {
  const t = useT();
  const { settings } = useSettings();
  const status = useBlockerStatus();
  const [moduleDown, setModuleDown] = useState(false);

  useEffect(() => {
    let alive = true;
    void window.deepFocus.app.modules().then((list: ModuleStatus[]) => {
      if (alive) setModuleDown(list.some((m) => m.name === 'blocker' && m.state === 'error'));
    });
    return () => {
      alive = false;
    };
  }, []);

  const enabled = settings.blocker.enabled && (status?.consentGiven ?? false);
  // Модуль не поднялся — честно говорим, что блокировка недоступна; таймер и звук работают (§4.15, R148).
  const state = moduleDown ? 'error' : !enabled ? 'disabled' : (status?.state ?? 'off');
  const tone = state === 'active' ? 'ok' : state === 'error' ? 'danger' : state === 'unavailable' ? 'warn' : 'faint';
  const reason = moduleDown
    ? t('system.moduleError', { name: t('blocker.title') })
    : enabled && status?.reasonKey && (state === 'error' || state === 'unavailable')
      ? translateDynamic(settings.general.language, status.reasonKey)
      : null;

  return (
    <Card title={t('system.home.blocker')} className="flex-1">
      <div className="flex items-start justify-between gap-3" data-home-blocker={state}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', TONE[tone])} aria-hidden />
            <span className="text-sm font-semibold text-fg">{t(`blocker.state.${state}`)}</span>
          </div>
          {reason && (
            <p role={state === 'error' ? 'alert' : undefined} className="mt-1.5 text-xs text-muted">
              {reason}
            </p>
          )}
        </div>
        <Button variant="ghost" onClick={() => navigate('blocker')}>
          {t('system.home.blockerDetails')}
        </Button>
      </div>
    </Card>
  );
}
