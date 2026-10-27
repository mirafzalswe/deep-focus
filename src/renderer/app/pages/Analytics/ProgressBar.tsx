// Полоса прогресса цели. Достигнутая цель — спокойный зелёный; недобор не подсвечивается красным.
import { cx } from '../../../shared/ui';

export function ProgressBar({ done, goal, label }: { done: number; goal: number; label: string }) {
  const ratio = goal > 0 ? Math.min(1, done / goal) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={goal}
      aria-valuenow={Math.min(done, goal)}
      className="h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className={cx('h-full rounded-full transition-[width]', ratio >= 1 ? 'bg-ok' : 'bg-accent')} style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}
