// Every bar chart in the UI, on TanStack Charts: a bar at each place along
// the foot (a channel, five minutes of a day, a second of a minute), of one
// part or several stacked bottom up, each part its own colour, on a scale
// whose top is fixed. Optionally the scale is marked on both sides, with a
// line at each mark, on a muted ground (what no bar takes shows as it); a
// baseline; labels under the bars. Hovering (or tapping, or the arrow keys)
// picks out the bar's place and shows its card above the plot. A bar of no
// parts draws nothing but is still there to hover (a second that wasn't
// measured); a null is a space between bars (where a band skips channels).
// The chart takes its box's height, from the className.
import { barY, type ChartTooltipContent, defineChart, frame, ruleY, text } from '@tanstack/charts';
import { crosshair } from '@tanstack/charts/crosshair';
import { decorative } from '@tanstack/charts/mark/decorative';
import { Chart } from '@tanstack/charts/react';
import { scaleBand } from '@tanstack/charts/scales/band';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import { portal } from '@tanstack/charts/tooltip/portal';
import { type ReactElement, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CHART_THEME, useHeight } from './chart-box';

export interface BarPart {
  value: number;
  /** A theme colour, e.g. var(--primary), or a faint one: color-mix(in oklab, var(--primary) 40%, transparent). */
  color: string;
}

export interface BarLabel {
  /** The bar it's under: its index in `bars`. */
  at: number;
  text: string;
  /** Centred under the bar unless it starts there (the left end) or ends there (the right end). */
  align?: 'start' | 'end' | undefined;
  /** A theme colour (default the muted text colour). */
  color?: string | undefined;
  bold?: boolean | undefined;
}

/** A painted part, or a bar's place to hover where it has none. */
interface Row {
  at: number;
  part: number;
  value: number;
  color: string;
}

export function BarChart({
  bars,
  max,
  card,
  label,
  labels = [],
  scale,
  baseline = false,
  cursor = 'band',
  gap = 0.25,
  className,
}: {
  /** Left to right: each bar's parts, bottom up; null leaves a space a bar wide. */
  bars: readonly (readonly BarPart[] | null)[];
  /** The top of the scale (the bottom is 0): a stack taller than it is cut off there. */
  max: number;
  /** What hovering the bar at an index shows: a heading, and lines under it (a swatch, a label and a value each). */
  card: (at: number) => ChartTooltipContent;
  /** What the chart shows, for screen readers. */
  label: string;
  labels?: readonly BarLabel[] | undefined;
  /** Marks on the scale, at both sides, each with a line across below the top, on a muted ground. */
  scale?: { ticks: readonly number[]; format: (value: number) => string } | undefined;
  /** A line along the foot. */
  baseline?: boolean | undefined;
  /** Hovering shades the bar's place, or (bars too thin to shade) draws a line through it. */
  cursor?: 'band' | 'line' | undefined;
  /** The share of each place left between bars. */
  gap?: number | undefined;
  /** The chart's height, labels included. */
  className?: string | undefined;
}): ReactElement {
  const [box, height] = useHeight();
  const definition = useMemo(() => {
    const rows = bars.flatMap((parts, at): Row[] => {
      if (parts === null) return [];
      const painted = parts.filter((p) => p.value > 0).map((p, part) => ({ at, part, value: p.value, color: p.color }));
      return painted.length > 0 ? painted : [{ at, part: 0, value: 0, color: 'transparent' }];
    });
    const y = scaleLinear().domain([0, max]).clamp(true);
    const sides = scale === undefined ? false : { ticks: { values: scale.ticks, format: scale.format, size: 0 }, line: false };
    // a text mark has one weight: the bold labels have their own
    const labelled = (bold: boolean) =>
      decorative(
        text(
          labels.filter((l) => (l.bold ?? false) === bold),
          {
            // a bar's place along the foot is [at, at + 1] on the `places` scale
            xScale: 'places',
            x: (l) => l.at + (l.align === 'start' ? 0 : l.align === 'end' ? 1 : 0.5),
            y: () => 0,
            text: 'text',
            dy: 12,
            anchor: (l) => l.align ?? 'middle',
            fill: (l) => l.color ?? 'var(--muted-foreground)',
            fontSize: 12,
            fontWeight: bold ? 600 : 400,
          },
        ),
      );
    return defineChart({
      marks: [
        ...(scale === undefined
          ? []
          : [
              frame({ fill: 'var(--muted)', fillOpacity: 0.6, stroke: 'none', radius: 6 }),
              // over the ground and under the bars (the top is the ground's edge)
              decorative(
                ruleY(
                  scale.ticks.filter((t) => t < max),
                  { stroke: 'var(--foreground)', strokeOpacity: 0.1 },
                ),
              ),
            ]),
        crosshair(
          cursor === 'band'
            ? { x: { band: { fill: 'var(--foreground)', fillOpacity: 0.1 } }, y: false }
            : { x: { stroke: 'var(--foreground)' }, y: false },
        ),
        barY(rows, { x: 'at', y: 'value', z: 'part', fill: (r) => r.color, radius: { end: 2 } }),
        ...(baseline ? [decorative(ruleY([0], { stroke: 'var(--rule)', strokeOpacity: 1 }))] : []),
        labelled(false),
        labelled(true),
      ],
      scales: {
        x: {
          // an instance, not a factory: a factory's domain would follow the bars, leaving out the spaces
          scale: scaleBand<number>()
            .domain(bars.map((_, at) => at))
            .paddingInner(gap)
            .paddingOuter(gap / 2),
          axis: false,
        },
        // the same places, as numbers: where the labels go (a band scale has only the bars' middles)
        places: { channel: 'x', scale: scaleLinear().domain([0, bars.length]), axis: false },
        y: { scale: y, axis: sides },
        right: { channel: 'y', side: 'right', scale: y, axis: sides },
      },
      // without a scale at the sides the bars go edge to edge: a label at either end can reach past them
      ...(scale === undefined ? { margin: { left: 0, right: 0 } } : {}),
      theme: CHART_THEME,
      focus: 'group-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      focusRing: false,
      tooltip: {
        use: tooltip,
        portal,
        className: 'mf-chart-tooltip',
        sticky: false,
        anchor: { x: 'value', y: 'plot-top' },
        placement: ['top', 'bottom'],
        content: (points) => card(points[0]?.datum.at ?? 0),
      },
    });
  }, [bars, max, card, labels, scale, baseline, cursor, gap]);

  return (
    <div className={cn('relative min-w-0', className)} ref={box}>
      {height > 0 && <Chart definition={definition} height={height} ariaLabel={label} className="absolute inset-0" />}
    </div>
  );
}
