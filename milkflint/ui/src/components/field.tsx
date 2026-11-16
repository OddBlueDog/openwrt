import { ChevronDownIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { AskButton, AskPanel } from '@/components/on-request';
import { shown, useOnRequest, useStateSymbols } from '@/lib/presentation';
import { Label } from '@/components/ui/label';
import { StateMark } from '@/components/ui/state-mark';
import { splitHint } from '@/lib/hint';
import { cn } from '@/lib/utils';

/**
 * A labelled form control with a one-line hint, an optional "Why?" that opens
 * the longer explanation, a status that always shows (state, a warning, why
 * it can't be changed), and an error. When the theme keeps explanations on
 * request, the hint and "Why?" are one panel behind a "?" beside the label. The label and hint sit beside the
 * control when the row is at least 40rem wide, judged by the row's own width
 * (a container query), so in a half-width card they go above it and the
 * control gets the card's full width. The control's column may shrink below
 * its content, so a long choice ends in … instead of pushing past the card.
 */
export function Field({
  id,
  label,
  hint,
  why,
  status,
  error,
  children,
  className,
  labelHidden = false,
}: {
  id: string;
  label: string;
  /** The label for screen readers only, where a heading right above already says it on screen */
  labelHidden?: boolean;
  hint?: ReactNode;
  /** The longer explanation: what it does, what it costs, which option it writes. */
  why?: ReactNode;
  /** Live state, a warning, or why it can't be changed: shown in every theme. */
  status?: ReactNode;
  error?: string | undefined;
  children: ReactNode;
  className?: string;
}): ReactElement {
  const split = typeof hint === 'string' && why === undefined ? splitHint(hint) : undefined;
  const lead = split?.lead ?? hint;
  const more = why ?? split?.rest;
  const [open, setOpen] = useState(false);
  const panel = useId();
  const onRequest = useOnRequest();
  const symbols = useStateSymbols();
  const explained = lead !== undefined || more !== undefined;
  return (
    <div className="@container">
      <div
        className={cn(
          'grid gap-2 py-3.5 @min-[40rem]:grid-cols-[minmax(10rem,15rem)_minmax(0,1fr)] @min-[40rem]:gap-8',
          className,
        )}
      >
        <div className="flex min-w-0 flex-col gap-1 @min-[40rem]:pt-2">
          {onRequest && explained && !labelHidden ? (
            <div className="flex items-center gap-2">
              <Label htmlFor={id}>{label}</Label>
              <AskButton
                about={label}
                open={open}
                onToggle={() => {
                  setOpen((o) => !o);
                }}
                controls={panel}
              />
            </div>
          ) : (
            <Label htmlFor={id} className={cn(labelHidden && 'sr-only')}>
              {label}
            </Label>
          )}
          {onRequest && explained && !labelHidden && (
            <AskPanel id={panel} open={open}>
              {lead}
              {more !== undefined && <div className={cn(lead !== undefined && 'mt-1.5')}>{more}</div>}
            </AskPanel>
          )}
          {!onRequest && lead !== undefined && (
            <p className="text-xs text-muted-foreground">
              {lead}
              {more !== undefined && (
                <>
                  {' '}
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={panel}
                    onClick={() => {
                      setOpen((o) => !o);
                    }}
                    className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
                  >
                    Why?
                    <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
                  </button>
                </>
              )}
            </p>
          )}
          {!onRequest && lead === undefined && more !== undefined && (
            <p className="text-xs">
              <button
                type="button"
                aria-expanded={open}
                aria-controls={panel}
                onClick={() => {
                  setOpen((o) => !o);
                }}
                className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
              >
                Why?
                <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
              </button>
            </p>
          )}
          {!onRequest && more !== undefined && (
            <AskPanel id={panel} open={open}>
              {more}
            </AskPanel>
          )}
          {shown(status) && <div className="text-xs text-muted-foreground">{status}</div>}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5 @min-[40rem]:max-w-md">
          {onRequest && explained && labelHidden ? (
            // the label is for screen readers (a heading above names it): the "?" sits beside the control
            <>
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">{children}</div>
                <AskButton
                  about={label}
                  open={open}
                  onToggle={() => {
                    setOpen((o) => !o);
                  }}
                  controls={panel}
                />
              </div>
              <AskPanel id={panel} open={open}>
                {lead}
                {more !== undefined && <div className={cn(lead !== undefined && 'mt-1.5')}>{more}</div>}
              </AskPanel>
            </>
          ) : (
            children
          )}
          {error !== undefined && (
            <p id={`${id}-error`} className="flex items-center gap-1.5 text-xs font-medium text-destructive">
              {symbols && <StateMark />}
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
