// The status card's lower edge: the last day of drops, a tick for every
// five minutes, the height by how many (on a square-root scale, so one busy
// spell doesn't flatten the rest). Hovering or touching it says the slot's
// time and count; the whole is also said in words, for screen readers.
import { type PointerEvent, type ReactElement, useState } from 'react';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

const SLOTS = 288;
const MARKS = [
  { at: 0, label: '24 h ago' },
  { at: 72, label: '18 h' },
  { at: 144, label: '12 h' },
  { at: 216, label: '6 h' },
];

export function DropRibbon({
  values,
  end,
  step,
  muted,
  summary,
}: {
  /** oldest first, one per slot */
  values: readonly number[];
  /** the newest slot's start, epoch seconds */
  end: number | null | undefined;
  step: number;
  /** nothing to draw (off): a flat line */
  muted: boolean;
  summary: string;
}): ReactElement {
  const [at, setAt] = useState<number>();
  const v = values.slice(-SLOTS);
  const pad = SLOTS - v.length;
  const max = Math.max(1, ...v);
  const h = (x: number): number => (x <= 0 ? 0 : Math.max(8, Math.sqrt(x / max) * 100));
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * SLOTS);
    setAt(Math.min(SLOTS - 1, Math.max(0, i)));
  };
  const count = at === undefined ? undefined : at < pad ? 0 : (v[at - pad] ?? 0);
  const time =
    at === undefined || end === null || end === undefined ? undefined : new Date((end - (SLOTS - 1 - at) * step) * 1000);
  return (
    <div className="border-t bg-muted/40 px-5 pt-3 pb-2 sm:px-6">
      <div className="relative">
        <div
          role="img"
          aria-label={summary}
          className="relative h-12 touch-pan-y"
          onPointerMove={move}
          onPointerDown={move}
          onPointerLeave={() => {
            setAt(undefined);
          }}
        >
          <svg
            viewBox={`0 0 ${String(SLOTS)} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
            className="absolute inset-0 h-full w-full"
          >
            {/* the baseline: the day goes on whether anything knocked or not */}
            <line x1="0" x2={SLOTS} y1="99.5" y2="99.5" stroke="var(--rule)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {!muted &&
              v.map((x, i) => {
                const height = h(x);
                if (height === 0) return null;
                return (
                  <rect
                    key={i}
                    x={pad + i + 0.15}
                    width="0.7"
                    y={100 - height}
                    height={height}
                    fill="var(--primary)"
                    fillOpacity={at === pad + i ? 1 : 0.78}
                  />
                );
              })}
            {at !== undefined && (
              <line
                x1={at + 0.5}
                x2={at + 0.5}
                y1="0"
                y2="100"
                stroke="var(--foreground)"
                strokeOpacity="0.35"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {at !== undefined && time !== undefined && (
            <div
              className={cn(
                'pointer-events-none absolute -top-7 rounded-md border bg-popover px-2 py-0.5 text-xs whitespace-nowrap shadow-sm',
                at > SLOTS / 2 ? '-translate-x-full' : '',
              )}
              style={{ left: `${String((at / SLOTS) * 100)}%` }}
            >
              <span className="tabular">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-muted-foreground">, </span>
              <span className="font-medium tabular">{formatNumber(count ?? 0)}</span>
              <span className="text-muted-foreground"> {count === 1 ? 'drop' : 'drops'}</span>
            </div>
          )}
        </div>
        <div aria-hidden="true" className="relative mt-1 h-4 text-xs text-muted-foreground">
          {MARKS.map((m) => (
            <span key={m.at} className="absolute" style={{ left: `${String((m.at / SLOTS) * 100)}%` }}>
              {m.label}
            </span>
          ))}
          <span className="absolute right-0">now</span>
        </div>
      </div>
    </div>
  );
}
