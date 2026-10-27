// Разделы главного окна и hash-маршрутизация: #/<section>[/<sub>] (например, #/settings/general).
import { useCallback, useEffect, useState } from 'react';

export const SECTIONS = ['home', 'timer', 'sounds', 'blocker', 'tasks', 'analytics', 'settings'] as const;
export type Section = (typeof SECTIONS)[number];

/** Пропсы каждой страницы раздела. */
export interface PageProps {
  sub: string | null;
  navigate: (section: Section, sub?: string | null) => void;
}

export interface Route {
  section: Section;
  sub: string | null;
}

export function parseHash(hash: string): Route {
  const [section, sub] = hash.replace(/^#\/?/, '').split('/');
  return {
    section: (SECTIONS as readonly string[]).includes(section ?? '') ? (section as Section) : 'home',
    sub: sub || null,
  };
}

export function useRoute(): [Route, (section: Section, sub?: string | null) => void] {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  const navigate = useCallback((section: Section, sub: string | null = null) => {
    window.location.hash = `#/${section}${sub ? `/${sub}` : ''}`;
  }, []);
  return [route, navigate];
}
