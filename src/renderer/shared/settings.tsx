// Настройки в renderer: снимок из main + подписка на изменения. Источник правды — main.
// Здесь же применяются тема (data-theme на <html>) и язык (useT).
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type MessageKey, type TranslateParams } from '@shared/i18n';
import type { AppSettings, Language, SettingsPatch, Theme } from '@shared/types';

interface SettingsContextValue {
  settings: AppSettings;
  patch(p: SettingsPatch): Promise<AppSettings>;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

function prefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(theme: Theme, systemDark: boolean): 'dark' | 'light' {
  if (theme === 'system') return systemDark ? 'dark' : 'light';
  return theme;
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState(prefersDark);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return dark;
}

export function SettingsProvider({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const systemDark = useSystemDark();

  useEffect(() => {
    let alive = true;
    const off = window.deepFocus.settings.onChange((next) => setSettings(next));
    void window.deepFocus.settings.get().then((s) => {
      if (alive) setSettings((cur) => cur ?? s);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const theme = settings ? resolveTheme(settings.general.theme, systemDark) : 'dark';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const language = settings?.general.language;
  useEffect(() => {
    if (language) document.documentElement.lang = language;
  }, [language]);

  const patch = useCallback(async (p: SettingsPatch) => {
    const next = await window.deepFocus.settings.patch(p);
    setSettings(next);
    return next;
  }, []);

  const value = useMemo(() => (settings ? { settings, patch } : null), [settings, patch]);
  if (!value) return <>{fallback ?? null}</>;
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings outside SettingsProvider');
  return ctx;
}

export type TFunction = (key: MessageKey, params?: TranslateParams) => string;

/** Перевод на текущий язык настроек. Ключ проверяется типами. */
export function useT(): TFunction {
  const lang: Language = useSettings().settings.general.language;
  return useCallback((key, params) => translate(lang, key, params), [lang]);
}
