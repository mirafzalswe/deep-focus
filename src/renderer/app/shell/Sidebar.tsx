import { useT } from '../../shared/settings';
import { cx } from '../../shared/ui';
import { SECTIONS, type Section } from '../routes';
import { NavIcon } from './icons';

export function Sidebar({ active, onSelect }: { active: Section; onSelect: (s: Section) => void }) {
  const t = useT();
  return (
    <nav aria-label="Deep Focus" className="flex w-56 shrink-0 flex-col border-r border-line bg-surface px-3 py-5">
      <div className="mb-7 flex items-center gap-2.5 px-3">
        <span className="h-2.5 w-2.5 rounded-full bg-ok" aria-hidden="true" />
        <span className="font-display text-[15px] font-semibold tracking-tight text-fg">{t('common.appName')}</span>
      </div>
      <ul className="flex flex-col gap-0.5">
        {SECTIONS.map((section) => {
          const isActive = section === active;
          return (
            <li key={section}>
              <button
                type="button"
                data-section={section}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => onSelect(section)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
                )}
              >
                <span className={isActive ? 'text-accent' : ''}>
                  <NavIcon section={section} />
                </span>
                {t(`nav.${section}`)}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
