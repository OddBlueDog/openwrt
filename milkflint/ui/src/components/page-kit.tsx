// Parts the Devices, Internet and Network pages share, kept here until the
// shared kit (src/components) has them: the page's opening answer, cards to
// choose one of (one selected style for every such choice), and a link with
// its arrow. The "More settings" fold and the UCI lines in "Why?" come from
// the Wi-Fi pages (../wifi/more-settings, ../wifi/explain).
import { ChevronRightIcon, type LucideIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactElement, type ReactNode, useId, useRef } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const answerColumns = {
  2: 'sm:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'sm:grid-cols-2 xl:grid-cols-4',
} as const;

/**
 * The page's opening answer: what's true now, as cells side by side in one
 * card (stacked on a phone), split by hairlines. Every cell is the same
 * height, so their links line up.
 */
export function Answer({
  columns,
  children,
  label,
}: {
  columns: keyof typeof answerColumns;
  children: ReactNode;
  label?: string;
}): ReactElement {
  return (
    <Card className="gap-0 overflow-hidden py-0" {...(label === undefined ? {} : { role: 'region', 'aria-label': label })}>
      <div className={cn('grid gap-px bg-border', answerColumns[columns])}>{children}</div>
    </Card>
  );
}

/** One cell of the answer: the question, what's true now (a figure or a badge), a line on it, and where to go next. */
export function AnswerCell({
  title,
  value,
  children,
  action,
}: {
  title: string;
  value: ReactNode;
  children?: ReactNode;
  /** a link or a button: the next step from here */
  action?: ReactNode;
}): ReactElement {
  return (
    // on a phone the question and its answer share a line, so the stacked cells stay short
    <div className="flex min-w-0 flex-col gap-1.5 bg-card px-4 py-3.5 sm:p-5">
      <div className="flex min-w-0 items-center justify-between gap-x-4 gap-y-1.5 max-sm:flex-wrap sm:flex-col sm:items-stretch">
        <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
        <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 max-sm:justify-end">{value}</div>
      </div>
      {children !== undefined && <div className="text-sm text-muted-foreground">{children}</div>}
      {action !== undefined && <div className="mt-auto pt-1">{action}</div>}
    </div>
  );
}

/** A cell's headline figure or word: large, with tabular digits. */
export function Figure({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return <span className={cn('min-w-0 truncate text-xl font-semibold tracking-tight tabular', className)}>{children}</span>;
}

/** A link to another page or place, with its arrow. */
export function GoLink({ href, children, className }: { href: string; children: ReactNode; className?: string }): ReactElement {
  return (
    <a
      href={href}
      className={cn('inline-flex w-fit items-center gap-0.5 text-sm font-medium link underline-offset-4', className)}
    >
      {children}
      <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
    </a>
  );
}

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
  /** a line on what it means */
  hint?: ReactNode;
  icon?: LucideIcon;
  /** beside the label: "Now", "Recommended" */
  badge?: ReactNode;
  /** under the hint: a diagram, a list */
  extra?: ReactNode;
  disabled?: boolean;
  /** an icon that carries meaning (allow, block) keeps its colour */
  tone?: 'success' | 'destructive';
}

const choiceColumns = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;

/**
 * Cards to pick one of: a radio group, with the arrow keys moving the choice
 * as in any radio group. The chosen card has the one selected style these
 * pages use (blue border and ring, a faint blue ground) and a filled radio
 * mark, so it never rests on colour alone.
 */
export function ChoiceCards<T extends string>({
  label,
  value,
  options,
  onChange,
  columns = 1,
  disabled = false,
  size = 'md',
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  columns?: keyof typeof choiceColumns;
  disabled?: boolean;
  /** lg: a roomier card, for a page's main choice */
  size?: 'md' | 'lg';
}): ReactElement {
  const id = useId();
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const usable = options.filter((o) => o.disabled !== true);
  // the chosen card takes Tab; with none chosen (or it can't be), the first usable one
  const focusable = usable.some((o) => o.value === value) ? value : usable[0]?.value;
  const onKey = (e: KeyboardEvent, current: T): void => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || usable.length === 0) return;
    e.preventDefault();
    const at = usable.findIndex((o) => o.value === current);
    const next = usable[(at + step + usable.length) % usable.length];
    if (next === undefined) return;
    onChange(next.value);
    refs.current.get(next.value)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cn('grid gap-3', choiceColumns[columns])}
    >
      {options.map((o) => {
        const selected = o.value === value;
        const off = disabled || o.disabled === true;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              if (el === null) refs.current.delete(o.value);
              else refs.current.set(o.value, el);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-labelledby={`${id}-${o.value}`}
            aria-describedby={o.hint === undefined ? undefined : `${id}-${o.value}-hint`}
            tabIndex={o.value === focusable ? 0 : -1}
            disabled={off}
            onClick={() => {
              onChange(o.value);
            }}
            onKeyDown={(e) => {
              onKey(e, o.value);
            }}
            className={cn(
              'flex min-w-0 cursor-pointer flex-col rounded-lg border bg-card text-left transition-colors duration-fast hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border',
              size === 'lg' ? 'gap-3 p-5' : 'gap-1.5 p-4',
              selected && 'border-primary bg-primary/5 ring-1 ring-primary hover:border-primary',
            )}
          >
            <span className="flex w-full min-w-0 items-start gap-2.5">
              {Icon !== undefined && (
                <Icon
                  className={cn(
                    'mt-0.5 size-4 shrink-0',
                    o.tone === 'success'
                      ? 'text-success'
                      : o.tone === 'destructive'
                        ? 'text-destructive'
                        : selected
                          ? 'text-primary'
                          : 'text-muted-foreground',
                  )}
                  aria-hidden="true"
                />
              )}
              <span
                id={`${id}-${o.value}`}
                className={cn(
                  'flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-medium',
                  size === 'lg' ? 'text-base' : 'text-sm',
                )}
              >
                {o.label}
                {/* a badge doesn't make its card's title line taller than its neighbours' */}
                {o.badge !== undefined && <span className="-my-1 inline-flex">{o.badge}</span>}
              </span>
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                  selected ? 'border-primary' : 'border-input',
                )}
              >
                {selected && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
            </span>
            {o.hint !== undefined && (
              <span id={`${id}-${o.value}-hint`} className={cn('text-xs text-muted-foreground', Icon !== undefined && 'pl-6.5')}>
                {o.hint}
              </span>
            )}
            {o.extra !== undefined && <span className={cn('block min-w-0', Icon !== undefined && 'pl-6.5')}>{o.extra}</span>}
          </button>
        );
      })}
    </div>
  );
}
