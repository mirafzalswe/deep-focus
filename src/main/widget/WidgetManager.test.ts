import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, WIDGET_DEFAULT_SIZE } from '../../shared/defaults';
import type { AppSettings, TimerSnapshot, Unsubscribe } from '../../shared/types';
import { openStorage, type Storage } from '../db';
import { SettingsManager } from '../settings/SettingsManager';
import type { DisplayInfo, Rect } from './geometry';
import { WidgetManager, type TimerFeed, type WidgetWindowPort } from './WidgetManager';

// Фейковое окно: запоминает, что с ним сделали; «пользователь» двигает его через userMoveTo.
class FakeWindow implements WidgetWindowPort {
  visible = false;
  bounds: Rect;
  opacity = 1;
  alwaysOnTop = false;
  clickThrough = false;
  minSize = { width: 0, height: 0 };
  private geometryListener: (() => void) | null = null;
  constructor(init: { bounds: Rect }) {
    this.bounds = { ...init.bounds };
  }
  show() {
    this.visible = true;
  }
  hide() {
    this.visible = false;
  }
  isVisible() {
    return this.visible;
  }
  getBounds() {
    return { ...this.bounds };
  }
  setBounds(r: Rect) {
    this.bounds = { ...r };
    this.geometryListener?.(); // как Electron: move/resize приходят и на программную установку
  }
  setMinimumSize(width: number, height: number) {
    this.minSize = { width, height };
  }
  setOpacity(o: number) {
    this.opacity = o;
  }
  setAlwaysOnTop(on: boolean) {
    this.alwaysOnTop = on;
  }
  setClickThrough(on: boolean) {
    this.clickThrough = on;
  }
  raise() {}
  onGeometryChange(cb: () => void) {
    this.geometryListener = cb;
  }
  userMoveTo(x: number, y: number) {
    this.bounds = { ...this.bounds, x, y };
    this.geometryListener?.();
  }
  // окно умирает: renderer упал (Electron уничтожает окно) или окно закрыли
  gone = false;
  private goneListener: ((reason: 'crashed' | 'closed') => void) | null = null;
  private closeListener: (() => boolean) | null = null;
  onGone(cb: (reason: 'crashed' | 'closed') => void) {
    this.goneListener = cb;
  }
  onCloseRequest(cb: () => boolean) {
    this.closeListener = cb;
  }
  die(reason: 'crashed' | 'closed') {
    this.gone = true;
    this.visible = false;
    this.goneListener?.(reason);
  }
  /** Пользователь закрыл окно (Alt+F4). Не отменили — окно закрывается. */
  userClose() {
    const prevented = this.closeListener?.() ?? false;
    if (!prevented) this.die('closed');
    return prevented;
  }
}

class FakeScreen {
  list: DisplayInfo[] = [{ id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }];
  private listeners = new Set<() => void>();
  displays() {
    return this.list;
  }
  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  set(list: DisplayInfo[]) {
    this.list = list;
    for (const cb of this.listeners) cb();
  }
}

const idle: TimerSnapshot = {
  status: 'idle', mode: 'pomodoro', kind: 'focus', presetId: 'classic', sessionId: null, plannedMs: null,
  startedAt: null, endAt: null, pausedAt: null, pausedMs: 0, suspendedMs: 0, elapsedMs: 0, remainingMs: null,
  activeMs: 0, completedFocusInCycle: 0, taskId: null, projectId: null, recovered: false, now: 0,
};
const running: TimerSnapshot = { ...idle, status: 'running', sessionId: 's1', plannedMs: 1_500_000, remainingMs: 1_500_000 };

/** Фейковый движок таймера: любое обращение, кроме подписки и снимка, — попытка изменить таймер. */
function fakeTimer(initial: TimerSnapshot) {
  const listeners: Record<string, Set<(s: TimerSnapshot) => void>> = { state: new Set(), sessionStarted: new Set() };
  const touched: string[] = [];
  let snap = initial;
  const base = {
    snapshot: () => snap,
    on: (event: 'state' | 'sessionStarted', cb: (s: TimerSnapshot) => void) => {
      listeners[event]!.add(cb);
      return () => listeners[event]!.delete(cb);
    },
  };
  const feed = new Proxy(base, {
    get(target, prop) {
      if (prop in target) return target[prop as keyof typeof target];
      touched.push(String(prop));
      return () => undefined;
    },
  }) as TimerFeed;
  const emit = (event: 'state' | 'sessionStarted', s: TimerSnapshot) => {
    snap = s;
    for (const cb of listeners[event]!) cb(s);
  };
  return { feed, touched, emit };
}

let storage: Storage;
let settings: SettingsManager;
let screen: FakeScreen;
let windows: FakeWindow[];

let quitting = false;

function makeManager(timer?: TimerFeed) {
  const manager = new WidgetManager({
    settings,
    screen,
    timer,
    isQuitting: () => quitting,
    createWindow: (init) => {
      const w = new FakeWindow(init);
      windows.push(w);
      return w;
    },
  });
  manager.start();
  return manager;
}

const patchWidget = (p: Partial<AppSettings['widget']>) => settings.patch({ widget: p });
const win = () => windows[0]!;

beforeEach(() => {
  vi.useFakeTimers();
  storage = openStorage(':memory:');
  settings = new SettingsManager(storage);
  screen = new FakeScreen();
  windows = [];
  quitting = false;
});
afterEach(() => {
  vi.useRealTimers();
  storage.close();
});

describe('WidgetManager', () => {
  it('по умолчанию без сессии виджет скрыт; при sessionStarted показывается в правом верхнем углу с отступом', () => {
    const timer = fakeTimer(idle);
    const m = makeManager(timer.feed);
    expect(m.isVisible()).toBe(false);
    timer.emit('sessionStarted', running);
    expect(m.isVisible()).toBe(true);
    const { width, height } = WIDGET_DEFAULT_SIZE.standard;
    // 1920 − 224 − 24 = 1672; y = 24
    expect(win().bounds).toEqual({ x: 1920 - width - 24, y: 24, width, height });
    expect(win().alwaysOnTop).toBe(true);
    expect(win().opacity).toBe(DEFAULT_SETTINGS.widget.opacity);
  });

  it('после остановки сессии прячется через 5 с, а не раньше; новая сессия отменяет скрытие', () => {
    const timer = fakeTimer(running);
    const m = makeManager(timer.feed);
    expect(m.isVisible()).toBe(true); // восстановленная сессия → виден
    timer.emit('state', idle);
    vi.advanceTimersByTime(4900);
    expect(m.isVisible()).toBe(true);
    vi.advanceTimersByTime(200);
    expect(m.isVisible()).toBe(false);
    expect(settings.get().widget.hidden).toBe(false); // автоскрытие не считается «скрыл пользователь»

    timer.emit('sessionStarted', running);
    timer.emit('state', idle);
    vi.advanceTimersByTime(3000);
    timer.emit('sessionStarted', running);
    timer.emit('state', running);
    vi.advanceTimersByTime(5000);
    expect(m.isVisible()).toBe(true);
  });

  it('show/hide/toggle не трогают таймер и сохраняют hidden', () => {
    const timer = fakeTimer(running);
    const m = makeManager(timer.feed);
    m.hide();
    expect(m.isVisible()).toBe(false);
    expect(settings.get().widget.hidden).toBe(true);
    m.toggle();
    expect(m.isVisible()).toBe(true);
    expect(settings.get().widget.hidden).toBe(false);
    m.toggle();
    m.show();
    expect(timer.touched).toEqual([]);
    expect(timer.feed.snapshot()).toBe(running);
  });

  it('без показа при старте сессии виджет виден всегда, кроме явного скрытия, и это переживает перезапуск', () => {
    patchWidget({ showOnSessionStart: false });
    const m1 = makeManager(fakeTimer(idle).feed);
    expect(m1.isVisible()).toBe(true);
    m1.hide();
    m1.dispose();
    windows = [];
    const m2 = makeManager(fakeTimer(idle).feed);
    expect(m2.isVisible()).toBe(false);
    m2.show();
    m2.dispose();
    windows = [];
    expect(makeManager().isVisible()).toBe(true);
  });

  it('перетаскивание мышью: anchor → free, bounds сохраняются через 500 мс', () => {
    patchWidget({ showOnSessionStart: false });
    const m = makeManager();
    const changed = vi.fn();
    m.on('boundsChanged', changed);
    win().userMoveTo(300, 400);
    vi.advanceTimersByTime(400);
    expect(settings.get().widget.anchor).toBe('topRight');
    vi.advanceTimersByTime(200);
    expect(settings.get().widget).toMatchObject({ anchor: 'free', bounds: { x: 300, y: 400, displayId: 1 } });
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({ x: 300, y: 400 }));
    expect(win().bounds).toMatchObject({ x: 300, y: 400 }); // окно не дёргается обратно
  });

  it('«в угол» ставит виджет в нижний левый угол с отступом и сохраняет', () => {
    patchWidget({ showOnSessionStart: false, marginPx: 10 });
    const m = makeManager();
    m.snapToAnchor('bottomLeft');
    const { height } = WIDGET_DEFAULT_SIZE.standard;
    expect(win().bounds).toMatchObject({ x: 10, y: 1040 - height - 10 });
    expect(settings.get().widget).toMatchObject({ anchor: 'bottomLeft', bounds: { x: 10, y: 1040 - height - 10 } });
  });

  it('click-through: переключается, применяется к окну и сохраняется; alwaysOnTop отключается временно', () => {
    patchWidget({ showOnSessionStart: false });
    const m = makeManager();
    m.toggleClickThrough();
    expect(win().clickThrough).toBe(true);
    expect(settings.get().widget.clickThrough).toBe(true);
    m.setClickThrough(false);
    expect(win().clickThrough).toBe(false);
    m.setAlwaysOnTop(false);
    expect(win().alwaysOnTop).toBe(false);
    expect(settings.get().widget.alwaysOnTop).toBe(false);
  });

  it('настройки из вкладки применяются к окну: прозрачность, размер (не меньше минимума режима), режим', () => {
    patchWidget({ showOnSessionStart: false, anchor: 'free', bounds: { x: 100, y: 100, width: 300, height: 120, displayId: 1 } });
    makeManager();
    patchWidget({ opacity: 0.5 });
    expect(win().opacity).toBe(0.5);
    patchWidget({ bounds: { x: 100, y: 100, width: 10, height: 10, displayId: 1 } });
    expect(win().bounds).toMatchObject({ width: 180, height: 76 });
    expect(settings.get().widget.bounds).toMatchObject({ width: 180, height: 76 });
    patchWidget({ displayMode: 'compact' });
    expect(win().bounds).toEqual({ x: 100, y: 100, ...WIDGET_DEFAULT_SIZE.compact });
    expect(win().minSize).toEqual({ width: 120, height: 40 });
  });

  it('отключили монитор с виджетом — виджет переезжает на оставшийся экран и это сохраняется', () => {
    screen.list = [
      { id: 1, primary: true, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
      { id: 2, primary: false, workArea: { x: 1920, y: 0, width: 1920, height: 1040 } },
    ];
    patchWidget({ showOnSessionStart: false, anchor: 'free', bounds: { x: 3000, y: 500, width: 224, height: 96, displayId: 2 } });
    makeManager();
    expect(win().bounds).toMatchObject({ x: 3000, y: 500 });
    screen.set([screen.list[0]!]);
    expect(win().bounds).toMatchObject({ x: 1920 - 224, y: 500 });
    expect(settings.get().widget.bounds).toMatchObject({ x: 1920 - 224, y: 500, displayId: 1 });
  });

  it('при запуске сохранённый виджет за пределами экранов возвращается на основной', () => {
    patchWidget({ showOnSessionStart: false, anchor: 'free', bounds: { x: 5000, y: 5000, width: 224, height: 96, displayId: 7 } });
    makeManager();
    expect(win().bounds).toEqual({ x: 1920 - 224, y: 1040 - 96, width: 224, height: 96 });
  });

  it('renderer виджета упал → окно пересоздаётся с текущими настройками, виджет остаётся видимым (§12.2)', () => {
    const timer = fakeTimer(running);
    const m = makeManager(timer.feed);
    patchWidget({ opacity: 0.6, clickThrough: true });
    expect(windows).toHaveLength(1);
    windows[0]!.die('crashed');
    expect(windows).toHaveLength(2);
    const fresh = windows[1]!;
    expect(fresh.visible).toBe(true);
    expect(fresh.opacity).toBe(0.6);
    expect(fresh.clickThrough).toBe(true);
    expect(fresh.alwaysOnTop).toBe(true);
    expect(m.isVisible()).toBe(true);
    // новое окно управляется как прежнее
    m.hide();
    expect(fresh.visible).toBe(false);
    expect(timer.touched).toEqual([]);
  });

  it('окно закрылось, пока виджет скрыт → не пересоздаётся; isVisible() не врёт; show() создаёт новое окно', () => {
    const m = makeManager(fakeTimer(running).feed);
    m.hide();
    windows[0]!.die('closed');
    expect(windows).toHaveLength(1);
    expect(m.isVisible()).toBe(false);
    m.show();
    expect(windows).toHaveLength(2);
    expect(windows[1]!.visible).toBe(true);
    expect(m.isVisible()).toBe(true);
  });

  it('окно видимого виджета закрыто не пользователем (уничтожено) → пересоздаётся', () => {
    const m = makeManager(fakeTimer(running).feed);
    windows[0]!.die('closed');
    expect(windows).toHaveLength(2);
    expect(windows[1]!.visible).toBe(true);
    expect(m.isVisible()).toBe(true);
  });

  it('пользователь закрыл окно виджета (Alt+F4) — это hide(): окно цело, скрыто, hidden сохранён', () => {
    const m = makeManager(fakeTimer(running).feed);
    expect(windows[0]!.userClose()).toBe(true);
    expect(windows[0]!.gone).toBe(false);
    expect(windows[0]!.visible).toBe(false);
    expect(m.isVisible()).toBe(false);
    expect(settings.get().widget.hidden).toBe(true);
    m.show();
    expect(windows).toHaveLength(1);
    expect(windows[0]!.visible).toBe(true);
  });

  it('во время выхода окно закрывается без отмены и не пересоздаётся', () => {
    const m = makeManager(fakeTimer(running).feed);
    quitting = true;
    expect(windows[0]!.userClose()).toBe(false);
    expect(windows).toHaveLength(1);
    expect(m.isVisible()).toBe(false);
    expect(settings.get().widget.hidden).toBe(false);
  });

  it('renderer падает раз за разом — после нескольких попыток окно больше не пересоздаётся', () => {
    const m = makeManager(fakeTimer(running).feed);
    for (let i = 0; i < 10; i++) windows.at(-1)!.die('crashed');
    expect(windows.length).toBeLessThanOrEqual(4);
    expect(m.isVisible()).toBe(false);
    // через минуту — снова можно
    vi.advanceTimersByTime(60_000);
    m.show();
    expect(windows.at(-1)!.visible).toBe(true);
  });
});
