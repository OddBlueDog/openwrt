// Rarely changed settings, folded away under "More settings".
import { ChevronDownIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Rarely changed settings, folded away under "More settings"; `summary`
 * says which of them aren't at their usual value, so nothing unusual hides
 * behind the fold, and `forceOpen` (a field inside needs fixing) opens it.
 */
export function MoreSettings({
  summary,
  forceOpen = false,
  className,
  children,
}: {
  summary: string | undefined;
  forceOpen?: boolean;
  /** Where it sits in its parent (a grid cell, the foot of a card) */
  className?: string;
  children: ReactNode;
}): ReactElement {
  const [chosen, setOpen] = useState(false);
  const open = chosen || forceOpen;
  const panel = useId();
  return (
    <div className={cn('border-t', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm py-2 text-left text-sm font-medium hover:text-primary"
      >
        <ChevronDownIcon
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-fast', open && 'rotate-180')}
          aria-hidden
        />
        More settings
        {summary !== undefined && (
          <span className="min-w-0 flex-1 text-right text-xs font-normal text-pretty text-muted-foreground">{summary}</span>
        )}
      </button>
      <div id={panel} hidden={!open} className="divide-y border-t">
        {children}
      </div>
    </div>
  );
}
