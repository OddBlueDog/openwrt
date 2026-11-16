// What a setting does now, on the row under it: the label on the left and
// the reading on the right, wrapping on a phone rather than cut short.
import type { ReactElement, ReactNode } from 'react';

export function NowRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-x-6 gap-y-0.5 py-2.5 text-sm max-sm:flex-col">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 font-medium break-words tabular sm:text-right">{children}</span>
    </div>
  );
}
