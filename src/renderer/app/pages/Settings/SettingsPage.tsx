// Настройки: пять вкладок (§11.1). Каждая вкладка — свой файл, заполняется своим таском.
import type { ComponentType } from 'react';
import type { MessageKey } from '@shared/i18n';
import { useT } from '../../../shared/settings';
import { cx, PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import BlockerTab from './BlockerTab';
import GeneralTab from './GeneralTab';
import SoundsTab from './SoundsTab';
import TimerTab from './TimerTab';
import WidgetTab from './WidgetTab';

const TABS = [
  { id: 'timer', titleKey: 'timer.tabTitle', Component: TimerTab },
  { id: 'widget', titleKey: 'widget.tabTitle', Component: WidgetTab },
  { id: 'blocker', titleKey: 'blocker.tabTitle', Component: BlockerTab },
  { id: 'sounds', titleKey: 'sounds.tabTitle', Component: SoundsTab },
  { id: 'general', titleKey: 'settings.generalTab', Component: GeneralTab },
] as const satisfies ReadonlyArray<{ id: string; titleKey: MessageKey; Component: ComponentType }>;

export default function SettingsPage({ sub, navigate }: PageProps) {
  const t = useT();
  const active = TABS.find((tab) => tab.id === sub) ?? TABS[0];
  const Active = active.Component;
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div role="tablist" aria-label={t('settings.title')} className="mb-6 flex gap-1 border-b border-line">
        {TABS.map((tab) => {
          const selected = tab.id === active.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              data-tab={tab.id}
              aria-selected={selected}
              onClick={() => navigate('settings', tab.id)}
              className={cx(
                '-mb-px border-b-2 px-3.5 py-2.5 text-sm transition-colors',
                selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg',
              )}
            >
              {t(tab.titleKey)}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">
        <Active />
      </div>
    </>
  );
}
