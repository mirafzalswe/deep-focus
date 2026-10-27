// Данные раздела Blocker: статус из main (с подпиской на рассылку) и список правил.
import { useCallback, useEffect, useState } from 'react';
import type { BlockerStatus, BlockRule } from '@shared/types';

export function useBlockerStatus(): BlockerStatus | null {
  const [status, setStatus] = useState<BlockerStatus | null>(null);
  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.blocker.onStatus((s) => setStatus(s));
    void window.deepFocus.blocker
      .status()
      .then((s) => alive && setStatus((cur) => cur ?? s))
      .catch(() => undefined);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return status;
}

/** Правила; refreshKey — перечитать при его смене (правила могли поменяться из бэкапа или другого окна). */
export function useBlockRules(refreshKey = ''): { rules: BlockRule[]; reload: () => Promise<void> } {
  const [rules, setRules] = useState<BlockRule[]>([]);
  const reload = useCallback(async () => {
    setRules(await window.deepFocus.blocker.rules());
  }, []);
  useEffect(() => {
    let alive = true;
    void window.deepFocus.blocker.rules().then((list) => {
      if (alive) setRules(list);
    });
    return () => {
      alive = false;
    };
  }, [refreshKey]);
  return { rules, reload };
}

/** Текущее время, обновляемое раз в intervalMs (для отсчёта ожидания Strict). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** i18n-ключ причины из ошибки IPC (main кладёт ключ в message). */
export function errorKeyOf(err: unknown): string {
  const m = /blocker\.[A-Za-z]+\.[A-Za-z]+/.exec(err instanceof Error ? err.message : String(err));
  return m ? m[0] : 'common.error';
}

export function newRuleId(): string {
  return `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export const formatCountdown = (ms: number): string => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};
