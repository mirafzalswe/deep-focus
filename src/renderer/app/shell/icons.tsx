// Линейные иконки навигации (24×24, stroke = currentColor).
import type { Section } from '../routes';

const paths: Record<Section, string> = {
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5h-5v5H5a1 1 0 0 1-1-1z',
  timer: 'M12 8v4.5l3 1.8M9.5 3h5M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z',
  sounds: 'M4 14v-4M8 17V7M12 20V4M16 16V8M20 13v-2',
  blocker: 'M12 3 5 6v5.5c0 4.2 2.9 7.9 7 9.5 4.1-1.6 7-5.3 7-9.5V6zM9 12h6',
  tasks: 'M9 6h11M9 12h11M9 18h11M4.5 6l.8.8L6.8 5.3M4.5 12l.8.8 1.5-1.5M4.5 18l.8.8 1.5-1.5',
  analytics: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.7 1l-.3 2h-4l-.3-2a7 7 0 0 1-1.7-1l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2L3 10.3l2-3.4 1.9.7a7 7 0 0 1 1.7-1l.3-2h4l.3 2a7 7 0 0 1 1.7 1l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2z',
};

export function NavIcon({ section }: { section: Section }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[section]} />
    </svg>
  );
}
