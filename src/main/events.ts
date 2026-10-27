// Минимальный типизированный эмиттер для модулей main (без зависимости от Electron).
import type { Unsubscribe } from '../shared/types';

type Listener = (...args: never[]) => void;

export class TypedEmitter<Events extends { [K in keyof Events]: Listener }> {
  private listeners = new Map<keyof Events, Set<Listener>>();

  on<K extends keyof Events>(event: K, listener: Events[K]): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  protected emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) {
      // Ошибка одного подписчика не должна мешать остальным
      try {
        (listener as (...a: Parameters<Events[K]>) => void)(...args);
      } catch (err) {
        this.onListenerError(err);
      }
    }
  }

  /** Переопределяется, чтобы логировать ошибки подписчиков. */
  protected onListenerError(_err: unknown): void {}
}
