// Ползунок громкости 0..1 (в интерфейсе — проценты).
import { cx } from '../../../shared/ui';

export function VolumeSlider({
  value,
  onChange,
  label,
  disabled,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <input
      type="range"
      min={0}
      max={100}
      step={1}
      value={Math.round(value * 100)}
      aria-label={label}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value) / 100)}
      className={cx('h-1.5 cursor-pointer accent-[var(--df-accent)] disabled:cursor-default disabled:opacity-40', className ?? 'w-36')}
    />
  );
}
