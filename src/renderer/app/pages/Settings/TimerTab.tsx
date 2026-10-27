// ЗАГЛУШКА Т01 → заполняет Т02.
import { useT } from '../../../shared/settings';
import { Placeholder } from '../../../shared/ui';

export default function TimerTab() {
  const t = useT();
  return <Placeholder text={t('common.comingSoon')} />;
}
