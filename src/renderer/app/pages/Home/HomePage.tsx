// ЗАГЛУШКА Т01 → заполняет Т02/Т06: режим, большой таймер, «Старт», задача, звук, блокировка, сводка дня.
import { useT } from '../../../shared/settings';
import { PageHeader, Placeholder } from '../../../shared/ui';
import type { PageProps } from '../../routes';

export default function HomePage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.home')} />
      <Placeholder text={t('common.comingSoon')} />
    </>
  );
}
