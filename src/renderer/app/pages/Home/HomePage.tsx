// Главная (§10.2): режим, большой таймер, «Старт», текущая задача (Т02); быстрый ввод задачи и карточка
// результата (Т06); звуковой профиль, статус блокировки и сводка дня (Т07). Настройки — в разделах.
import { useT } from '../../../shared/settings';
import { PageHeader } from '../../../shared/ui';
import type { PageProps } from '../../routes';
import { GoalProgressCard } from './GoalProgressCard';
import { BlockerStatusCard, SoundProfileCard } from './HomeStatus';
import { OutcomeCard } from './OutcomeCard';
import { QuickTask } from './QuickTask';
import { TimerPanel } from './TimerPanel';

export default function HomePage({ navigate }: PageProps) {
  const t = useT();
  return (
    <>
      <PageHeader title={t('nav.home')} />
      <TimerPanel navigate={navigate} />
      <div className="mx-auto mt-8 flex w-full max-w-2xl flex-col gap-4">
        <OutcomeCard />
        <QuickTask />
        <div className="flex flex-col gap-4 sm:flex-row">
          <SoundProfileCard />
          <BlockerStatusCard navigate={navigate} />
        </div>
        <GoalProgressCard />
      </div>
    </>
  );
}
