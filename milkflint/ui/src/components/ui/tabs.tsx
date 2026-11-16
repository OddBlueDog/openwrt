import { type KeyboardEvent, type ReactElement, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

/**
 * Tabs as an underlined row, the ARIA tabs pattern: the selected tab is in
 * the tab order, the arrow keys (and Home, End) move between tabs and select
 * them. Pair each tab with a TabPanel of the same id and prefix.
 */
export function Tabs<T extends string>({
  label,
  prefix,
  items,
  value,
  onChange,
  className,
}: {
  /** What the tabs choose between, for screen readers. */
  label: string;
  /** Unique on the page: the tabs' and panels' ids start with it. */
  prefix: string;
  items: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}): ReactElement {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const last = items.length - 1;
    const to =
      e.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : e.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : undefined;
    const next = to === undefined ? undefined : items[to];
    if (next === undefined) return;
    e.preventDefault();
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn('flex w-full gap-6 overflow-x-auto border-b', className)}>
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            if (el === null) refs.current.delete(t.id);
            else refs.current.set(t.id, el);
          }}
          id={`${prefix}-tab-${t.id}`}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          aria-controls={`${prefix}-panel-${t.id}`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => {
            onChange(t.id);
          }}
          onKeyDown={(e) => {
            move(e, i);
          }}
          className={cn(
            '-mb-px shrink-0 cursor-pointer border-b-2 pb-2.5 text-sm whitespace-nowrap transition-colors duration-fast',
            value === t.id
              ? 'border-primary font-medium text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A tab's content. It stays mounted while hidden, so edits on it survive a look at another tab. */
export function TabPanel({
  prefix,
  id,
  value,
  children,
  className,
}: {
  prefix: string;
  id: string;
  value: string;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      id={`${prefix}-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`${prefix}-tab-${id}`}
      hidden={value !== id}
      className={className}
    >
      {children}
    </div>
  );
}
