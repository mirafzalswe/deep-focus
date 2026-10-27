// Главный экран, часть таймера (§10.2): режим, большой таймер, кнопки по состоянию, текущая задача.
// Недоступные в текущем состоянии кнопки не показываются (§2.8).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { IntervalKind, Task, TimerCommand, TimerMode, TimerSnapshot } from '@shared/types';
import { useSettings, useT } from '../../../shared/settings';
import { Button, cx, Segmented } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { useBlockerStatus } from '../Blocker/useBlocker';
import { formatClock, sendTimer, useTimerPresets, useTimerSnapshot } from '../Timer/useTimer';

/** Отказ main по Strict приходит ошибкой IPC с ключом причины в тексте. */
const STRICT_REFUSED_KEY = 'timer.strict.refused';

interface Action {
  id: string;
  labelKey: MessageKey;
  params?: Record<string, number>;
  cmd: TimerCommand;
  primary?: boolean;
}

function actionsFor(snap: TimerSnapshot, start: TimerCommand, extendMin: number): Action[] {
  const { status, mode, kind, plannedMs } = snap;
  const countdown = plannedMs !== null;
  const extend: Action = { id: 'extend', labelKey: 'timer.actions.extend', params: { min: extendMin }, cmd: { type: 'extend', min: extendMin } };
  if (status === 'idle') return [{ id: 'start', labelKey: 'timer.actions.start', cmd: start, primary: true }];
  if (status === 'awaiting') {
    const stop: Action = { id: 'finish', labelKey: 'timer.actions.finish', cmd: { type: 'stop' } };
    if (mode === 'free') return [{ ...extend, primary: true }, stop];
    if (kind !== 'focus') {
      return [
        { id: 'rest', labelKey: 'timer.actions.rest', cmd: { type: 'start', mode: 'pomodoro' }, primary: true },
        { id: 'continue', labelKey: 'timer.actions.continueWork', cmd: { type: 'skipBreak' } },
        stop,
      ];
    }
    return [{ id: 'continue', labelKey: 'timer.actions.continueWork', cmd: { type: 'start', mode: 'pomodoro' }, primary: true }, stop];
  }
  const list: Action[] =
    status === 'running'
      ? [{ id: 'pause', labelKey: 'timer.actions.pause', cmd: { type: 'pause' }, primary: true }]
      : [{ id: 'resume', labelKey: 'timer.actions.resume', cmd: { type: 'resume' }, primary: true }];
  list.push({ id: 'stop', labelKey: 'timer.actions.stop', cmd: { type: 'stop' } });
  if (mode === 'pomodoro' && kind === 'focus') list.push({ id: 'skipSession', labelKey: 'timer.actions.skipSession', cmd: { type: 'skipSession' } });
  if (kind !== 'focus') list.push({ id: 'skipBreak', labelKey: 'timer.actions.skipBreak', cmd: { type: 'skipBreak' } });
  if (mode === 'free' && countdown) list.push(extend);
  list.push({ id: 'restart', labelKey: 'timer.actions.restart', cmd: { type: 'restartSession' } });
  list.push({ id: 'reset', labelKey: 'timer.actions.reset', cmd: { type: 'reset' } });
  return list;
}

function awaitingKey(snap: TimerSnapshot): MessageKey {
  if (snap.mode === 'free') return 'timer.awaiting.free';
  if (snap.kind !== 'focus') return 'timer.awaiting.afterFocus';
  return snap.completedFocusInCycle === 0 ? 'timer.awaiting.afterLongBreak' : 'timer.awaiting.afterBreak';
}

function ProgressRing({ progress, tone, children }: { progress: number; tone: 'focus' | 'break'; children: ReactNode }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[340px]">
      <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="50" cy="50" r={r} fill="none" strokeWidth="1.5" className="stroke-line" />
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(1, Math.max(0, progress)))}
          className={cx('transition-[stroke-dashoffset] duration-1000 ease-linear', tone === 'focus' ? 'stroke-accent' : 'stroke-ok')}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>
    </div>
  );
}

export function TimerPanel({ navigate }: Partial<Pick<PageProps, 'navigate'>> = {}) {
  const t = useT();
  const { settings } = useSettings();
  const snap = useTimerSnapshot();
  const blocker = useBlockerStatus();
  const [refused, setRefused] = useState(false);
  const { presets } = useTimerPresets();
  const [modeChoice, setModeChoice] = useState<TimerMode | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskChoice, setTaskChoice] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void window.deepFocus.tasks.list().then(setTasks);
  }, [snap?.status]);

  const openTasks = useMemo(() => tasks.filter((x) => x.status === 'open' || x.status === 'inProgress'), [tasks]);
  if (!snap) return null;

  const idle = snap.status === 'idle';
  const mode = idle ? (modeChoice ?? snap.mode) : snap.mode;
  const preset = presets.find((p) => p.id === snap.presetId);
  const taskId = taskChoice === undefined ? snap.taskId : taskChoice;
  const task = tasks.find((x) => x.id === snap.taskId) ?? null;

  const view: TimerSnapshot = idle && mode !== snap.mode ? { ...snap, mode, kind: 'focus' } : snap;
  const countUp = idle ? mode === 'stopwatch' : snap.plannedMs === null;
  const MIN_MS = 60_000;
  const idleMin = !preset ? 0 : view.kind === 'focus' ? preset.focusMin : view.kind === 'shortBreak' ? preset.shortBreakMin : preset.longBreakMin;
  const idleMs = mode === snap.mode && snap.plannedMs !== null ? snap.plannedMs : idleMin * MIN_MS;
  const clockMs = idle ? (countUp ? 0 : idleMs) : countUp ? snap.activeMs : (snap.remainingMs ?? 0);
  const progress = !idle && !countUp && snap.plannedMs ? 1 - (snap.remainingMs ?? 0) / snap.plannedMs : 0;
  const shownKind: IntervalKind = view.kind;

  const start: TimerCommand = { type: 'start', mode, taskId: taskId ?? null };
  const actions = actionsFor(view, start, settings.timer.freeExtendMin);
  // Strict (§4.7): пока блокировка заперта, команды, которые сняли бы её раньше конца интервала, недоступны
  const strictLocked = (blocker?.strictLocked ?? false) && (snap.status === 'running' || snap.status === 'paused');
  const lockedIds = strictLocked ? ['stop', 'skipSession', 'reset', ...(settings.timer.keepBlockingOnPause ? [] : ['pause'])] : [];
  const run = (cmd: TimerCommand) => {
    if (cmd.type === 'start' && cmd !== start) cmd = { ...cmd, taskId: taskId ?? null };
    setRefused(false);
    void sendTimer(cmd)
      .then(() => setModeChoice(null))
      .catch((err: unknown) => {
        if (String(err).includes(STRICT_REFUSED_KEY)) setRefused(true);
      });
  };

  return (
    <section className="flex flex-col items-center gap-6" data-timer-status={snap.status} data-timer-mode={view.mode}>
      {idle ? (
        <Segmented<TimerMode>
          label={t('timer.mode')}
          value={mode}
          onChange={setModeChoice}
          options={[
            { value: 'pomodoro', label: t('timer.modes.pomodoro') },
            { value: 'stopwatch', label: t('timer.modes.stopwatch') },
            { value: 'free', label: t('timer.modes.free') },
          ]}
        />
      ) : (
        <div className="text-sm text-muted">{t(`timer.modes.${snap.mode}`)}</div>
      )}

      {idle && mode === 'pomodoro' && (
        <Segmented<IntervalKind>
          label={t('timer.interval')}
          value={snap.kind}
          onChange={(kind) => run({ type: 'switchKind', kind })}
          options={[
            { value: 'focus', label: t('timer.kinds.focus') },
            { value: 'shortBreak', label: t('timer.kinds.shortBreak') },
            { value: 'longBreak', label: t('timer.kinds.longBreak') },
          ]}
        />
      )}

      <ProgressRing progress={progress} tone={shownKind === 'focus' ? 'focus' : 'break'}>
        <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted" data-timer-kind={shownKind}>
          {t(`timer.kinds.${shownKind}`)}
        </div>
        <div
          data-timer-display
          className="mt-1 font-display text-7xl font-light tabular-nums tracking-tight text-fg"
          aria-live="off"
        >
          {formatClock(clockMs, !countUp)}
        </div>
        <div className={cx('mt-2 text-sm', snap.status === 'paused' ? 'text-warn' : 'text-muted')}>
          {countUp && !idle && snap.plannedMs === null && snap.mode === 'free' ? t('timer.unlimited') : t(`timer.status.${snap.status}`)}
        </div>
      </ProgressRing>

      {view.mode === 'pomodoro' && preset && (
        <div className="flex items-center gap-2" aria-label={t('timer.cycle', { done: snap.completedFocusInCycle, total: preset.cyclesBeforeLong })}>
          {Array.from({ length: preset.cyclesBeforeLong }, (_, i) => (
            <span key={i} className={cx('h-1.5 w-6 rounded-full', i < snap.completedFocusInCycle ? 'bg-accent' : 'bg-line')} />
          ))}
        </div>
      )}

      {snap.status === 'awaiting' && (
        <p role="status" className="text-center text-base text-fg">
          {t(awaitingKey(snap))}
        </p>
      )}
      {snap.recovered && snap.status !== 'idle' && <p className="text-xs text-faint">{t('timer.recovered')}</p>}

      <div className="flex flex-wrap justify-center gap-2">
        {actions.map((a) => (
          <Button
            key={a.id}
            data-timer-action={a.id}
            variant={a.primary ? 'primary' : 'secondary'}
            className={a.primary ? 'min-w-32 justify-center px-6 py-2.5 text-base' : undefined}
            disabled={lockedIds.includes(a.id)}
            onClick={() => run(a.cmd)}
          >
            {t(a.labelKey, a.params)}
          </Button>
        ))}
      </div>

      {(strictLocked || refused) && (
        <div data-timer-strict className="max-w-md text-center text-xs text-muted">
          <p role={refused ? 'alert' : undefined}>
            {refused && !strictLocked ? t('timer.strict.refused') : t('timer.strict.locked', { sec: settings.blocker.strictUnlockDelaySec })}
            {strictLocked && !settings.timer.keepBlockingOnPause && ` ${t('timer.strict.pauseLocked')}`}
          </p>
          <p className="mt-1">{t('timer.strict.exitHint')}</p>
          {navigate && (
            <Button variant="ghost" className="mt-1" data-timer-action="unlock" onClick={() => navigate('blocker')}>
              {t('timer.strict.unlock')}
            </Button>
          )}
        </div>
      )}

      <div className="text-sm text-muted">
        {idle || snap.status === 'awaiting' ? (
          openTasks.length > 0 && (
            <label className="flex items-center gap-3">
              <span>{t('timer.task')}</span>
              <select
                aria-label={t('timer.task')}
                value={taskId ?? ''}
                onChange={(e) => setTaskChoice(e.target.value || null)}
                className="max-w-72 rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
              >
                <option value="">{t('timer.noTask')}</option>
                {openTasks.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          task && (
            <span data-timer-task>
              {t('timer.task')}: <span className="text-fg">{task.title}</span>
            </span>
          )
        )}
      </div>
    </section>
  );
}
