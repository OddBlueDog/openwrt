// Rows of shares over time as cells of colour, e.g. each CPU's busy share
// second by second: the deeper, the busier. On the same time axis as the
// timeline chart (its plot starts PLOT_LEFT from the left too), with the
// same shared hover.
import type { PointerEvent, ReactElement } from 'react';
import { PLOT_LEFT, pointerTime } from './time-axis';
import { HoverCard } from './timeline-chart';

export interface HeatRow {
  label: string;
  /** a share (0..1) at each of `times`; null: no figure */
  values: readonly (number | null)[];
  /** more for the hover card, at a cell */
  detail?: (i: number) => string | undefined;
}

export function HeatStrip({
  rows,
  spans,
  from,
  to,
  color = 'var(--chart-2)',
  format,
  timeText,
  hover,
  onHover,
  label,
}: {
  rows: readonly HeatRow[];
  /** each cell's start and end on the time axis (a sample: the time since the one before) */
  spans: readonly (readonly [number, number])[];
  from: number;
  to: number;
  color?: string;
  format: (share: number) => string;
  timeText: (t: number) => string;
  hover: number | undefined;
  onHover: (t: number | undefined) => void;
  label: string;
}): ReactElement {
  const span = Math.max(1, to - from);
  const x = (t: number): number => ((t - from) / span) * 100;
  // the cell under the hovered time
  const at = hover === undefined ? -1 : spans.findIndex(([a, b]) => hover >= a && hover < b);
  const move = (e: PointerEvent<HTMLDivElement>): void => {
    onHover(pointerTime(e, from, to));
  };
  return (
    <div className="flex" role="img" aria-label={label}>
      <div className="flex shrink-0 flex-col gap-1" style={{ width: PLOT_LEFT }}>
        {rows.map((r) => (
          <span key={r.label} className="h-4 pr-2 text-right font-mono text-[10px] leading-4 text-muted-foreground">
            {r.label}
          </span>
        ))}
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex flex-col gap-1">
          {rows.map((r) => (
            <svg key={r.label} viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" className="h-4 w-full rounded-sm bg-muted">
              {r.values.map((v, i) =>
                v === null || v <= 0 ? null : (
                  // a hair wider than its span, so neighbours meet without a seam
                  <rect key={i} x={x(spans[i]?.[0] ?? 0)} width={x(spans[i]?.[1] ?? 0) - x(spans[i]?.[0] ?? 0) + 0.05} y="0" height="10" fill={color} fillOpacity={Math.min(1, 0.08 + v * 0.92)} />
                ),
              )}
            </svg>
          ))}
        </div>
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
            <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/40" style={{ left: `${String(x(hover))}%` }} />
          )}
          {at >= 0 && (
            <HoverCard
              x={x(hover ?? 0)}
              title={timeText(spans[at]?.[1] ?? 0)}
              rows={rows.map((r) => {
                const v = r.values[at];
                const more = r.detail?.(at);
                return { label: r.label, color, value: v === null || v === undefined ? '—' : `${format(v)}${more === undefined ? '' : ` · ${more}`}` };
              })}
            />
          )}
        </div>
      </div>
    </div>
  );
}
