// WidgetManager — владелец окна виджета: видимость, поверх окон, click-through, геометрия (§3).
// Без прямой зависимости от Electron: окно и экраны приходят адаптерами (electron.ts), таймер — подпиской.
// Таймером виджет не управляет никогда: показ и скрытие не трогают TimerEngine (§3.12).
import { WIDGET_IDLE_HIDE_MS } from '../../shared/defaults';
import type { Anchor, AppSettings, SettingsPatch, TimerSnapshot, Unsubscribe, WidgetBounds } from '../../shared/types';
import { TypedEmitter } from '../events';
import type { SettingsManager } from '../settings/SettingsManager';
import { clampSize, DEFAULT_SIZE, MIN_SIZE, resolveBounds, targetDisplay, type DisplayInfo, type Rect } from './geometry';

export type WidgetSettings = AppSettings['widget'];

/** То, что WidgetManager делает с окном. Реализация на BrowserWindow — electron.ts. */
export interface WidgetWindowPort {
  /** Показать без активации (фокус остаётся у текущего окна). */
  show(): void;
  hide(): void;
  isVisible(): boolean;
  getBounds(): Rect;
  setBounds(r: Rect): void;
  setMinimumSize(width: number, height: number): void;
  setOpacity(opacity: number): void;
  setAlwaysOnTop(on: boolean): void;
  setClickThrough(on: boolean): void;
  /** Снова поднять над остальными окнами (уровень topmost мог потеряться). */
  raise(): void;
  /** Окно сдвинули или изменили размер (мышью или программно). */
  onGeometryChange(cb: () => void): void;
  /** Окна больше нет: renderer упал (окно уничтожено) или окно закрыто. */
  onGone(cb: (reason: 'crashed' | 'closed') => void): void;
  /** Пользователь закрывает окно (Alt+F4, системное меню). Вернуть true — закрытие отменено. */
  onCloseRequest(cb: () => boolean): void;
}

/** Что виджету нужно от TimerEngine (Т02): снимок и события. */
export interface TimerFeed {
  snapshot(): TimerSnapshot;
  on(event: 'state' | 'sessionStarted', cb: (snap: TimerSnapshot) => void): Unsubscribe;
}

export interface ScreenPort {
  displays(): DisplayInfo[];
  /** Экран подключили, отключили или изменили разрешение/масштаб. */
  onChange(cb: () => void): Unsubscribe;
}

export interface WidgetDeps {
  settings: Pick<SettingsManager, 'get' | 'patch' | 'on'>;
  screen: ScreenPort;
  timer?: TimerFeed | null;
  createWindow(init: { bounds: Rect; clickThrough: boolean }): WidgetWindowPort;
  /** Вызывается при запуске, если click-through восстановлен из настроек: показать путь вернуть интерактивность. */
  onClickThroughRestored?(): void;
  /** Как часто заново поднимать окно поверх остальных, мс. */
  raiseIntervalMs?: number;
  /** Приложение завершается: окна закрываются насовсем, пересоздавать нельзя. */
  isQuitting?(): boolean;
  onError?(message: string, err?: unknown): void;
}

export type WidgetEvents = {
  boundsChanged: (bounds: WidgetBounds) => void;
  visibilityChanged: (visible: boolean) => void;
};

const SAVE_DEBOUNCE_MS = 500;
/** Сколько раз за RECREATE_WINDOW_MS окно пересоздаётся после падения, прежде чем сдаться. */
const MAX_RECREATES = 3;
const RECREATE_WINDOW_MS = 60_000;

const sameRect = (a: Rect | null | undefined, b: Rect | null | undefined) =>
  !!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
const sameBounds = (a: WidgetBounds | null, b: WidgetBounds | null) =>
  a === b || (sameRect(a, b) && a!.displayId === b!.displayId);
const rectOf = ({ x, y, width, height }: Rect): Rect => ({ x, y, width, height });

export class WidgetManager extends TypedEmitter<WidgetEvents> {
  private win: WidgetWindowPort | null = null;
  private current: WidgetSettings;
  private visible = false;
  private sessionActive = false;
  /** Последние границы, поставленные программно — события move/resize с ними не считаются действием пользователя. */
  private lastApplied: Rect | null = null;
  private applying = false;
  private persisting = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private raiseTimer: ReturnType<typeof setInterval> | null = null;
  private subscriptions: Unsubscribe[] = [];
  /** Когда окно пересоздавалось после падения (защита от бесконечного цикла). */
  private recreatedAt: number[] = [];

  constructor(private readonly deps: WidgetDeps) {
    super();
    this.current = deps.settings.get().widget;
  }

  /** Восстановить состояние из настроек и подписаться на настройки, экраны и таймер. */
  start(): void {
    const { settings, screen, timer } = this.deps;
    this.subscriptions.push(
      settings.on('change', (next) => this.applySettings(next.widget)),
      screen.onChange(() => this.refitToDisplays()),
    );
    if (timer) {
      this.sessionActive = timer.snapshot().status !== 'idle';
      this.subscriptions.push(
        timer.on('sessionStarted', () => this.onSessionStarted()),
        timer.on('state', (snap) => this.onTimerState(snap)),
      );
    }
    // Сохранённые границы подгоняются под текущие экраны (монитор могли отключить, пока приложение не работало)
    this.persistBounds(resolveBounds(this.current, screen.displays()));
    if (this.shouldShowOnStart()) this.reveal();
    if (this.current.clickThrough) this.deps.onClickThroughRestored?.();
  }

  dispose(): void {
    for (const off of this.subscriptions.splice(0)) off();
    this.clearIdleTimer();
    this.stopRaiseLoop();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  show(): void {
    this.clearIdleTimer();
    this.reveal();
    this.persist({ hidden: false });
  }

  hide(): void {
    this.clearIdleTimer();
    this.conceal();
    this.persist({ hidden: true });
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  setClickThrough(on: boolean): void {
    this.persist({ clickThrough: on });
  }

  toggleClickThrough(): void {
    this.setClickThrough(!this.current.clickThrough);
  }

  setAlwaysOnTop(on: boolean): void {
    this.persist({ alwaysOnTop: on });
  }

  /** 'free' только снимает привязку; угол — ставит виджет в угол его экрана с отступом marginPx. */
  snapToAnchor(anchor: Anchor): void {
    this.persist({ anchor });
  }

  /** Новый размер окна от уголка ресайза: верхний левый угол на месте, не меньше минимума режима. */
  resize(width: number, height: number): void {
    const base = this.win?.getBounds() ?? this.current.bounds;
    if (!base) return;
    const size = clampSize({ width, height }, this.current.displayMode);
    const next = { ...rectOf(base), ...size };
    if (this.win) this.applyBounds(next);
    this.scheduleSave(next);
  }

  /** Применить настройки виджета к окну (вызывается на каждое изменение настроек). */
  applySettings(next: WidgetSettings): void {
    const prev = this.current;
    this.current = next;
    const win = this.win;
    if (win) {
      if (next.opacity !== prev.opacity) win.setOpacity(next.opacity);
      if (next.alwaysOnTop !== prev.alwaysOnTop) {
        win.setAlwaysOnTop(next.alwaysOnTop);
        this.updateRaiseLoop();
      }
      if (next.clickThrough !== prev.clickThrough) win.setClickThrough(next.clickThrough);
      if (next.displayMode !== prev.displayMode) {
        const min = MIN_SIZE[next.displayMode];
        win.setMinimumSize(min.width, min.height);
      }
    }
    if (next.hidden && !prev.hidden && this.visible) this.conceal();
    if (!next.hidden && prev.hidden && !this.visible) this.reveal();
    if (!this.persisting) this.reconcileBounds(next, prev);
  }

  // ── Видимость ─────────────────────────────────────────────────────────

  private shouldShowOnStart(): boolean {
    return !this.current.hidden && (!this.current.showOnSessionStart || this.sessionActive);
  }

  private onSessionStarted(): void {
    this.sessionActive = true;
    this.clearIdleTimer();
    if (this.current.showOnSessionStart && !this.visible) this.show();
  }

  private onTimerState(snap: TimerSnapshot): void {
    const active = snap.status !== 'idle';
    if (active) this.clearIdleTimer();
    else if (this.sessionActive && this.current.showOnSessionStart && this.visible && !this.idleTimer) {
      // Сессии больше нет — через 5 с убираем виджет, не помечая его «скрытым пользователем» (§3.15)
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.conceal();
      }, WIDGET_IDLE_HIDE_MS);
    }
    this.sessionActive = active;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private reveal(): void {
    const win = this.ensureWindow();
    if (!win) return;
    win.show();
    if (this.current.alwaysOnTop) win.raise();
    this.setVisible(true);
  }

  private conceal(): void {
    this.win?.hide();
    this.setVisible(false);
  }

  private setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    this.updateRaiseLoop();
    this.emit('visibilityChanged', visible);
  }

  /** Пока виджет виден и «поверх всех окон» включено — периодически поднимаем его снова (§3.2). */
  private updateRaiseLoop(): void {
    const need = this.visible && this.current.alwaysOnTop;
    if (need && !this.raiseTimer) {
      this.raiseTimer = setInterval(() => this.win?.raise(), this.deps.raiseIntervalMs ?? 2000);
    } else if (!need) this.stopRaiseLoop();
  }

  private stopRaiseLoop(): void {
    if (this.raiseTimer) clearInterval(this.raiseTimer);
    this.raiseTimer = null;
  }

  // ── Окно и геометрия ──────────────────────────────────────────────────

  private ensureWindow(): WidgetWindowPort | null {
    if (this.win) return this.win;
    const bounds = resolveBounds(this.current, this.deps.screen.displays());
    if (!bounds) return null;
    const s = this.current;
    const win = this.deps.createWindow({ bounds: rectOf(bounds), clickThrough: s.clickThrough });
    this.win = win;
    const min = MIN_SIZE[s.displayMode];
    win.setMinimumSize(min.width, min.height);
    win.setOpacity(s.opacity);
    win.setAlwaysOnTop(s.alwaysOnTop);
    win.setClickThrough(s.clickThrough);
    this.applyBounds(bounds);
    win.onGeometryChange(() => this.onWindowGeometry());
    win.onGone((reason) => this.onWindowGone(win, reason));
    win.onCloseRequest(() => this.onWindowCloseRequest());
    return win;
  }

  /** Закрытие пользователем — то же, что «Скрыть»; при выходе из приложения окно закрывается. */
  private onWindowCloseRequest(): boolean {
    if (this.deps.isQuitting?.()) return false;
    this.hide();
    return true;
  }

  /** Окно умерло (падение renderer или закрытие): забыть его и, если виджет должен быть виден, создать заново (§12.2). */
  private onWindowGone(win: WidgetWindowPort, reason: 'crashed' | 'closed'): void {
    if (this.win !== win) return;
    this.win = null;
    this.lastApplied = null;
    const restore = this.visible && !this.deps.isQuitting?.();
    if (!restore) {
      this.setVisible(false);
      return;
    }
    const now = Date.now();
    this.recreatedAt = this.recreatedAt.filter((t) => now - t < RECREATE_WINDOW_MS);
    if (this.recreatedAt.length >= MAX_RECREATES) {
      this.deps.onError?.(`widget window is gone (${reason}) too often; not recreating until shown again`);
      this.setVisible(false);
      return;
    }
    this.recreatedAt.push(now);
    this.deps.onError?.(`widget window is gone (${reason}); recreating`);
    this.reveal();
    if (!this.win) this.setVisible(false);
  }

  private applyBounds(bounds: Rect): void {
    const win = this.win;
    if (!win) return;
    if (sameRect(win.getBounds(), bounds)) {
      this.lastApplied = win.getBounds();
      return;
    }
    this.applying = true;
    try {
      win.setBounds(rectOf(bounds));
    } finally {
      this.applying = false;
    }
    // Фактические границы (масштаб экрана может округлить) — чтобы отложенное событие move не сочлось за перетаскивание
    this.lastApplied = win.getBounds();
  }

  /** Окно сдвинул или растянул пользователь: привязка к углу снимается, границы сохраняются с задержкой. */
  private onWindowGeometry(): void {
    if (this.applying || !this.win) return;
    const rect = this.win.getBounds();
    if (sameRect(rect, this.lastApplied)) return;
    this.lastApplied = rect;
    this.scheduleSave(rect);
  }

  private scheduleSave(rect: Rect): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const display = targetDisplay({ ...rect, displayId: null }, this.deps.screen.displays(), this.current.onDisplayRemoved);
      const bounds: WidgetBounds = { ...rectOf(rect), displayId: display?.id ?? null };
      this.persist({ bounds, anchor: 'free' }, { skipReconcile: true });
      this.emit('boundsChanged', bounds);
    }, SAVE_DEBOUNCE_MS);
  }

  /** Пересчитать положение после изменения настроек геометрии (вкладка, «в угол», смена режима). */
  private reconcileBounds(next: WidgetSettings, prev: WidgetSettings): void {
    const geometryChanged =
      !sameBounds(next.bounds, prev.bounds) ||
      next.anchor !== prev.anchor ||
      next.marginPx !== prev.marginPx ||
      next.displayMode !== prev.displayMode ||
      next.onDisplayRemoved !== prev.onDisplayRemoved;
    if (!geometryChanged) return;
    let source = next;
    if (next.displayMode !== prev.displayMode) {
      // Новый режим — его размер по умолчанию; верхний левый угол (или привязка к углу) сохраняется
      const base = this.win ? { ...this.win.getBounds(), displayId: next.bounds?.displayId ?? null } : next.bounds;
      source = { ...next, bounds: base ? { ...base, ...DEFAULT_SIZE[next.displayMode] } : null };
    }
    const target = resolveBounds(source, this.deps.screen.displays());
    if (!target) return;
    this.applyBounds(target);
    this.persistBounds(target);
  }

  /** Экраны изменились: виджет возвращается на доступный экран (§3.10). */
  private refitToDisplays(): void {
    const s = this.current;
    const base = this.win ? { ...this.win.getBounds(), displayId: s.bounds?.displayId ?? null } : s.bounds;
    const target = resolveBounds({ ...s, bounds: base }, this.deps.screen.displays());
    if (!target) return;
    this.applyBounds(target);
    this.persistBounds(target);
    this.emit('boundsChanged', target);
  }

  // ── Настройки ─────────────────────────────────────────────────────────

  private persistBounds(bounds: WidgetBounds | null): void {
    if (bounds && !sameBounds(bounds, this.current.bounds)) this.persist({ bounds });
  }

  private persist(patch: Partial<WidgetSettings>, opts: { skipReconcile?: boolean } = {}): void {
    const p: SettingsPatch = { widget: patch };
    this.persisting = opts.skipReconcile ?? false;
    try {
      this.deps.settings.patch(p);
    } finally {
      this.persisting = false;
    }
  }
}
