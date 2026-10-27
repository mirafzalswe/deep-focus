// Главная (§10.2): режим, большой таймер, «Старт», текущая задача (Т02).
// Звуковой профиль, статус блокировки и сводку дня добавляют Т04/Т05/Т06 — отдельными блоками ниже таймера.
import { useT } from '../../../shared/settings';
import { PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { TimerPanel } from './TimerPanel';

export default function HomePage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.home')} />
      <TimerPanel />
    </>
  );
}
