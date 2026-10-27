// Раздел «Блокировка сайтов»: статус с причиной, ограничения механизма (§4.8.2, §4.8.3, §4.16), правила.
import { useT } from '../../../shared/settings';
import { Card, PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { useEnableBlocker } from './flows';
import { RulesCard } from './RulesCard';
import { StatusCard } from './StatusCard';
import { useBlockerStatus, useBlockRules } from './useBlocker';

export default function BlockerPage(_props: PageProps) {
  const t = useT();
  const status = useBlockerStatus();
  // правила могли поменяться из бэкапа — перечитываем при каждой смене статуса
  const refreshKey = status ? `${status.state}:${status.activeRuleIds.join(',')}` : '';
  const { rules, reload } = useBlockRules(refreshKey);
  const { enable, dialog } = useEnableBlocker(status);

  return (
    <>
      <PageHeader title={t('blocker.title')} subtitle={t('blocker.subtitle')} />
      <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-5">
          <StatusCard status={status} onEnable={enable} />
          <RulesCard rules={rules} activeRuleIds={status?.activeRuleIds ?? []} reload={reload} />
        </div>
        <div>
          <Card title={t('blocker.limits.title')}>
            <ul className="flex flex-col gap-3 text-sm text-muted" data-blocker-limits>
              <li>{t('blocker.limits.browsers')}</li>
              <li>{t('blocker.limits.subdomains')}</li>
              <li>{t('blocker.openTabsHint')}</li>
            </ul>
          </Card>
        </div>
      </div>
      {dialog}
    </>
  );
}
