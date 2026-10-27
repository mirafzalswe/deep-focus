// Главная (§10.2): режим, большой таймер, «Старт», текущая задача (Т02).
// Ниже таймера — быстрый ввод задачи, карточка результата и прогресс целей (Т06); звук и блокировку добавляют Т04/Т05.
import { useT } from '../../../shared/settings';
import { PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { GoalProgressCard } from './GoalProgressCard';
import { OutcomeCard } from './OutcomeCard';
import { QuickTask } from './QuickTask';
import { TimerPanel } from './TimerPanel';

export default function HomePage(_props: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.home')} />
      <TimerPanel />
      <div className="mt-8 flex flex-col gap-4">
        <OutcomeCard />
        <QuickTask />
        <GoalProgressCard />
      </div>
    </>
  );
}
