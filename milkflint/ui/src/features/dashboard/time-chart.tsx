// Home's line charts: values over time with a labelled scale on the left and
// times along the foot, both at the theme's smallest text size, a hover (or
// tap) that shows the time and each line's value there, and optional ticks
// along the foot for events (pings that went unanswered). Each point sits at
// its own time; a gap in the recording breaks the line.
import { type PointerEvent, type ReactElement, useId, useState } from 'react';
import { nearest, pointerTime, type TimePoint } from '@/components/charts/time-axis';
import { cn } from '@/lib/utils';
import { seriesDash } from '@/components/charts/series';

export interface ChartLine {
  label: string;
  /** A theme colour, e.g. var(--chart-1). */
  color: string;
  /** [epoch seconds, value]; null where there was no value. */
  points: readonly TimePoint[];
  /** Shade the area under the line. */
  area?: boolean;
}

export interface ChartMarks {
  label: string;
  color: string;
  times: readonly number[];
}

const fmt = (n: number): string => n.toFixed(2);

function clock(t: number, seconds: boolean): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  });
}

export function TimeChart({
  lines,
  from,
  to,
  max,
  step,
  format,
  hoverFormat = format,
  label,
  xLabels,
  marks,
  bands = [],
  empty,
  className,
  bare = false,
}: {
  lines: readonly ChartLine[];
  from: number;
  to: number;
  /** The top of the scale (the bottom is 0). */
  max: number;
  /** Seconds between points: a longer gap breaks the line. */
  step: number;
  /** A value on the scale. */
  format: (value: number) => string;
  hoverFormat?: (value: number) => string;
  /** What the chart shows, for screen readers. */
  label: string;
  /** Times along the foot; the first sits at the left edge and the last at the right. */
  xLabels: readonly { t: number; label: string }[];
  marks?: ChartMarks | undefined;
  /** Stretches to shade behind the lines (times on the axis), the label at the start of each. */
  bands?: readonly { from: number; to: number; label?: string | undefined }[];
  /** Said in the plot when there's nothing worth drawing (e.g. no traffic). */
  empty?: string | undefined;
  /** The plot's height (default h-28). */
  className?: string;
  /** Lines and their zero line only: no scale, grid or times along the foot (a glance). Hovering still reads the values. */
  bare?: boolean;
}): ReactElement {
  const id = useId();
  const [hover, setHover] = useState<number>();
  const span = Math.max(1, to - from);
  const x = (t: number): number => ((t - from) / span) * 100;
  const y = (v: number): number => 100 - (max > 0 ? Math.min(Math.max(v, 0) / max, 1) : 0) * 100;
  const ticks = [max, max / 2, 0];
  const widest = ticks.map(format).reduce((a, b) => (b.length > a.length ? b : a), '');

  const paths = lines.map((l) => {
    let line = '';
    let area = '';
    let run: [number, number][] = [];
    let lastT: number | undefined;
    const close = (): void => {
      const first = run[0];
      const last = run[run.length - 1];
      if (first !== undefined && last !== undefined) {
        const seg = run.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${fmt(px)} ${fmt(py)}`).join(' ');
        line += `${seg} `;
        area += `${seg} L${fmt(last[0])} 100 L${fmt(first[0])} 100 Z `;
      }
      run = [];
    };
    for (const [t, v] of l.points) {
      if (t < from || t > to) continue;
      if (v === null || (lastT !== undefined && t - lastT > step * 2.5)) close();
      if (v !== null) run.push([x(t), y(v)]);
      lastT = t;
    }
    close();
    return { line: line.trim(), area: area.trim() };
  });

  const rows = hover === undefined ? [] : lines.map((l) => ({ l, p: nearest(l.points, hover, step * 1.5) }));
  const at = rows.find((r) => r.p !== undefined)?.p?.[0];
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    setHover(pointerTime(e, from, to));
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={cn('mt-2 grid gap-x-2', bare ? 'grid-cols-1' : 'grid-cols-[auto_minmax(0,1fr)]')}>
        {/* the scale: the widest label, invisible, sets the column's width */}
        {!bare && (
          <div className="relative text-right text-xs text-muted-foreground tabular" aria-hidden="true">
            <span className="invisible block h-0 overflow-hidden">{widest}</span>
            {ticks.map((v, i) => (
              <span key={i} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${String(i * 50)}%` }}>
                {format(v)}
              </span>
            ))}
          </div>
        )}
        <div className={cn('relative h-28', className)}>
          {bands.map((b) => {
            const left = Math.max(0, x(b.from));
            const right = Math.min(100, x(b.to));
            if (right <= left) return null;
            return (
              <div
                key={b.from}
                className="pointer-events-none absolute inset-y-0 border-l border-dashed border-muted-foreground bg-muted"
                style={{ left: `${String(left)}%`, width: `${String(Math.max(0.5, right - left))}%` }}
              >
                {b.label !== undefined && (
                  <span
                    className={cn(
                      'absolute -top-0.5 text-xs font-medium whitespace-nowrap text-foreground',
                      left > 60 ? 'right-full mr-1.5 text-right' : 'left-1.5',
                    )}
                  >
                    {b.label}
                  </span>
                )}
              </div>
            );
          })}
          {/* bare: only the zero line, so a quiet line still has ground under it */}
          {ticks.map((_, i) =>
            bare && i !== 2 ? null : (
              <div
                key={i}
                className={cn(
                  'pointer-events-none absolute inset-x-0 border-t',
                  i === 2 ? 'border-rule' : 'border-dashed border-chart-grid',
                )}
                style={{ top: `${String(i * 50)}%` }}
              />
            ),
          )}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            role="img"
            aria-label={label}
            className="absolute inset-0 size-full overflow-visible"
          >
            <defs>
              {lines.map((l, i) => (
                <linearGradient key={l.label} id={`${id}-${String(i)}`} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={l.color} stopOpacity="0.2" />
                  <stop offset="100%" stopColor={l.color} stopOpacity="0" />
                </linearGradient>
              ))}
            </defs>
            {lines.map((l, i) => (
              <g key={l.label}>
                {l.area === true && <path d={paths[i]?.area} fill={`url(#${id}-${String(i)})`} />}
                <path
                  d={paths[i]?.line}
                  fill="none"
                  stroke={l.color}
                  style={{ strokeDasharray: seriesDash(l.color, lines.length) }}
                  strokeWidth="1.75"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
            {marks !== undefined && marks.times.length > 0 && (
              <path
                d={marks.times
                  .filter((t) => t >= from && t <= to)
                  .map((t) => `M${fmt(x(t))} 100 L${fmt(x(t))} 90`)
                  .join(' ')}
                stroke={marks.color}
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {empty !== undefined && (
            <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
              <span className="rounded-sm bg-card px-2 py-0.5">{empty}</span>
            </p>
          )}
          <div
            aria-hidden="true"
            className="absolute inset-0 touch-pan-y"
            onPointerMove={move}
            onPointerDown={move}
            onPointerLeave={() => {
              setHover(undefined);
            }}
          >
            {at !== undefined && (
              <>
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30"
                  style={{ left: `${String(x(at))}%` }}
                />
                {rows.map(({ l, p }) => {
                  const v = p?.[1];
                  return p === undefined || v === null || v === undefined ? null : (
                    <span
                      key={l.label}
                      className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card"
                      style={{ left: `${String(x(p[0]))}%`, top: `${String(y(v))}%`, background: l.color }}
                    />
                  );
                })}
                <div
                  className="pointer-events-none absolute top-0 z-10 flex min-w-32 flex-col gap-1 rounded-md border bg-popover px-2.5 py-2 text-xs whitespace-nowrap text-popover-foreground shadow-md"
                  style={{
                    left: `${String(x(at))}%`,
                    transform: x(at) > 55 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
                  }}
                >
                  <span className="text-muted-foreground tabular">{clock(at, span <= 3 * 3600)}</span>
                  {rows.map(({ l, p }) => (
                    <span key={l.label} className="flex items-center gap-2">
                      <span className="size-2 shrink-0 rounded-full" style={{ background: l.color }} />
                      <span className="text-muted-foreground">{l.label}</span>
                      <span className="ml-auto pl-3 font-medium tabular">
                        {p === undefined || p[1] === null ? '—' : hoverFormat(p[1])}
                      </span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
        {!bare && <div />}
        <div className={cn('relative mt-1 h-4 text-xs text-muted-foreground tabular', bare && 'hidden')} aria-hidden="true">
          {xLabels.map((l, i) => (
            <span
              key={l.t}
              className={cn(
                'absolute top-0 whitespace-nowrap',
                i === 0 ? '' : i === xLabels.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
              )}
              style={{ left: `${String(i === 0 ? 0 : i === xLabels.length - 1 ? 100 : x(l.t))}%` }}
            >
              {l.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
