// A series' key in a legend: a short line in its colour and, where the
// chart dashes its lines (series.ts), the same dash, so the key matches.
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';

export function SeriesSwatch({
  color,
  dash,
  className,
}: {
  color: string;
  dash?: string | undefined;
  className?: string;
}): ReactElement {
  return (
    // the size of the bar the legends drew before (h-0.5 w-3), so a solid key looks as it did
    <svg
      aria-hidden="true"
      viewBox="0 0 12 2"
      preserveAspectRatio="none"
      className={cn('h-0.5 w-3 shrink-0 overflow-visible', className)}
    >
      <line x1="1" y1="1" x2="11" y2="1" stroke={color} strokeWidth="2" strokeLinecap="round" style={{ strokeDasharray: dash }} />
    </svg>
  );
}
