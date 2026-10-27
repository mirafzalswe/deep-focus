// ЗАГЛУШКА Т01 → заполняет Т05.
import { useT } from '../../../shared/settings';
import { Placeholder } from '../../../shared/ui';

export default function SoundsTab() {
  const t = useT();
  return <Placeholder text={t('common.comingSoon')} />;
}
