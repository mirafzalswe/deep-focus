// Небольшие поля ввода домена таймера на дизайн-токенах.
import type { InputHTMLAttributes } from 'react';
import { cx } from '../../../shared/ui';

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-6 w-11 rounded-full border transition-colors disabled:opacity-40',
        checked ? 'border-accent bg-accent' : 'border-line bg-surface-2',
      )}
    >
      <span
        className={cx(
          'absolute top-0.5 h-4.5 w-4.5 rounded-full transition-all',
          checked ? 'left-[22px] bg-accent-fg' : 'left-0.5 bg-muted',
        )}
      />
    </button>
  );
}

export function TextInput({ className, invalid, ...props }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return (
    <input
      {...props}
      aria-invalid={invalid || undefined}
      className={cx(
        'rounded-lg border bg-surface-2 px-3 py-1.5 text-sm text-fg outline-none transition-colors focus:border-accent',
        invalid ? 'border-danger' : 'border-line',
        className,
      )}
    />
  );
}

/** Поле минут: текст, чтобы пустое и неверное значение было видно, а не подменялось. */
export function MinutesInput({
  value,
  onChange,
  label,
  invalid,
  disabled,
  name,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  invalid?: boolean;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <TextInput
      inputMode="numeric"
      aria-label={label}
      name={name}
      value={value}
      disabled={disabled}
      invalid={invalid}
      onChange={(e) => onChange(e.target.value)}
      className="w-20 text-right tabular-nums"
    />
  );
}
