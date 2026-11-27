// Every line chart over time in the UI, on TanStack Charts: values over time
// with a scale of three values on the left (0, half and the top) and labelled
// times along the foot, both at the theme's smallest text size; a hover (or
// tap, or the arrow keys) that shows the time and each line's value there,
// with a dot on each line; optional shaded stretches behind the lines, and
// ticks along the foot for events (pings that went unanswered), a set in
// each colour. Each point sits at its own time; a gap in the recording
// breaks the line. `bare` is a glance (a sparkline): lines only, still read
// by hovering. The chart takes its box's size: the className's height, or
// the card's spare height with `fill`; `left` pins where its plot starts, so
// charts one above another line up.
import { areaY, defineChart, dot, lineY, link, rect, text, whenFocused } from '@tanstack/charts';
import { crosshair } from '@tanstack/charts/crosshair';
import type { ChartCursorController } from '@tanstack/charts/cursor';
import { cursorHost } from '@tanstack/charts/cursor';
import { decorative } from '@tanstack/charts/mark/decorative';
import { Chart } from '@tanstack/charts/react';
import { scaleLinear } from '@tanstack/charts/scales/linear';
import { tooltip } from '@tanstack/charts/tooltip';
import { portal } from '@tanstack/charts/tooltip/portal';
import { type ReactElement, useMemo } from 'react';
import { useTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';
import { CHART_THEME, useHeight } from './chart-box';
import { seriesDash } from './series';
import { chartRows, clockText, type TimePoint } from './time-axis';

export interface ChartLine {
  label: string;
  /** A theme colour, e.g. var(--chart-1). */
  color: string;
  /** [time, value] in time order; null where there was no value. */
  points: readonly TimePoint[];
  /** Shade the area under the line. */
  area?: boolean | undefined;
  /** Dashed, whatever the theme says: a line that means something else (a peak against an average). */
  dashed?: boolean | undefined;
  /** A faint band from the line up to these values, at its times (the worst behind a typical one). */
  upper?: readonly TimePoint[] | undefined;
  /** Words beside a time's value when hovering, or in its place where it has none ("worst 40 ms", "lost"). */
  notes?: ReadonlyMap<number, string> | undefined;
}

export interface ChartMarks {
  label: string;
  color: string;
  times: readonly number[];
}

export interface ChartBand {
  from: number;
  to: number;
  label?: string | undefined;
}

export function TimeChart({
  lines,
  from,
  to,
  min = 0,
  max,
  ticks,
  step,
  format,
  hoverFormat = format,
  timeText = (t) => clockText(t, to - from <= 3 * 3600),
  label,
  xLabels = [],
  marks,
  bands = [],
  empty,
  className,
  bare = false,
  fill = false,
  hover = true,
  cursor,
  left,
  xGrid = false,
  cuts = [],
}: {
  lines: readonly ChartLine[];
  /** The time axis, in the points' own unit (epoch seconds unless `timeText` says otherwise). */
  from: number;
  to: number;
  /** The bottom of the scale (default 0); values below it are drawn at it. */
  min?: number | undefined;
  /** The top of the scale; values above it are drawn at it. */
  max: number;
  /** The values marked on the scale, each with a dashed line (default the bottom, half way and the top). */
  ticks?: readonly number[] | undefined;
  /** Time between points: a gap longer than 2.5 steps breaks the line. */
  step: number;
  /** A value on the scale. */
  format: (value: number) => string;
  hoverFormat?: ((value: number) => string) | undefined;
  /** The hover's heading for a time. */
  timeText?: ((t: number) => string) | undefined;
  /** What the chart shows, for screen readers. */
  label: string;
  /** Times along the foot, each with its label. */
  xLabels?: readonly { t: number; label: string }[] | undefined;
  /** Ticks along the foot for events, each set in its colour (one a line, say). */
  marks?: readonly ChartMarks[] | undefined;
  /** Stretches to shade behind the lines, each labelled at its start. */
  bands?: readonly ChartBand[] | undefined;
  /** Said in the plot when there's nothing worth drawing (e.g. no traffic). */
  empty?: string | undefined;
  /** The plot's height (default h-28). */
  className?: string | undefined;
  /** Lines only: no scale, grid or times (a glance). Hovering still reads the values. */
  bare?: boolean | undefined;
  /** Grows into the height its card has spare (its parent a flex column), at least the className's (default min-h-28). */
  fill?: boolean | undefined;
  /** Hovering (and the keyboard) reads the values; off for a glance that only decorates. */
  hover?: boolean | undefined;
  /** Shared with other charts of the same times, so hovering one shows the same moment in all. */
  cursor?: ChartCursorController<number, number> | undefined;
  /** Where the plot starts, px from the box's left (the scale's labels in that room), and it runs to the box's right edge: charts one above another, and HTML over them, line up. Default: as wide as the labels. */
  left?: number | undefined;
  /** A dashed line up from each labelled time. */
  xGrid?: boolean | undefined;
  /** Points above the scale (drawn at the top), each marked there with a ▲ in its colour. */
  cuts?: readonly { t: number; color: string }[] | undefined;
}): ReactElement {
  const { theme } = useTheme();
  const [box, height] = useHeight();
  const definition = useMemo(() => {
    const gap = step * 2.5;
    const rows = lines.map((l) => chartRows(l, from, to, max, gap, min));
    const dashOf = (l: ChartLine): string | undefined =>
      l.dashed === true
        ? '4 3'
        : seriesDash(
            l.color,
            lines.length,
            lines.some((x) => x.dashed === true),
            theme.chart.dash,
          );
    const named = new Map(xLabels.map((x) => [x.t, x.label]));
    const shown = bands.filter((b) => b.to > from && b.from < to);
    return defineChart({
      marks: [
        decorative(
          rect(shown, {
            x1: (b) => Math.max(b.from, from),
            x2: (b) => Math.min(b.to, to),
            y1: () => 0,
            y2: () => max,
            fill: 'var(--muted)',
          }),
        ),
        decorative(
          text(
            shown.filter((b) => b.label !== undefined),
            {
              x: (b) => Math.max(b.from, from),
              y: () => max,
              text: (b) => b.label ?? '',
              fill: 'var(--foreground)',
              fontSize: 12,
              dx: 6,
              dy: 10,
              anchor: 'start',
            },
          ),
        ),
        ...lines.flatMap((l, i) => {
          const data = rows[i] ?? [];
          const upper = l.upper === undefined ? undefined : new Map(l.upper);
          const dash = dashOf(l);
          return [
            ...(l.area === true
              ? [
                  decorative(
                    areaY(data, {
                      id: `area-${String(i)}`,
                      x: 't',
                      y1: 0,
                      y2: 'v',
                      fill: `url(#area-${String(i)})`,
                      fillOpacity: 1,
                    }),
                  ),
                ]
              : []),
            ...(upper === undefined
              ? []
              : [
                  decorative(
                    areaY(
                      data.map((r) => ({ ...r, u: upper.get(r.t) ?? null })),
                      { x: 't', y1: 'v', y2: 'u', fill: l.color, fillOpacity: 0.12 },
                    ),
                  ),
                ]),
            // each line its own group (`z`), so the hover reads every line at a time, not one of them
            lineY(data, {
              id: `line-${String(i)}`,
              x: 't',
              y: 'v',
              z: 'line',
              stroke: l.color,
              strokeWidth: 1.75,
              ...(dash === undefined ? {} : { strokeDasharray: dash }),
            }),
            whenFocused(dot(data, { x: 't', y: 'v', z: 'line', r: 4, fill: l.color, stroke: 'var(--card)', strokeWidth: 2 }), {
              match: 'x',
            }),
            // a time with a note but no value ("lost") is still there to hover: an unseen point at the foot
            ...(l.notes === undefined
              ? []
              : [
                  dot(
                    data.filter((r) => r.v === null && l.notes?.has(r.t) === true).map((r) => ({ ...r, at: min })),
                    { x: 't', y: 'at', z: 'line', r: 0, fillOpacity: 0 },
                  ),
                ]),
          ];
        }),
        ...(marks ?? []).map((m) =>
          decorative(
            link(
              m.times.filter((t) => t >= from && t <= to),
              {
                x1: (t) => t,
                x2: (t) => t,
                y1: () => 0,
                y2: () => max * 0.1,
                stroke: m.color,
                strokeWidth: 2,
                lineCap: 'butt',
              },
            ),
          ),
        ),
        decorative(
          text(
            cuts.filter((c) => c.t >= from && c.t <= to),
            { x: 't', y: () => max, text: () => '▲', fill: (c) => c.color, fontSize: 8, dy: -4, anchor: 'middle' },
          ),
        ),
        crosshair({ x: true, y: false }),
      ],
      scales: {
        x: {
          // an instance, not a factory: a factory's domain would follow the data
          scale: scaleLinear().domain([from, to]),
          axis:
            bare || xLabels.length === 0
              ? false
              : { ticks: { values: xLabels.map((x) => x.t), format: (t) => named.get(t) ?? '' } },
          grid: xGrid && !bare ? { strokeDasharray: '3 3', stroke: 'var(--chart-grid)', strokeOpacity: 1 } : false,
        },
        y: {
          scale: scaleLinear().domain([min, max]).clamp(true),
          grid: bare ? false : { strokeDasharray: '3 3', stroke: 'var(--chart-grid)', strokeOpacity: 1 },
          axis: bare ? false : { ticks: { values: ticks ?? [min, (min + max) / 2, max], format, size: 0 }, line: false },
        },
      },
      ...(bare ? { guides: false, margin: 0 } : left === undefined ? {} : { margin: { left, right: 0 } }),
      gradients: lines.map((l, i) => ({
        id: `area-${String(i)}`,
        y1: 0,
        y2: 1,
        stops: [
          { offset: 0, color: l.color, opacity: 0.2 },
          { offset: 1, color: l.color, opacity: 0 },
        ],
      })),
      theme: CHART_THEME,
      ...(hover ? {} : { pointer: false, keyboard: false }),
      focus: 'group-x',
      maxFocusDistance: Number.POSITIVE_INFINITY,
      focusRing: false,
      ...(cursor === undefined
        ? {}
        : { cursor: { use: cursorHost, controller: cursor, mode: 'focus' as const, match: 'x' as const } }),
      tooltip: hover && {
        use: tooltip,
        className: 'mf-chart-tooltip',
        sticky: false,
        placement: bare ? ['top', 'bottom'] : ['right', 'left'],
        ...(bare ? { use: tooltip, portal } : {}),
        content: (points) => ({
          title: timeText(points[0]?.xValue ?? from),
          rows: lines.map((l) => {
            const p = points.find((x) => x.datum.line === l.label);
            const v = p?.datum.v;
            const note = p === undefined ? undefined : l.notes?.get(p.datum.t);
            const value =
              v === null || v === undefined ? (note ?? '—') : `${hoverFormat(v)}${note === undefined ? '' : ` · ${note}`}`;
            return { label: l.label, value, color: l.color };
          }),
        }),
      },
    });
  }, [
    lines,
    from,
    to,
    min,
    max,
    ticks,
    step,
    format,
    hoverFormat,
    timeText,
    xLabels,
    marks,
    bands,
    bare,
    hover,
    cursor,
    left,
    xGrid,
    cuts,
    theme.chart.dash,
  ]);

  return (
    <div className={cn('relative min-w-0', fill ? 'min-h-28 flex-1' : 'h-28', className)} ref={box}>
      {height > 0 && <Chart definition={definition} height={height} ariaLabel={label} className="absolute inset-0" />}
      {empty !== undefined && (
        <p className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm text-muted-foreground">
          <span className="rounded-sm bg-card px-2 py-0.5">{empty}</span>
        </p>
      )}
    </div>
  );
}
