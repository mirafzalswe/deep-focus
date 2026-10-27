// Раздел «Звуки» (§5): что играет и общая громкость, пресеты (встроенные + свои), библиотека по категориям
// с громкостью и включателем у каждой дорожки, пометки «файл не добавлен» / «файл повреждён», свои звуки.
import { useState } from 'react';
import { translateDynamic } from '@shared/i18n';
import type { AudioStatus, SoundCategory, SoundPreset } from '@shared/types';
import { useSettings, useT, type TFunction } from '../../../shared/settings';
import { Button, Card, cx, PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { TextInput, Toggle } from '../Timer/controls';
import { availabilityOf, useAudioStatus, useSoundLibrary, useSoundPresets, type LibraryItem } from './useAudio';
import { VolumeSlider } from './VolumeSlider';

const CATEGORIES: SoundCategory[] = ['nature', 'noise', 'ambience', 'custom'];
const DEFAULT_TRACK_VOLUME = 0.5;

export default function SoundsPage(_props: PageProps) {
  const t = useT();
  const status = useAudioStatus();
  const { presets, reload: reloadPresets } = useSoundPresets();
  const { library, reload: reloadLibrary } = useSoundLibrary(status ? status.missing.join(',') : '');
  const language = useSettings().settings.general.language;
  const nameOf = (item: { nameKey: string }) => translateDynamic(language, item.nameKey);

  if (!status || !library) return <PageHeader title={t('sounds.title')} subtitle={t('common.loading')} />;

  return (
    <>
      <PageHeader title={t('sounds.title')} subtitle={t('sounds.subtitle')} />
      <div className="flex flex-col gap-5">
        <PlayerCard status={status} presets={presets} library={library} nameOf={nameOf} t={t} />
        <PresetsCard status={status} presets={presets} reload={reloadPresets} t={t} />
        {CATEGORIES.map((category) => (
          <CategoryCard
            key={category}
            category={category}
            items={library.filter((s) => s.category === category)}
            status={status}
            nameOf={nameOf}
            onFileAdded={reloadLibrary}
            t={t}
          />
        ))}
      </div>
    </>
  );
}

function PlayerCard({
  status,
  presets,
  library,
  nameOf,
  t,
}: {
  status: AudioStatus;
  presets: SoundPreset[];
  library: LibraryItem[];
  nameOf: (i: { nameKey: string }) => string;
  t: TFunction;
}) {
  const { settings } = useSettings();
  const preset = presets.find((p) => p.id === status.presetId);
  const label = !status.playing ? t('sounds.silence') : preset ? preset.name : t('sounds.customMix');
  const hasMix = status.tracks.some((tr) => tr.enabled);
  const audio = window.deepFocus.audio;

  const play = () => {
    if (status.presetId) void audio.play(status.presetId);
    else if (hasMix) void audio.play(status.tracks);
    else void audio.play(settings.sound.workPresetId ?? 'rain-focus');
  };
  const missingNames = status.missing.map((id) => {
    const item = library.find((s) => s.id === id);
    return item ? nameOf(item) : id;
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4" data-audio-playing={status.playing ? 'true' : 'false'}>
        <div className="min-w-40 flex-1">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">{t('sounds.nowPlaying')}</div>
          <div className="mt-1 font-display text-lg text-fg" data-audio-now>
            {label}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status.playing ? (
            <Button variant="secondary" data-audio-action="stop" onClick={() => void audio.stop()}>
              {t('sounds.stop')}
            </Button>
          ) : (
            <Button variant="primary" data-audio-action="play" onClick={play}>
              {t('sounds.play')}
            </Button>
          )}
          <Button
            variant="ghost"
            data-audio-action="mute"
            aria-pressed={status.muted}
            onClick={() => void audio.toggleMute()}
          >
            {status.muted ? t('sounds.unmute') : t('sounds.mute')}
          </Button>
        </div>
        <label className="flex items-center gap-3 text-sm text-muted">
          {t('sounds.master')}
          <VolumeSlider
            label={t('sounds.master')}
            value={status.masterVolume}
            onChange={(v) => void audio.setMaster(v)}
            className="w-44"
          />
          <span className="w-10 text-right font-mono tabular-nums">{Math.round(status.masterVolume * 100)}%</span>
        </label>
      </div>
      {status.playing && missingNames.length > 0 && (
        <p className="mt-4 text-xs text-warn" data-audio-missing>
          {t('sounds.missingInMix', { list: missingNames.join(', ') })}
        </p>
      )}
      {status.error && (
        <p className="mt-4 text-xs text-danger" role="alert">
          {t('sounds.engineError')}
        </p>
      )}
    </Card>
  );
}

function PresetsCard({
  status,
  presets,
  reload,
  t,
}: {
  status: AudioStatus;
  presets: SoundPreset[];
  reload: () => Promise<void>;
  t: TFunction;
}) {
  const audio = window.deepFocus.audio;
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const canSave = status.tracks.some((tr) => tr.enabled);
  const level = presets.find((p) => p.id === status.presetId)?.masterVolume ?? 1;

  const saveMix = async () => {
    const preset: SoundPreset = {
      id: `mix-${Date.now().toString(36)}`,
      name: name.trim() || t('sounds.defaultPresetName'),
      builtin: false,
      tracks: status.tracks,
      masterVolume: level,
    };
    await audio.savePreset(preset);
    setName('');
    await reload();
  };
  const rename = async (p: SoundPreset, next: string) => {
    const trimmed = next.trim();
    if (trimmed && trimmed !== p.name) await audio.savePreset({ ...p, name: trimmed.slice(0, 100) });
    setEditing(null);
    await reload();
  };
  const remove = async (p: SoundPreset) => {
    await audio.deletePreset(p.id);
    await reload();
  };

  return (
    <Card title={t('sounds.presets')}>
      <ul className="flex flex-col divide-y divide-line">
        {presets.map((p) => {
          const active = status.playing && status.presetId === p.id;
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-3 py-2 first:pt-0" data-preset={p.id}>
              {editing?.id === p.id ? (
                <form
                  className="flex flex-1 items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename(p, editing.name);
                  }}
                >
                  <TextInput
                    autoFocus
                    aria-label={t('sounds.presetName')}
                    value={editing.name}
                    maxLength={100}
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    className="flex-1"
                  />
                  <Button type="submit" variant="primary">
                    {t('common.save')}
                  </Button>
                  <Button variant="ghost" onClick={() => setEditing(null)}>
                    {t('common.cancel')}
                  </Button>
                </form>
              ) : (
                <>
                  <button
                    type="button"
                    data-preset-play={p.id}
                    aria-pressed={active}
                    onClick={() => void audio.play(p.id)}
                    className={cx(
                      'flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-colors',
                      active ? 'bg-surface-2 text-fg' : 'text-fg hover:bg-surface-2',
                    )}
                  >
                    <span className={cx('h-2 w-2 shrink-0 rounded-full', active ? 'bg-accent' : 'bg-line')} />
                    <span className="truncate">{p.name}</span>
                    {p.builtin && <span className="text-xs text-faint">{t('sounds.builtin')}</span>}
                    {p.tracks.length === 0 && <span className="text-xs text-faint">{t('sounds.silentPreset')}</span>}
                  </button>
                  {!p.builtin && (
                    <div className="flex gap-1">
                      <Button variant="ghost" data-preset-rename={p.id} onClick={() => setEditing({ id: p.id, name: p.name })}>
                        {t('sounds.rename')}
                      </Button>
                      <Button
                        variant="ghost"
                        data-preset-delete={p.id}
                        aria-label={t('sounds.deletePreset', { name: p.name })}
                        onClick={() => void remove(p)}
                      >
                        {t('common.delete')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void saveMix();
        }}
      >
        <TextInput
          aria-label={t('sounds.presetName')}
          placeholder={t('sounds.defaultPresetName')}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          className="min-w-48 flex-1"
        />
        <Button type="submit" variant="secondary" data-audio-action="save-preset" disabled={!canSave}>
          {t('sounds.saveMix')}
        </Button>
        {!canSave && <span className="w-full text-xs text-muted">{t('sounds.nothingToSave')}</span>}
      </form>
    </Card>
  );
}

function CategoryCard({
  category,
  items,
  status,
  nameOf,
  onFileAdded,
  t,
}: {
  category: SoundCategory;
  items: LibraryItem[];
  status: AudioStatus;
  nameOf: (i: { nameKey: string }) => string;
  onFileAdded: () => Promise<void>;
  t: TFunction;
}) {
  const audio = window.deepFocus.audio;
  const addFile = async (soundId?: string) => {
    const added = await audio.addCustomSound(soundId);
    if (added) await onFileAdded();
  };

  return (
    <Card title={t(`sounds.category.${category}`)}>
      <ul className="flex flex-col divide-y divide-line" data-category={category}>
        {items.map((item) => {
          const track = status.tracks.find((tr) => tr.soundId === item.id);
          const availability = availabilityOf(item);
          const name = nameOf(item);
          const file = item.source.type === 'file' ? `${item.id}.mp3` : '';
          return (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
              data-sound={item.id}
              data-availability={availability}
            >
              <Toggle
                label={t('sounds.trackToggle', { name })}
                checked={!!track?.enabled}
                disabled={availability !== 'available' && !track?.enabled}
                onChange={(enabled) => void audio.setTrack(item.id, { enabled })}
              />
              <div className="min-w-32 flex-1">
                <div className={cx('text-sm', availability === 'available' ? 'text-fg' : 'text-muted')}>{name}</div>
                {availability !== 'available' && (
                  <div className="mt-0.5 text-xs" title={availability === 'missing' ? t('sounds.fileMissingHint', { file }) : t('sounds.fileCorruptHint')}>
                    <span className={availability === 'corrupt' ? 'text-danger' : 'text-warn'} data-file-status>
                      {availability === 'missing' ? t('sounds.fileMissing') : t('sounds.fileCorrupt')}
                    </span>
                    <span className="text-faint">
                      {' · '}
                      {availability === 'missing' ? t('sounds.fileMissingHint', { file }) : t('sounds.fileCorruptHint')}
                    </span>
                  </div>
                )}
              </div>
              {availability !== 'available' && category !== 'custom' && (
                <Button variant="ghost" data-choose-file={item.id} onClick={() => void addFile(item.id)}>
                  {t('sounds.chooseFile')}
                </Button>
              )}
              <VolumeSlider
                label={t('sounds.trackVolume', { name })}
                value={track?.volume ?? DEFAULT_TRACK_VOLUME}
                disabled={availability !== 'available'}
                onChange={(volume) => void audio.setTrack(item.id, { volume })}
              />
            </li>
          );
        })}
      </ul>
      {category === 'custom' && (
        <div className={cx('flex flex-wrap items-center gap-3', items.length > 0 && 'mt-4 border-t border-line pt-4')}>
          {items.length === 0 && <p className="flex-1 text-sm text-muted">{t('sounds.customEmpty')}</p>}
          <Button variant="secondary" data-audio-action="add-custom" onClick={() => void addFile()}>
            {t('sounds.addCustom')}
          </Button>
        </div>
      )}
    </Card>
  );
}
