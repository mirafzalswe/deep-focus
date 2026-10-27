// ЗАГЛУШКА Т01 → заполняет Т02.
import { useT } from '../../../shared/settings';
import { PageHeader, Placeholder } from '../../../shared/ui';
import type { PageProps } from '../../routes';

export default function TimerPage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.timer')} />
      <Placeholder text={t('common.comingSoon')} />
    </>
  );
}
