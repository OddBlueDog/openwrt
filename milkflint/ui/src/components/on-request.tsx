// The "?" of theme.presentation.explanations (hooks in lib/presentation.ts).
// With explanations 'on-request', a description or a
// hint moves behind a "?" beside the title or label it belongs to: pressed,
// it opens below; never on hover. Live state, errors and warnings are not
// explanations: they go in a component's `status`, which always shows.
import type { ReactElement, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The "?": at least 24 px square (WCAG 2.5.8) whatever the theme's spacing, named after what it explains. */
export function AskButton({
  about,
  open,
  onToggle,
  controls,
  className,
}: {
  about: string;
  open: boolean;
  onToggle: () => void;
  controls: string;
  className?: string;
}): ReactElement {
  return (
    <button
      type="button"
      aria-label={`About ${about}`}
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className={cn(
        'inline-flex min-h-[1.5rem] min-w-[1.5rem] shrink-0 cursor-pointer items-center justify-center rounded-full border border-input text-xs font-medium text-muted-foreground transition-colors duration-fast hover:border-foreground hover:text-foreground',
        open && 'border-foreground text-foreground',
        className,
      )}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}

/** What the "?" opens: the explanation, on a quiet surface. */
export function AskPanel({
  id,
  open,
  children,
  className,
}: {
  id: string;
  open: boolean;
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <div
      id={id}
      hidden={!open}
      className={cn('mt-1 max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground', className)}
    >
      {children}
    </div>
  );
}
