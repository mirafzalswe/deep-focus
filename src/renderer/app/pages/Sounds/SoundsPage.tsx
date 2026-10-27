// ЗАГЛУШКА Т01 → заполняет Т05.
import { useT } from '../../../shared/settings';
import { PageHeader, Placeholder } from '../../../shared/ui';
import type { PageProps } from '../../routes';

export default function SoundsPage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.sounds')} />
      <Placeholder text={t('common.comingSoon')} />
    </>
  );
}
