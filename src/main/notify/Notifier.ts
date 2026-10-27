// Notifier: тихие уведомления Windows о шести событиях (§8.1). Сам смотрит настройки в момент показа.
// Electron Notification — за deps.show, чтобы логика проверялась без Electron.
import type { MessageKey, TranslateParams } from '../../shared/i18n';
import type { Achievement, AppSettings, NotifyEvent, SessionRecord, TimerSnapshot } from '../../shared/types';

export interface Toast {
  event: NotifyEvent;
  title: string;
  body: string;
  silent: boolean;
}

export interface NotifyParams {
  /** длительность начавшегося интервала или достигнутая цель, мин; null — без лимита */
  minutes?: number | null;
  /** i18n-ключ причины ошибки блокировки */
  reasonKey?: string;
}

export interface NotifierDeps {
  settings: () => AppSettings['notifications'];
  t: (key: MessageKey, params?: TranslateParams) => string;
  show: (toast: Toast) => void;
}

/** Нужное Notifier от TimerEngine. */
export interface TimerEventSource {
  on(event: 'sessionStarted', listener: (snap: TimerSnapshot) => void): unknown;
  on(event: 'intervalEnded', listener: (record: SessionRecord) => void): unknown;
}

const MIN = 60_000;

export class Notifier {
  private seenAchievements: Set<string> | null = null;

  constructor(private readonly deps: NotifierDeps) {}

  /** Показать уведомление, если оно включено. Возвращает, было ли оно показано. */
  notify(event: NotifyEvent, params: NotifyParams = {}): boolean {
    const s = this.deps.settings();
    if (!s.enabled || !s[event]) return false;
    const { title, body } = this.text(event, params);
    this.deps.show({ event, title, body, silent: s.silent });
    return true;
  }

  /**
   * События таймера → уведомления. achievements — журнал достижений (AnalyticsService.achievements):
   * его новые дневные записи после конца интервала дают «дневная цель достигнута».
   */
  bindTimer(timer: TimerEventSource, achievements: () => Achievement[]): void {
    this.seenAchievements = new Set(achievements().map((a) => a.id));
    timer.on('sessionStarted', (snap) => {
      const minutes = snap.plannedMs === null ? null : Math.round(snap.plannedMs / MIN);
      this.notify(snap.kind === 'focus' ? 'sessionStart' : 'breakStart', { minutes });
    });
    timer.on('intervalEnded', (record) => {
      if (record.endReason === 'completed') this.notify(record.kind === 'focus' ? 'focusEnd' : 'breakEnd');
      this.checkAchievements(achievements());
    });
  }

  private checkAchievements(list: Achievement[]): void {
    const seen = (this.seenAchievements ??= new Set());
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      if (a.kind === 'daily') this.notify('dailyGoal', { minutes: a.valueMin });
    }
  }

  private text(event: NotifyEvent, p: NotifyParams): { title: string; body: string } {
    const t = this.deps.t;
    switch (event) {
      case 'blockerError':
        return { title: t('blocker.notify.errorTitle'), body: t((p.reasonKey ?? 'blocker.reason.applyFailed') as MessageKey) };
      case 'sessionStart':
      case 'breakStart':
        return {
          title: t(`system.notify.${event}.title`),
          body: typeof p.minutes === 'number' ? t(`system.notify.${event}.body`, { minutes: p.minutes }) : t(`system.notify.${event}.bodyOpen`),
        };
      case 'dailyGoal':
        return { title: t('system.notify.dailyGoal.title'), body: t('system.notify.dailyGoal.body', { minutes: p.minutes ?? 0 }) };
      default:
        return { title: t(`system.notify.${event}.title`), body: t(`system.notify.${event}.body`) };
    }
  }
}
