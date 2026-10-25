import type { ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { rating } from './score';

/** The 0-100 score as a ring in its rating's colour; `compact` for the dashboard. */
export function ScoreRing({ score, compact = false }: { score: number | undefined; compact?: boolean }): ReactElement {
  const r = rating(score ?? 0);
  const circumference = 2 * Math.PI * 42;
  const color = r.tone === 'success' ? 'var(--success)' : r.tone === 'warning' ? 'var(--warning)' : 'var(--destructive)';
  return (
    <div className={cn('relative shrink-0', compact ? 'size-20' : 'size-40')}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" className="stroke-muted" />
        {score !== undefined && (
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            strokeWidth="9"
            strokeLinecap="round"
            stroke={color}
            strokeDasharray={`${String((score / 100) * circumference)} ${String(circumference)}`}
            className="transition-[stroke-dasharray] duration-700"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn('font-semibold tracking-tight tabular', compact ? 'text-2xl' : 'text-4xl')}>{score ?? '—'}</span>
        {!compact && <span className="text-xs text-muted-foreground">of 100</span>}
      </div>
    </div>
  );
}
