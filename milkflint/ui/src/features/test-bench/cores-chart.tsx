// The router's CPU per core over a run, for its timelines, on TanStack
// Charts: a row per core, a cell a second whose colour deepens with the
// core's busy share. Its plot starts where the report's charts' do, and it
// shares their cursor (its samples go on their grid by the same rule as
// their points), so hovering any of them shows the same moment here: every
// core's busy share and its softirq share.
import { bandY, type ConfiguredColorScaleLike, defineChart, rect } from '@tanstack/charts';
import { crosshair } from '@tanstack/charts/crosshair';
import type { ChartCursorController } from '@tanstack/charts/cursor';
import { cursorHost } from '@tanstack/charts/cursor';
import { decorative } from '@tanstack/charts/mark/decorative';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import { portal } from '@tanstack/charts/tooltip/portal';
import { type ReactElement, useMemo } from 'react';
import { PLOT_LEFT } from '@/components/charts/time-axis';
import { formatPercent } from '@/lib/format';
import { type CpuRows, GRID_MS, onGrid } from './timelines';

const COLOR = 'var(--chart-2)';
/** A row's height and the gap under it, px (h-4, gap-1). */
const ROW = 16;
const GAP = 4;

// a busy share as the cell's colour: the deeper, the busier, and never so
// pale it vanishes; a share of nothing isn't drawn
const shade: ConfiguredColorScaleLike<number, string> = Object.assign(
  (v: number): string =>
    v <= 0
      ? 'transparent'
      : `color-mix(in srgb, ${COLOR} ${String(Math.round(Math.min(1, 0.08 + v * 0.92) * 100))}%, transparent)`,
  { copy: () => shade },
);

export function CoresChart({
  cpu,
  from,
  to,
  timeText,
  cursor,
  label,
}: {
  cpu: CpuRows;
  /** the time axis, ms from the run's start */
  from: number;
  to: number;
  timeText: (t: number) => string;
  /** the report's, shared with its other charts */
  cursor: ChartCursorController<number, number>;
  label: string;
}): ReactElement {
  const definition = useMemo(() => {
    const cores = cpu.busy.map((_, i) => i);
    // each second's sample (its index), where the other charts have their points
    const cells = onGrid(
      cpu.spans.map(([, end], i) => [end, i]),
      to,
    ).flatMap(([t, at]) =>
      at === null
        ? []
        : cores.flatMap((core) => {
            const v = cpu.busy[core]?.[at];
            return v === null || v === undefined ? [] : [{ core, at, t, v }];
          }),
    );
    return defineChart({
      marks: [
        decorative(bandY(cores, { y: (i) => i, fill: 'var(--muted)', radius: 2 })),
        rect(cells, {
          x: 't',
          x1: (c) => c.t - GRID_MS / 2,
          x2: (c) => c.t + GRID_MS / 2,
          y: 'core',
          z: 'core',
          color: 'v',
          inset: 0,
        }),
        crosshair({ x: true, y: false }),
      ],
      scales: {
        x: { scale: scaleLinear().domain([from, to]), axis: false },
        y: {
          scale: scaleBand<number>()
            .domain(cores)
            .paddingInner(GAP / (ROW + GAP)),
          axis: { ticks: { format: (i) => `CPU ${String(i)}`, size: 0 }, line: false },
        },
      },
      color: { scale: shade },
      margin: { left: PLOT_LEFT, right: 0, top: 0, bottom: 0 },
      // the last second's cell can run past the run's end
      clip: true,
      theme: { foreground: 'var(--muted-foreground)', muted: 'var(--muted-foreground)' },
      focus: 'group-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      focusRing: false,
      cursor: { use: cursorHost, controller: cursor, mode: 'focus', match: 'x' },
      tooltip: {
        use: tooltip,
        className: 'mf-chart-tooltip',
        sticky: false,
        placement: ['right', 'left'],
        // the strip is shorter than its card
        portal,
        content: (points) => {
          const at = points[0]?.datum.at ?? 0;
          return {
            title: timeText(points[0]?.xValue ?? from),
            rows: cpu.busy.map((row, i) => {
              const v = row[at];
              const si = cpu.softirq[i]?.[at];
              return {
                label: `CPU ${String(i)}`,
                value:
                  v === null || v === undefined
                    ? '—'
                    : `${formatPercent(v)}${si === null || si === undefined ? '' : ` · softirq ${formatPercent(si)}`}`,
                color: COLOR,
              };
            }),
          };
        },
      },
    });
  }, [cpu, from, to, timeText, cursor]);

  return <Chart definition={definition} height={cpu.busy.length * (ROW + GAP) - GAP} ariaLabel={label} />;
}
