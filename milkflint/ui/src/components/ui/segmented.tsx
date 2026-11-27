// A small segmented control (a radio group): a feed's direction, a list's
// view. Arrow keys move between the choices, as in any radio group.
import { type KeyboardEvent, type ReactElement, useRef } from 'react';
import { cn } from '@/lib/utils';

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  size = 'sm',
  id,
  'aria-invalid': invalid,
  'aria-describedby': describedBy,
  'data-form': dataForm,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm' | 'xs';
  /** wiring from a form field: its label's id and its error */
  id?: string | undefined;
  'aria-invalid'?: true | undefined;
  'aria-describedby'?: string | undefined;
  'data-form'?: string | undefined;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const move = (e: KeyboardEvent<HTMLButtonElement>, i: number): void => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (d === 0) return;
    e.preventDefault();
    const next = options[(i + d + options.length) % options.length];
    if (next === undefined) return;
    onChange(next.value);
    ref.current?.querySelectorAll<HTMLButtonElement>('button')[(i + d + options.length) % options.length]?.focus();
  };
  return (
    <div
      ref={ref}
      id={id}
      role="radiogroup"
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      data-form={dataForm}
      // as wide as its options, never stretched by a flex column or grid it sits in (a Field's control column)
      className={cn('inline-flex w-fit max-w-full flex-wrap rounded-md border bg-muted/50 p-0.5', disabled && 'opacity-60')}
    >
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={disabled}
            tabIndex={on ? 0 : -1}
            onKeyDown={(e) => {
              move(e, i);
            }}
            onClick={() => {
              onChange(o.value);
            }}
            className={cn(
              'rounded-sm whitespace-nowrap transition-colors',
              size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-xs',
              on ? 'bg-card font-medium text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
