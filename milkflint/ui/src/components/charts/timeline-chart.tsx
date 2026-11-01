// Series on one time axis, for a run's timelines: each point at its own
// time (not a slot), bands behind (a run's phases), ticks along the foot for
// events (probes that went unanswered), and a hover the parent holds, so
// every chart of a report shows the same moment.
import type { PointerEvent, ReactElement } from 'react';
import { cn } from '@/lib/utils';
import { niceCeil } from './path';
import { nearest, PLOT_LEFT, pointerTime, type TimePoint } from './time-axis';

export interface TimelineSeries {
  label: string;
  color: string;
  /** [time, value] in time order; null breaks the line */
  points: readonly TimePoint[];
  dashed?: boolean;
  /** times of events, ticked along the foot in the series' colour */
  marks?: readonly number[];
}

export interface TimeBand {
  from: number;
  to: number;
  shade: boolean;
}

const fmt = (n: number): string => n.toFixed(2);

function linePath(points: readonly TimePoint[], x: (t: number) => number, y: (v: number) => number): string {
  let d = '';
  let pen = false;
  for (const [t, v] of points) {
    if (v === null) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${fmt(x(t))} ${fmt(y(v))} `;
    pen = true;
  }
  return d.trim();
}

export function HoverCard({ x, title, rows }: { x: number; title: string; rows: readonly { label: string; color: string; value: string }[] }): ReactElement {
  return (
    <div
      className="pointer-events-none absolute top-0 z-10 flex min-w-36 flex-col gap-1 rounded-md border bg-popover px-2.5 py-2 text-xs whitespace-nowrap text-popover-foreground shadow-md"
      style={{ left: `${String(x)}%`, transform: x > 55 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
    >
      <span className="font-mono text-[10px] text-muted-foreground">{title}</span>
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-2">
          <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
          <span className="text-muted-foreground">{r.label}</span>
          <span className="ml-auto pl-3 font-medium tabular">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

export function TimelineChart({
  series,
  from,
  to,
  bands = [],
  format,
  hoverFormat = format,
  timeText,
  hover,
  onHover,
  max: fixedMax,
  minMax = 0,
  tolerance = 1500,
  className,
  label,
}: {
  series: readonly TimelineSeries[];
  /** the time axis */
  from: number;
  to: number;
  bands?: readonly TimeBand[];
  /** a value on the scale */
  format: (value: number) => string;
  hoverFormat?: (value: number) => string;
  timeText: (t: number) => string;
  /** the time hovered, on this chart or another of the report's */
  hover: number | undefined;
  onHover: (t: number | undefined) => void;
  /** a fixed top of the scale (a share: 1) */
  max?: number | undefined;
  /** the scale never goes below this, so quiet periods don't look busy */
  minMax?: number;
  /** how far from the hovered time a point may be to show, in the axis's units */
  tolerance?: number;
  /** the plot's height (default h-36) */
  className?: string;
  label: string;
}): ReactElement {
  const peak = Math.max(0, ...series.flatMap((s) => s.points.flatMap((p) => (p[1] === null ? [] : [p[1]]))));
  const max = fixedMax ?? niceCeil(Math.max(peak * 1.1, minMax));
  const span = Math.max(1, to - from);
  const x = (t: number): number => ((t - from) / span) * 100;
  const y = (v: number): number => 100 - (max > 0 ? Math.min(Math.max(v, 0) / max, 1) : 0) * 100;
  const rows =
    hover === undefined
      ? []
      : series.map((s) => {
          const p = nearest(s.points, hover, tolerance);
          return { s, p };
        });
  const shown = hover !== undefined && hover >= from && hover <= to && rows.some((r) => r.p !== undefined);
  const hx = hover === undefined ? 0 : x(hover);
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    onHover(pointerTime(e, from, to));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className={cn('relative h-36', className)}>
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[max, max / 2, 0].map((v) => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular">{format(v)}</span>
              <div className="h-px flex-1 border-t border-dashed border-border" />
            </div>
          ))}
        </div>
        <div className="absolute inset-y-[7px] right-0" style={{ left: PLOT_LEFT }}>
          {bands.map(
            (b) =>
              b.shade && (
                <div
                  key={b.from}
                  className="absolute inset-y-0 bg-muted/45"
                  style={{ left: `${String(Math.max(0, x(b.from)))}%`, width: `${String(Math.max(0, Math.min(100, x(b.to)) - Math.max(0, x(b.from))))}%` }}
                />
              ),
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={label} className="absolute inset-0 size-full overflow-visible">
            {series.map((s) => (
              <g key={s.label}>
                <path
                  d={linePath(s.points, x, y)}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed === true ? '4 3' : undefined}
                  vectorEffect="non-scaling-stroke"
                />
                {s.marks !== undefined && s.marks.length > 0 && (
                  <path
                    d={s.marks.map((t) => `M${fmt(x(t))} 100 L${fmt(x(t))} 93`).join(' ')}
                    stroke={s.color}
                    strokeWidth="1.5"
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            ))}
          </svg>
          <div
            aria-hidden="true"
            className="absolute inset-0 touch-pan-y"
            onPointerMove={move}
            onPointerDown={move}
            onPointerLeave={() => {
              onHover(undefined);
            }}
          >
            {hover !== undefined && hover >= from && hover <= to && (
              <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${String(hx)}%` }} />
            )}
            {shown &&
              rows.map(
                ({ s, p }) =>
                  // nearest() finds only points with a value
                  p !== undefined && (
                    <span
                      key={s.label}
                      className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                      style={{ left: `${String(x(p[0]))}%`, top: `${String(y(p[1] ?? 0))}%`, background: s.color }}
                    />
                  ),
              )}
            {shown && (
              <HoverCard
                x={hx}
                title={timeText(hover)}
                rows={rows.map(({ s, p }) => ({ label: s.label, color: s.color, value: p?.[1] === undefined || p[1] === null ? '—' : hoverFormat(p[1]) }))}
              />
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground" style={{ paddingLeft: PLOT_LEFT }}>
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn('h-0.5 w-3 rounded-full', s.dashed === true && 'opacity-60')} style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
