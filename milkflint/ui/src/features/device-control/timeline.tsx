// A week of internet time as seven bars, Monday first: each day from
// midnight to midnight, its time off drawn solid on a quiet track, a line at
// the router's time now on today's bar. Screen readers get the same as a
// list in words ("Monday: off until 07:00 and from 21:00").
import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { DAYS } from './model';
import { type Span, spansText } from './view';

const FULL = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const TICKS = [0, 6, 12, 18, 24] as const;

export function WeekTimeline({
  spans,
  today,
  nowSec,
  label,
  className,
}: {
  /** each day's time off, Monday first */
  spans: readonly (readonly Span[])[];
  /** 0 Monday … 6 Sunday, on the router's clock; undefined: no line for now */
  today?: number | undefined;
  nowSec?: number | undefined;
  /** what it's the week of: "Sam's week" */
  label: string;
  className?: string;
}): ReactElement {
  const pct = (sec: number): string => `${String((sec / 86400) * 100)}%`;
  return (
    <figure className={cn('grid gap-1.5', className)} aria-label={label}>
      <div className="grid grid-cols-[2rem_1fr] items-center gap-x-2 gap-y-1.5" aria-hidden="true">
        {DAYS.map((d, i) => (
          <div key={d} className="contents">
            <span className={cn('text-xs tabular', i === today ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {d}
            </span>
            <div className="relative h-3 overflow-hidden rounded-full bg-muted ring-1 ring-border ring-inset">
              {(spans[i] ?? []).map((s) => (
                <span
                  key={s.from}
                  className="absolute inset-y-0 bg-muted-foreground"
                  style={{ left: pct(s.from), width: pct(s.to - s.from) }}
                />
              ))}
              {i === today && nowSec !== undefined && (
                <span
                  className="absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground ring-1 ring-card"
                  style={{ left: pct(nowSec) }}
                />
              )}
            </div>
          </div>
        ))}
        <span />
        <div className="relative h-4 text-xs text-muted-foreground tabular">
          {TICKS.map((h) => (
            <span
              key={h}
              className={cn('absolute top-0', h === 0 ? '' : h === 24 ? '-translate-x-full' : '-translate-x-1/2')}
              style={{ left: pct(h * 3600) }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
        </div>
      </div>
      <ul className="sr-only">
        {FULL.map((d, i) => (
          <li key={d}>
            {d}
            {i === today ? ' (today)' : ''}: {spansText(spans[i] ?? [])}
          </li>
        ))}
      </ul>
    </figure>
  );
}
