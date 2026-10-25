import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

/** Four bars for a received signal in dBm: -55 or better is full. */
export function SignalBars({ dbm, className }: { dbm: number | undefined; className?: string }): ReactElement {
  const level = dbm === undefined ? 0 : dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -72 ? 2 : dbm >= -80 ? 1 : 0;
  const tone = level >= 3 ? 'bg-success' : level === 2 ? 'bg-warning' : 'bg-destructive';
  return (
    <span className={cn('inline-flex h-3.5 items-end gap-[2px]', className)} aria-hidden="true">
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={cn('w-[3px] rounded-[1px]', bar <= level ? tone : 'bg-muted-foreground/25')}
          style={{ height: `${String(bar * 25)}%` }}
        />
      ))}
    </span>
  );
}
