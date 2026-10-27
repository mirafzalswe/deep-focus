// Аналитика (§7): Deep Work за день/неделю/месяц, сессии, проекты и задачи, часы, цели, достижения, точность учёта.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { dayRange, monthRange, weekRange } from '@shared/periods';
import type { Achievement, AnalyticsSummary, BreakdownEntry, GoalProgress, Project, SessionRecord, Task } from '@shared/types';
import { useSettings, useT, type TFunction } from '../../../shared/settings';
import { Card, PageHeader, Segmented } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { SessionList } from '../Tasks/SessionList';
import { formatDay, formatDuration } from './format';
import { GoalBars } from './GoalBars';

type Period = 'today' | 'week' | 'month';
const PERIODS: Period[] = ['today', 'week', 'month'];
const RANGES = { today: dayRange, week: weekRange, month: monthRange };

interface Data {
  summaries: Record<Period, AnalyticsSummary>;
  goals: GoalProgress;
  achievements: Achievement[];
  tasks: Task[];
  projects: Project[];
  history: SessionRecord[];
}

async function loadData(period: Period): Promise<Data> {
  const api = window.deepFocus;
  const now = Date.now();
  const [today, week, month, goals, achievements, tasks, projects, history] = await Promise.all([
    api.analytics.summary(dayRange(now)),
    api.analytics.summary(weekRange(now)),
    api.analytics.summary(monthRange(now)),
    api.analytics.goals(),
    api.analytics.achievements(),
    api.tasks.list(),
    api.tasks.projects(),
    api.analytics.history(RANGES[period](now)),
  ]);
  return { summaries: { today, week, month }, goals, achievements, tasks, projects, history };
}

function Stat({ label, value, id }: { label: string; value: string; id?: string }) {
  return (
    <div data-stat={id}>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-2xl tabular-nums text-fg">{value}</div>
    </div>
  );
}

function Breakdown({ entries, nameOf, total }: { entries: BreakdownEntry[]; nameOf: (id: string | null) => string; total: number }) {
  const t = useT();
  return (
    <ul className="flex flex-col gap-3">
      {entries.slice(0, 10).map((e) => (
        <li key={e.id ?? 'none'}>
          <div className="mb-1 flex justify-between gap-3 text-sm">
            <span className="truncate text-fg">{nameOf(e.id)}</span>
            <span className="shrink-0 tabular-nums text-muted">{formatDuration(e.activeMs, t)}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${total > 0 ? (e.activeMs / total) * 100 : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function HourChart({ hourlyMs, t }: { hourlyMs: number[]; t: TFunction }) {
  const max = Math.max(...hourlyMs, 1);
  return (
    <div>
      <div className="flex h-28 items-end gap-1" data-hours>
        {hourlyMs.map((ms, hour) => (
          <div
            key={hour}
            className="flex h-full flex-1 items-end"
            title={t('analytics.hourTitle', { hour, time: formatDuration(ms, t) })}
            data-hour={hour}
            data-hour-ms={Math.round(ms)}
          >
            <div className="w-full rounded-t bg-accent" style={{ height: `${ms > 0 ? Math.max(4, (ms / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-faint tabular-nums">
        {[0, 6, 12, 18, 23].map((h) => (
          <span key={h}>{h}</span>
        ))}
      </div>
    </div>
  );
}

export default function AnalyticsPage(_props: PageProps) {
  const t = useT();
  const { settings } = useSettings();
  const [period, setPeriod] = useState<Period>('today');
  const [data, setData] = useState<Data | null>(null);

  const reload = useCallback(() => loadData(period).then(setData), [period]);
  useEffect(() => {
    void reload();
    return window.deepFocus.analytics.onChanged(() => void reload());
  }, [reload]);

  const taskTitles = useMemo(() => new Map((data?.tasks ?? []).map((x) => [x.id, x.title])), [data]);
  const projectNames = useMemo(() => new Map((data?.projects ?? []).map((p) => [p.id, p.name])), [data]);
  if (!data) return <PageHeader title={t('analytics.title')} subtitle={t('analytics.subtitle')} />;

  const s = data.summaries[period];
  const hasSessions = s.completedSessions + s.interruptedSessions > 0 || s.focusActiveMs > 0;
  const language = settings.general.language;
  const pct = s.completionRate === null ? t('analytics.noData') : `${Math.round(s.completionRate * 100)}%`;
  const focusHistory = data.history.filter((x) => x.kind === 'focus').reverse().slice(0, 30);
  const { accuracy } = s;

  return (
    <>
      <PageHeader
        title={t('analytics.title')}
        subtitle={t('analytics.subtitle')}
        actions={
          <Segmented<Period>
            label={t('analytics.periodLabel')}
            value={period}
            onChange={setPeriod}
            options={PERIODS.map((p) => ({ value: p, label: t(`analytics.periods.${p}`) }))}
          />
        }
      />

      <div className="grid grid-cols-3 gap-4" data-deepwork>
        {PERIODS.map((p) => (
          <Card key={p} title={`${t('analytics.deepWork')} · ${t(`analytics.periods.${p}`)}`}>
            <div className="font-display text-3xl tabular-nums text-fg" data-deepwork-period={p}>
              {formatDuration(data.summaries[p].focusActiveMs, t)}
            </div>
          </Card>
        ))}
      </div>

      {!hasSessions ? (
        <p className="mt-6 rounded-xl border border-dashed border-line px-6 py-8 text-center text-sm text-muted" data-empty="analytics">
          {t('analytics.empty')}
        </p>
      ) : (
        <>
          <Card title={t('analytics.sessions')} className="mt-6">
            <div className="grid grid-cols-4 gap-4">
              <Stat id="completed" label={t('analytics.completed')} value={String(s.completedSessions)} />
              <Stat id="interrupted" label={t('analytics.interrupted')} value={String(s.interruptedSessions)} />
              <Stat id="rate" label={t('analytics.completionRate')} value={pct} />
              <Stat id="avg" label={t('analytics.avgSession')} value={formatDuration(s.avgSessionMs, t)} />
            </div>
          </Card>

          <div className="mt-6 grid grid-cols-2 gap-6">
            <Card title={t('analytics.byProject')}>
              <Breakdown
                entries={s.byProject}
                total={s.focusActiveMs}
                nameOf={(id) => (id ? (projectNames.get(id) ?? t('analytics.noProject')) : t('analytics.noProject'))}
              />
            </Card>
            <Card title={t('analytics.byTask')}>
              <Breakdown
                entries={s.byTask}
                total={s.focusActiveMs}
                nameOf={(id) => (id ? (taskTitles.get(id) ?? t('analytics.deletedTask')) : t('analytics.noTask'))}
              />
            </Card>
          </div>

          <Card title={t('analytics.hours')} className="mt-6">
            <p className="mb-3 text-xs text-muted">{t('analytics.hoursHint')}</p>
            <HourChart hourlyMs={s.hourlyMs} t={t} />
          </Card>

          <Card title={t('analytics.accuracy')} className="mt-6">
            <div className="grid grid-cols-5 gap-4" data-accuracy>
              <Stat id="planned" label={t('analytics.accuracyPlanned')} value={formatDuration(accuracy.plannedMs, t)} />
              <Stat id="active" label={t('analytics.accuracyActive')} value={formatDuration(accuracy.activeMs, t)} />
              <Stat id="paused" label={t('analytics.accuracyPaused')} value={formatDuration(accuracy.pausedMs, t)} />
              <Stat id="early" label={t('analytics.accuracyEarly')} value={String(accuracy.earlyCount)} />
              <Stat id="recovered" label={t('analytics.accuracyRecovered')} value={String(accuracy.recoveredCount)} />
            </div>
            <p className="mt-4 text-xs text-faint">{t('analytics.accuracyHint')}</p>
          </Card>

          <Card title={t('analytics.history')} className="mt-6">
            <SessionList
              sessions={focusHistory}
              titleOf={(x) => (x.taskId ? (taskTitles.get(x.taskId) ?? t('analytics.deletedTask')) : null)}
            />
          </Card>
        </>
      )}

      <Card title={t('analytics.goals')} className="mt-6">
        <GoalBars goals={data.goals} />
        {data.goals.streakDays !== null && (
          <p className="mt-5 text-sm text-muted" data-streak>
            {t('analytics.streak')}: <span className="text-fg">{t('analytics.streakDays', { days: data.goals.streakDays })}</span>
          </p>
        )}
      </Card>

      <Card title={t('analytics.achievements')} className="mt-6">
        {data.achievements.length === 0 ? (
          <p className="text-sm text-muted">{t('analytics.achievementsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm" data-achievements>
            {[...data.achievements]
              .sort((a, b) => b.achievedAt - a.achievedAt)
              .map((a) => (
                <li key={a.id} className="flex justify-between gap-4 py-2">
                  <span className="text-fg">
                    {t(`analytics.achievementKinds.${a.kind}`)}
                    {a.kind === 'project' && projectNames.get(a.id.split(':')[1] ?? '') ? ` · ${projectNames.get(a.id.split(':')[1] ?? '')}` : ''}
                  </span>
                  <span className="text-muted">
                    {formatDay(a.period, language)} · {formatDuration(a.valueMin * 60_000, t)}
                  </span>
                </li>
              ))}
          </ul>
        )}
      </Card>
    </>
  );
}
