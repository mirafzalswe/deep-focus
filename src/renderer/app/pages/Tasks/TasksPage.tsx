// ЗАГЛУШКА Т01 → заполняет Т06.
import { useT } from '../../../shared/settings';
import { PageHeader, Placeholder } from '../../../shared/ui';
import type { PageProps } from '../../routes';

export default function TasksPage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.tasks')} />
      <Placeholder text={t('common.comingSoon')} />
    </>
  );
}
