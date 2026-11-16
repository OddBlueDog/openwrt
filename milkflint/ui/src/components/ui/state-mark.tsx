// The "!" a warning or destructive state carries beside its word in a theme
// whose states share one colour (presentation.stateMarks 'symbol'), so
// trouble reads without colour. Drawn in currentColor at the text's size; the
// word beside it says what's wrong, so it's hidden from screen readers.
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

export function StateMark({ className }: { className?: string }): ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-[1.15em] shrink-0 items-center justify-center rounded-full border-[0.1em] border-current text-[0.75em] leading-none font-bold',
        className,
      )}
    >
      !
    </span>
  );
}
