// Правила блокировки: по категориям, добавление своего домена, вкл/выкл, флажки Focus/перерывы, расписание,
// фильтр «действуют сейчас».
import { useState } from 'react';
import type { BlockCategory, BlockRule, Schedule } from '@shared/types';
import { translateDynamic } from '@shared/i18n';
import { useSettings, useT, type TFunction } from '../../../shared/settings';
import { Button, Card, cx, Segmented } from '../../../shared/ui';
import { TextInput, Toggle } from '../Timer/controls';
import { errorKeyOf, newRuleId } from './useBlocker';

const CATEGORIES: readonly BlockCategory[] = ['social', 'video', 'messenger', 'news', 'entertainment', 'custom'];
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const EMPTY_SCHEDULE: Schedule = { days: [], from: '09:00', to: '18:00' };

type Day = (typeof DAY_ORDER)[number];
const dayKey = (d: Day) => `blocker.days.d${d}` as const;

function scheduleSummary(t: TFunction, s: Schedule): string {
  const days = DAY_ORDER.filter((d) => s.days.includes(d))
    .map((d) => t(dayKey(d)))
    .join(' ');
  return t('blocker.rules.scheduleSummary', { days: days || '—', from: s.from, to: s.to });
}

export function RulesCard({
  rules,
  activeRuleIds,
  strictLocked,
  reload,
}: {
  rules: BlockRule[];
  activeRuleIds: string[];
  /** Strict во время сессии: действующие правила нельзя ослабить (main тоже отклонит, §4.7). */
  strictLocked: boolean;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const [filter, setFilter] = useState<'all' | 'active'>('all');
  const [error, setError] = useState<{ id: string; key: string } | null>(null);
  const active = new Set(activeRuleIds);
  const visible = filter === 'active' ? rules.filter((r) => active.has(r.id)) : rules;

  const save = async (rule: BlockRule) => {
    try {
      await window.deepFocus.blocker.saveRule(rule);
      setError(null);
    } catch (err) {
      setError({ id: rule.id, key: errorKeyOf(err) });
    }
    await reload();
  };
  const remove = async (rule: BlockRule) => {
    try {
      await window.deepFocus.blocker.deleteRule(rule.id);
    } catch (err) {
      setError({ id: rule.id, key: errorKeyOf(err) });
    }
    await reload();
  };

  return (
    <Card title={t('blocker.rules.title')}>
      <AddRule onAdded={reload} />

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <Segmented
          label={t('blocker.rules.filterLabel')}
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: t('blocker.rules.filterAll') },
            { value: 'active', label: `${t('blocker.rules.filterActive')} · ${activeRuleIds.length}` },
          ]}
        />
      </div>

      {filter === 'active' && visible.length === 0 && <p className="mt-4 text-sm text-muted">{t('blocker.rules.emptyActive')}</p>}

      {CATEGORIES.map((category) => {
        const list = visible.filter((r) => r.category === category);
        if (list.length === 0) return null;
        return (
          <section key={category} className="mt-5" data-rule-category={category}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-faint">{t(`blocker.categories.${category}`)}</h3>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line">
              {list.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  active={active.has(rule.id)}
                  locked={strictLocked && active.has(rule.id)}
                  errorKey={error?.id === rule.id ? error.key : null}
                  onSave={save}
                  onDelete={remove}
                />
              ))}
            </ul>
          </section>
        );
      })}
    </Card>
  );
}

function AddRule({ onAdded }: { onAdded: () => Promise<void> }) {
  const t = useT();
  const lang = useSettings().settings.general.language;
  const [pattern, setPattern] = useState('');
  const [category, setCategory] = useState<BlockCategory>('custom');
  const [message, setMessage] = useState<{ tone: 'warn' | 'danger'; text: string } | null>(null);

  const add = async () => {
    const rule: BlockRule = {
      id: newRuleId(),
      pattern,
      category,
      enabled: true,
      duringFocus: true,
      duringShortBreak: false,
      duringLongBreak: false,
      schedule: null,
      builtin: false,
    };
    try {
      const res = await window.deepFocus.blocker.saveRule(rule);
      setPattern('');
      setMessage(res.warningKey ? { tone: 'warn', text: translateDynamic(lang, res.warningKey, { domain: res.rule.pattern }) } : null);
      await onAdded();
    } catch (err) {
      setMessage({ tone: 'danger', text: translateDynamic(lang, errorKeyOf(err)) });
    }
  };

  return (
    <form
      data-blocker-add
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <h3 className="mb-2 text-sm font-medium text-fg">{t('blocker.rules.addTitle')}</h3>
      <div className="flex flex-wrap gap-2">
        <TextInput
          name="pattern"
          aria-label={t('blocker.rules.domainLabel')}
          placeholder={t('blocker.rules.domainPlaceholder')}
          value={pattern}
          invalid={message?.tone === 'danger'}
          onChange={(e) => {
            setPattern(e.target.value);
            if (message?.tone === 'danger') setMessage(null);
          }}
          className="min-w-0 flex-1"
        />
        <select
          aria-label={t('blocker.rules.categoryLabel')}
          value={category}
          onChange={(e) => setCategory(e.target.value as BlockCategory)}
          className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {t(`blocker.categories.${c}`)}
            </option>
          ))}
        </select>
        <Button type="submit" variant="primary" disabled={!pattern.trim()} data-blocker-action="add-rule">
          {t('blocker.actions.add')}
        </Button>
      </div>
      {message && (
        <p className={cx('mt-2 text-sm', message.tone === 'danger' ? 'text-danger' : 'text-warn')} data-blocker-message={message.tone}>
          {message.text}
        </p>
      )}
      <p className="mt-2 text-xs text-muted">{t('blocker.limits.subdomains')}</p>
    </form>
  );
}

function FlagChip({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'rounded-md border px-2 py-1 text-xs transition-colors disabled:pointer-events-none disabled:opacity-40',
        checked ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:text-fg',
      )}
    >
      {label}
    </button>
  );
}

function RuleRow({
  rule,
  active,
  locked,
  errorKey,
  onSave,
  onDelete,
}: {
  rule: BlockRule;
  active: boolean;
  /** Strict во время сессии и правило действует: выключить, снять флажок, сменить расписание или удалить нельзя. */
  locked: boolean;
  errorKey: string | null;
  onSave: (r: BlockRule) => Promise<void>;
  onDelete: (r: BlockRule) => Promise<void>;
}) {
  const t = useT();
  const lang = useSettings().settings.general.language;
  const [editing, setEditing] = useState(false);
  const set = (patch: Partial<BlockRule>) => void onSave({ ...rule, ...patch });
  const schedule = rule.schedule;

  return (
    <li
      className="px-3 py-2.5"
      data-rule-pattern={rule.pattern}
      data-rule-active={active || undefined}
      data-rule-locked={locked || undefined}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Toggle
          label={`${t('blocker.rules.enabledLabel')}: ${rule.pattern}`}
          checked={rule.enabled}
          disabled={locked}
          onChange={(enabled) => set({ enabled })}
        />
        <div className={cx('min-w-40 flex-1 text-sm', rule.enabled ? 'text-fg' : 'text-faint')}>
          {rule.pattern}
          {rule.builtin && <span className="ml-2 text-xs text-faint">{t('blocker.rules.builtin')}</span>}
          {active && <span className="ml-2 rounded bg-ok/15 px-1.5 py-0.5 text-xs text-ok">{t('blocker.rules.activeNow')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('blocker.rules.flagsLabel')}>
          <FlagChip label={t('blocker.rules.focus')} checked={rule.duringFocus} disabled={locked} onChange={(duringFocus) => set({ duringFocus })} />
          <FlagChip
            label={t('blocker.rules.shortBreak')}
            checked={rule.duringShortBreak}
            disabled={locked}
            onChange={(duringShortBreak) => set({ duringShortBreak })}
          />
          <FlagChip
            label={t('blocker.rules.longBreak')}
            checked={rule.duringLongBreak}
            disabled={locked}
            onChange={(duringLongBreak) => set({ duringLongBreak })}
          />
        </div>
        <Button
          variant="ghost"
          className="px-2 py-1 text-xs disabled:opacity-40"
          aria-expanded={editing && !locked}
          disabled={locked}
          onClick={() => setEditing((v) => !v)}
        >
          {schedule ? scheduleSummary(t, schedule) : t('blocker.actions.schedule')}
        </Button>
        {!rule.builtin && (
          <Button
            variant="ghost"
            className="px-2 py-1 text-xs disabled:opacity-40"
            aria-label={`${t('blocker.actions.delete')}: ${rule.pattern}`}
            disabled={locked}
            onClick={() => void onDelete(rule)}
          >
            {t('blocker.actions.delete')}
          </Button>
        )}
      </div>
      {errorKey && <p className="mt-1.5 text-xs text-danger">{translateDynamic(lang, errorKey)}</p>}
      {editing && !locked && <ScheduleEditor schedule={schedule} onChange={(s) => set({ schedule: s })} onDone={() => setEditing(false)} />}
    </li>
  );
}

function ScheduleEditor({
  schedule,
  onChange,
  onDone,
}: {
  schedule: Schedule | null;
  onChange: (s: Schedule | null) => void;
  onDone: () => void;
}) {
  const t = useT();
  const s = schedule ?? EMPTY_SCHEDULE;
  const toggleDay = (d: number) => {
    const days = s.days.includes(d) ? s.days.filter((x) => x !== d) : [...s.days, d].sort();
    onChange({ ...s, days });
  };
  const time = (field: 'from' | 'to', value: string) => {
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) onChange({ ...s, [field]: value });
  };
  return (
    <div className="mt-3 rounded-lg bg-surface-2 p-3" data-schedule-editor>
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('blocker.rules.daysLabel')}>
        {DAY_ORDER.map((d) => (
          <FlagChip key={d} label={t(dayKey(d))} checked={s.days.includes(d)} onChange={() => toggleDay(d)} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted">
        <label className="flex items-center gap-2">
          {t('blocker.rules.from')}
          <TextInput type="time" value={s.from} onChange={(e) => time('from', e.target.value)} />
        </label>
        <label className="flex items-center gap-2">
          {t('blocker.rules.to')}
          <TextInput type="time" value={s.to} onChange={(e) => time('to', e.target.value)} />
        </label>
        <div className="ml-auto flex gap-2">
          {schedule && (
            <Button variant="ghost" onClick={() => onChange(null)}>
              {t('blocker.actions.clearSchedule')}
            </Button>
          )}
          <Button onClick={onDone}>{t('blocker.actions.done')}</Button>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted">{t('blocker.rules.scheduleHint')}</p>
    </div>
  );
}
