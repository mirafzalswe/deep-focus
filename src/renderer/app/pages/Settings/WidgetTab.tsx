// ЗАГЛУШКА Т01 → заполняет Т03.
import { useT } from '../../../shared/settings';
import { Placeholder } from '../../../shared/ui';

export default function WidgetTab() {
  const t = useT();
  return <Placeholder text={t('common.comingSoon')} />;
}
