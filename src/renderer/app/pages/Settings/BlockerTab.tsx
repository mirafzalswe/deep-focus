// ЗАГЛУШКА Т01 → заполняет Т04.
import { useT } from '../../../shared/settings';
import { Placeholder } from '../../../shared/ui';

export default function BlockerTab() {
  const t = useT();
  return <Placeholder text={t('common.comingSoon')} />;
}
