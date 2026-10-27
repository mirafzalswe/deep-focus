// HotkeyManager: регистрации глобальных сочетаний (§8.2, §8.3). Electron — через ShortcutHost (globalShortcut).
import type { AppSettings, HotkeyAction, HotkeyCheck, HotkeyResult } from '../../shared/types';
import { HOTKEY_ACTIONS, HOTKEY_REASON, normalizeAccelerator, validateHotkey } from './validate';

/** Обёртка над globalShortcut: register → false, если сочетание занято другой программой. */
export interface ShortcutHost {
  register(accelerator: string, fn: () => void): boolean;
  unregister(accelerator: string): void;
}

export interface HotkeyManagerDeps {
  host: ShortcutHost;
  actions: Record<HotkeyAction, () => void>;
  onError?: (message: string, err?: unknown) => void;
}

type Hotkeys = AppSettings['hotkeys'];

export class HotkeyManager {
  /** действие → зарегистрированное (каноническое) сочетание */
  private readonly registered = new Map<HotkeyAction, string>();
  private last: HotkeyResult[] = [];

  constructor(private readonly deps: HotkeyManagerDeps) {}

  /** Привести регистрации к настройкам; неизменившиеся сочетания не трогаются. */
  applyAll(hotkeys: Hotkeys): HotkeyResult[] {
    const wanted = new Map<HotkeyAction, string>();
    const results = new Map<HotkeyAction, HotkeyResult>();
    for (const action of HOTKEY_ACTIONS) {
      const raw = hotkeys[action];
      if (raw.trim() === '') {
        results.set(action, { action, accelerator: '', registered: false, reasonKey: null });
        continue;
      }
      const check = validateHotkey(raw, action, earlierOnly(hotkeys, action));
      const canonical = normalizeAccelerator(raw);
      if (!check.ok || canonical === null) {
        results.set(action, { action, accelerator: raw, registered: false, reasonKey: check.reasonKey ?? HOTKEY_REASON.invalid });
        continue;
      }
      wanted.set(action, canonical);
    }
    // Сначала снять всё изменившееся: обмен сочетаниями между действиями не должен упираться сам в себя.
    for (const [action, accel] of [...this.registered]) {
      if (wanted.get(action) !== accel) this.release(action);
    }
    for (const [action, canonical] of wanted) {
      const ok = this.registered.get(action) === canonical || this.bind(action, canonical);
      results.set(action, { action, accelerator: canonical, registered: ok, reasonKey: ok ? null : HOTKEY_REASON.taken });
    }
    this.last = HOTKEY_ACTIONS.map((a) => results.get(a)!);
    return this.results();
  }

  results(): HotkeyResult[] {
    return this.last.map((r) => ({ ...r }));
  }

  /**
   * Назначить сочетание действию. Ничего не сохраняет: при reasonKey === null вызывающий пишет
   * accelerator в настройки. При отказе прежнее сочетание остаётся зарегистрированным.
   */
  assign(action: HotkeyAction, accelerator: string, hotkeys: Hotkeys): HotkeyResult {
    if (accelerator.trim() === '') {
      this.release(action);
      return this.remember({ action, accelerator: '', registered: false, reasonKey: null });
    }
    const check = validateHotkey(accelerator, action, hotkeys);
    const canonical = normalizeAccelerator(accelerator);
    if (!check.ok || canonical === null) {
      return { action, accelerator, registered: false, reasonKey: check.reasonKey ?? HOTKEY_REASON.invalid };
    }
    if (this.registered.get(action) === canonical) return this.remember({ action, accelerator: canonical, registered: true, reasonKey: null });
    const previous = this.registered.get(action);
    if (!this.tryRegister(canonical, this.deps.actions[action])) {
      return { action, accelerator: canonical, registered: false, reasonKey: HOTKEY_REASON.taken };
    }
    if (previous) this.deps.host.unregister(previous);
    this.registered.set(action, canonical);
    return this.remember({ action, accelerator: canonical, registered: true, reasonKey: null });
  }

  /** Проверка без сохранения: правила validateHotkey + пробная регистрация («занято другой программой»). */
  validate(accelerator: string, action: HotkeyAction, hotkeys: Hotkeys): HotkeyCheck {
    const check = validateHotkey(accelerator, action, hotkeys);
    const canonical = normalizeAccelerator(accelerator);
    if (!check.ok || canonical === null) return check;
    if ([...this.registered.values()].includes(canonical)) return check;
    if (!this.tryRegister(canonical, () => undefined)) return { ok: false, reasonKey: HOTKEY_REASON.taken };
    this.deps.host.unregister(canonical);
    return check;
  }

  /** На время записи сочетания в настройках: нажатия должны дойти до окна, а не сработать глобально. */
  suspend(): void {
    for (const action of [...this.registered.keys()]) this.release(action);
  }

  resume(hotkeys: Hotkeys): void {
    this.applyAll(hotkeys);
  }

  dispose(): void {
    this.suspend();
  }

  // ── внутреннее ──
  private bind(action: HotkeyAction, canonical: string): boolean {
    if (!this.tryRegister(canonical, this.deps.actions[action])) return false;
    this.registered.set(action, canonical);
    return true;
  }

  private tryRegister(canonical: string, fn: () => void): boolean {
    try {
      return this.deps.host.register(canonical, () => {
        try {
          fn();
        } catch (err) {
          this.deps.onError?.(`hotkey ${canonical} action failed`, err);
        }
      });
    } catch (err) {
      this.deps.onError?.(`hotkey ${canonical} rejected by system`, err);
      return false;
    }
  }

  private release(action: HotkeyAction): void {
    const accel = this.registered.get(action);
    if (!accel) return;
    try {
      this.deps.host.unregister(accel);
    } catch (err) {
      this.deps.onError?.(`hotkey ${accel} unregister failed`, err);
    }
    this.registered.delete(action);
  }

  private remember(result: HotkeyResult): HotkeyResult {
    this.last = HOTKEY_ACTIONS.map((a) =>
      a === result.action
        ? { ...result }
        : (this.last.find((r) => r.action === a) ?? { action: a, accelerator: '', registered: false, reasonKey: null }),
    );
    return result;
  }
}

/** Для applyAll: дубликатом считается только совпадение с действием выше по списку — первое остаётся. */
function earlierOnly(hotkeys: Hotkeys, action: HotkeyAction): Hotkeys {
  const index = HOTKEY_ACTIONS.indexOf(action);
  const copy = { ...hotkeys };
  for (const later of HOTKEY_ACTIONS.slice(index + 1)) copy[later] = '';
  return copy;
}
