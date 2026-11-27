import { type ComponentProps, type KeyboardEvent, type ReactElement, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { boundsText, readDraft } from '@/lib/number-draft';

/**
 * A number box that keeps what is typed. A value inside the limits goes to `onChange` at once; one outside them
 * is held (with the limits shown) and pulled into range when the box is left, so "9000" can be typed over "10"
 * without "9" being clamped on the way.
 */
export function NumberInput({
  value,
  onChange,
  min,
  max,
  integer,
  onEmpty,
  onBlur,
  onKeyDown,
  ...props
}: Omit<ComponentProps<'input'>, 'type' | 'value' | 'onChange' | 'min' | 'max'> & {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  integer?: boolean;
  /** what an empty box means when it's left; without it, the box goes back to `value` */
  onEmpty?: () => void;
}): ReactElement {
  const hintId = useId();
  const [text, setText] = useState(String(value));
  // the last value seen, so the parent's echo of a typed value doesn't reset the text, but a change from outside does
  const [was, setWas] = useState(value);
  if (was !== value) {
    setWas(value);
    setText(String(value));
  }
  const bounds = { min, max, integer };
  const draft = readDraft(text, bounds);
  const commit = (): void => {
    if (draft.kind === 'out') {
      onChange(draft.value);
      setWas(draft.value);
      setText(String(draft.value));
    } else if (draft.kind === 'empty') {
      onEmpty?.();
      setText(String(value));
    } else {
      setText(String(draft.value));
    }
  };
  const hint = draft.kind === 'out' ? boundsText(bounds) : '';
  return (
    <div className="relative">
      <Input
        {...props}
        type="number"
        inputMode={integer === true ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        value={text}
        aria-invalid={draft.kind === 'out' ? true : props['aria-invalid']}
        className={cn(draft.kind === 'out' && 'border-warning aria-invalid:border-warning', props.className)}
        aria-describedby={hint !== '' ? hintId : props['aria-describedby']}
        onChange={(e) => {
          setText(e.target.value);
          const d = readDraft(e.target.value, bounds);
          if (d.kind === 'ok') {
            setWas(d.value);
            onChange(d.value);
          }
        }}
        onBlur={(e) => {
          commit();
          onBlur?.(e);
        }}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === 'Enter') commit();
          onKeyDown?.(e);
        }}
      />
      {hint !== '' && (
        <span id={hintId} className="absolute top-full right-0 z-10 mt-0.5 text-xs whitespace-nowrap text-warning">
          {hint}
        </span>
      )}
    </div>
  );
}
