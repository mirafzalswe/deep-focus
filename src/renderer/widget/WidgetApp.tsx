// Плавающий виджет: Compact (время + полоска), Standard (+ подпись режима и ≤3 кнопки),
// Expanded (+ строка задачи и два значка статуса). Без заголовков, рамок и абзацев текста (§3.5, §3.8).
import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { MessageKey } from '@shared/i18n';
import type { TimerCommand, TimerSnapshot } from '@shared/types';
import { useSettings, useT, type TFunction } from '../shared/settings';
import { cx } from '../shared/ui';
import { clockFace, useIdleFocusMs, useStatuses, useTaskTitle, useTimer } from './useWidgetData';

function modeLabelKey(snap: TimerSnapshot | null): MessageKey {
  if (!snap || snap.status === 'idle') return 'widget.label.idle';
  if (snap.status === 'paused') return 'widget.label.paused';
  if (snap.status === 'awaiting') return 'widget.label.awaiting';
  if (snap.mode === 'stopwatch') return 'widget.label.stopwatch';
  if (snap.mode === 'free') return 'widget.label.free';
  return `widget.label.${snap.kind}`;
}

const command = (cmd: TimerCommand) => void window.deepFocus.timer.command(cmd).catch(() => undefined);

export function WidgetApp() {
  const t = useT();
  const { settings } = useSettings();
  const w = settings.widget;
  const mode = w.displayMode;
  const { view, now } = useTimer();
  const idleFocusMs = useIdleFocusMs(settings.timer.activePresetId);
  const snap = view.snap;
  const face = clockFace(view, now, idleFocusMs);
  const expanded = mode === 'expanded';
  const taskTitle = useTaskTitle(snap?.taskId ?? null, expanded);
  const { blocker, audio } = useStatuses(expanded);
  const interactive = !w.clickThrough;
  const isBreak = snap !== null && snap.status !== 'idle' && snap.kind !== 'focus';

  return (
    <div
      className="widget-root relative flex h-full flex-col justify-center gap-[6cqh] overflow-hidden rounded-xl px-[6cqw] py-[7cqh] text-fg"
      data-mode={mode}
      data-click-through={w.clickThrough || undefined}
      style={{ background: `color-mix(in srgb, var(--df-surface) ${Math.round(w.backgroundOpacity * 100)}%, transparent)` }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (interactive) void window.deepFocus.widget.showMenu();
      }}
    >
      {mode !== 'compact' && (
        <div className="flex min-h-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span data-testid="widget-label" className="widget-halo truncate text-xs font-medium text-muted">
              {t(modeLabelKey(snap))}
            </span>
            {expanded && (
              <>
                <StatusIcon
                  kind="blocker"
                  tone={blocker?.state === 'active' ? 'ok' : blocker?.state === 'error' ? 'danger' : 'faint'}
                  label={t(
                    blocker?.state === 'active'
                      ? 'widget.status.blockerActive'
                      : blocker?.state === 'error'
                        ? 'widget.status.blockerError'
                        : 'widget.status.blockerOff',
                  )}
                />
                <StatusIcon
                  kind="sound"
                  tone={audio?.playing && !audio.muted ? 'ok' : 'faint'}
                  label={t(audio?.playing && !audio.muted ? 'widget.status.soundOn' : 'widget.status.soundOff')}
                />
              </>
            )}
          </div>
          {interactive && <Controls snap={snap} t={t} />}
        </div>
      )}

      <div data-testid="widget-time" className="widget-time widget-halo font-mono font-semibold text-fg">
        {face.text}
      </div>

      {expanded && (
        <div data-testid="widget-task" className="widget-halo truncate text-xs text-muted">
          {taskTitle ?? t('widget.noTask')}
        </div>
      )}

      {face.progress !== null && (
        <div className="widget-halo-box h-[3px] shrink-0 overflow-hidden rounded-full bg-line">
          <div
            data-testid="widget-progress"
            className={cx('widget-progress-fill h-full rounded-full', isBreak ? 'bg-ok' : 'bg-accent')}
            style={{ width: `${Math.round(face.progress * 1000) / 10}%` }}
          />
        </div>
      )}

      {interactive && <ResizeGrip label={t('widget.action.resize')} />}
    </div>
  );
}

function Controls({ snap, t }: { snap: TimerSnapshot | null; t: TFunction }) {
  const status = snap?.status ?? 'idle';
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {status === 'running' && (
        <IconButton label={t('widget.action.pause')} onClick={() => command({ type: 'pause' })}>
          <path d="M9 6v12M15 6v12" />
        </IconButton>
      )}
      {status === 'paused' && (
        <IconButton label={t('widget.action.resume')} onClick={() => command({ type: 'resume' })}>
          <path d="M8 5.5v13l10.5-6.5z" />
        </IconButton>
      )}
      {(status === 'idle' || status === 'awaiting') && (
        <IconButton
          label={t('widget.action.start')}
          onClick={() => command({ type: 'start', mode: snap?.mode ?? 'pomodoro' })}
        >
          <path d="M8 5.5v13l10.5-6.5z" />
        </IconButton>
      )}
      {status !== 'idle' && (
        <IconButton label={t('widget.action.stop')} onClick={() => command({ type: 'stop' })}>
          <rect x="7" y="7" width="10" height="10" rx="1.5" />
        </IconButton>
      )}
      <IconButton label={t('widget.action.hide')} onClick={() => void window.deepFocus.widget.hide()}>
        <path d="M6 12h12" />
      </IconButton>
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick(): void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="no-drag widget-halo grid size-6 place-items-center rounded-md text-muted transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function StatusIcon({ kind, tone, label }: { kind: 'blocker' | 'sound'; tone: 'ok' | 'danger' | 'faint'; label: string }) {
  const color = { ok: 'text-ok', danger: 'text-danger', faint: 'text-faint' }[tone];
  return (
    <span role="img" title={label} aria-label={label} data-testid={`widget-status-${kind}`} className={cx('shrink-0', color)}>
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {kind === 'blocker' ? (
          <path d="M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6z" />
        ) : (
          <path d="M5 10v4h3l4 3.5v-11L8 10zM16 9a4 4 0 0 1 0 6" />
        )}
      </svg>
    </span>
  );
}

/** Уголок ресайза: прозрачное окно на Windows не тянется за край, поэтому размер меняем сами. */
function ResizeGrip({ label }: { label: string }) {
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const frame = useRef(0);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    const width = Math.round(s.w + e.screenX - s.x);
    const height = Math.round(s.h + e.screenY - s.y);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => void window.deepFocus.widget.resize(Math.max(1, width), Math.max(1, height)));
  };
  const onPointerUp = () => {
    start.current = null;
  };

  return (
    <div
      role="separator"
      aria-label={label}
      title={label}
      className="no-drag widget-grip absolute right-0 bottom-0 size-3.5 cursor-nwse-resize text-faint"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <svg viewBox="0 0 14 14" width="14" height="14" stroke="currentColor" strokeWidth="1.2" aria-hidden="true">
        <path d="M12 5 5 12M12 9 9 12" />
      </svg>
    </div>
  );
}
