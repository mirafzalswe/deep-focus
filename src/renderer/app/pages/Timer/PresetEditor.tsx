// Пресеты таймера: список (выбор активного, правка, удаление своих) и форма пресета.
import { useState } from 'react';
import type { TimerPreset } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, cx } from '../../../shared/ui';
import { MinutesInput, TextInput } from './controls';
import { parseMinutes } from './useTimer';

type Draft = { name: string; focusMin: string; shortBreakMin: string; longBreakMin: string; cyclesBeforeLong: string };

const toDraft = (p: TimerPreset): Draft => ({
  name: p.name,
  focusMin: String(p.focusMin),
  shortBreakMin: String(p.shortBreakMin),
  longBreakMin: String(p.longBreakMin),
  cyclesBeforeLong: String(p.cyclesBeforeLong),
});

function fromDraft(base: TimerPreset, d: Draft): TimerPreset | null {
  const focusMin = parseMinutes(d.focusMin);
  const shortBreakMin = parseMinutes(d.shortBreakMin);
  const longBreakMin = parseMinutes(d.longBreakMin);
  const cyclesBeforeLong = parseMinutes(d.cyclesBeforeLong, 20);
  const name = d.name.trim();
  if (!focusMin || !shortBreakMin || !longBreakMin || !cyclesBeforeLong || !name || name.length > 100) return null;
  return { ...base, name, focusMin, shortBreakMin, longBreakMin, cyclesBeforeLong };
}

/** Форма пресета. Неверное значение подсвечивается и не уходит в main (main проверяет ещё раз). */
export function PresetForm({
  preset,
  onSaved,
  onCancel,
}: {
  preset: TimerPreset;
  onSaved: (p: TimerPreset) => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => toDraft(preset));
  const [error, setError] = useState(false);
  const set = (k: keyof Draft) => (value: string) => {
    setDraft((d) => ({ ...d, [k]: value }));
    setError(false);
  };
  const bad = (k: Exclude<keyof Draft, 'name'>) => error && parseMinutes(draft[k], k === 'cyclesBeforeLong' ? 20 : 480) === null;

  const save = async () => {
    const next = fromDraft(preset, draft);
    if (!next) return setError(true);
    try {
      onSaved(await window.deepFocus.timer.savePreset(next));
    } catch {
      setError(true);
    }
  };

  const fields: Array<[Exclude<keyof Draft, 'name'>, Parameters<typeof t>[0]]> = [
    ['focusMin', 'timer.presets.focusMin'],
    ['shortBreakMin', 'timer.presets.shortBreakMin'],
    ['longBreakMin', 'timer.presets.longBreakMin'],
    ['cyclesBeforeLong', 'timer.presets.cyclesBeforeLong'],
  ];

  return (
    <form
      data-preset-form={preset.id}
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="flex items-center justify-between gap-4 text-sm">
        <span>{t('timer.presets.name')}</span>
        <TextInput
          name="name"
          value={draft.name}
          maxLength={100}
          invalid={error && !draft.name.trim()}
          onChange={(e) => set('name')(e.target.value)}
          className="w-56"
        />
      </label>
      {fields.map(([key, labelKey]) => (
        <label key={key} className="flex items-center justify-between gap-4 text-sm">
          <span>{t(labelKey)}</span>
          <MinutesInput name={key} label={t(labelKey)} value={draft[key]} invalid={bad(key)} onChange={set(key)} />
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {t('timer.presets.invalid')}
        </p>
      )}
      <div className="flex justify-end gap-2 pt-1">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
        <Button type="submit" variant="primary">
          {t('common.save')}
        </Button>
      </div>
    </form>
  );
}

export function PresetList({ presets, reload }: { presets: TimerPreset[]; reload: () => Promise<void> }) {
  const t = useT();
  const { settings, patch } = useSettings();
  const activeId = settings.timer.activePresetId;
  const [editing, setEditing] = useState<TimerPreset | null>(null);

  const startCreate = () =>
    setEditing({
      id: `custom-${crypto.randomUUID()}`,
      name: t('timer.presets.newName'),
      builtin: false,
      focusMin: 50,
      shortBreakMin: 10,
      longBreakMin: 20,
      cyclesBeforeLong: 3,
    });

  const remove = async (p: TimerPreset) => {
    if (!window.confirm(t('timer.presets.deleteConfirm', { name: p.name }))) return;
    await window.deepFocus.timer.deletePreset(p.id);
    await reload();
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line">
        {presets.map((p) => {
          const active = p.id === activeId;
          return (
            <li key={p.id} data-preset={p.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={cx('h-2 w-2 shrink-0 rounded-full', active ? 'bg-accent' : 'bg-line')} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-fg">
                  {p.name}
                  {p.builtin && <span className="ml-2 text-xs text-faint">{t('timer.presets.builtin')}</span>}
                </div>
                <div className="text-xs tabular-nums text-muted">
                  {t('timer.presets.summary', {
                    focus: p.focusMin,
                    short: p.shortBreakMin,
                    long: p.longBreakMin,
                    cycles: p.cyclesBeforeLong,
                  })}
                </div>
              </div>
              {active ? (
                <span className="px-3 text-xs font-medium text-accent">{t('timer.presets.active')}</span>
              ) : (
                <Button variant="ghost" onClick={() => void patch({ timer: { activePresetId: p.id } })}>
                  {t('timer.presets.use')}
                </Button>
              )}
              <Button variant="ghost" data-action="edit" onClick={() => setEditing(p)}>
                {t('timer.presets.edit')}
              </Button>
              {!p.builtin && (
                <Button variant="ghost" data-action="delete" className="text-danger" onClick={() => void remove(p)}>
                  {t('common.delete')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {editing ? (
        <div className="rounded-lg border border-line bg-surface-2/50 p-4">
          <PresetForm
            key={editing.id}
            preset={editing}
            onCancel={() => setEditing(null)}
            onSaved={async () => {
              setEditing(null);
              await reload();
            }}
          />
        </div>
      ) : (
        <div>
          <Button data-action="create-preset" onClick={startCreate}>
            {t('timer.presets.create')}
          </Button>
        </div>
      )}
    </div>
  );
}
