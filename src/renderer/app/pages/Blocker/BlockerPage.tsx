// ЗАГЛУШКА Т01 → заполняет Т04.
import { useT } from '../../../shared/settings';
import { PageHeader, Placeholder } from '../../../shared/ui';
import type { PageProps } from '../../routes';

export default function BlockerPage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.blocker')} />
      <Placeholder text={t('common.comingSoon')} />
    </>
  );
}
