// What the charts over time (time-chart.tsx and the charts beside them)
// share: their points, where a plot starts when charts one above another
// line up, the clock for their hovers, and a line's rows as drawn.

/** Where a plot starts, px from its chart's left, when charts (and HTML) one above another line up: 5.5rem. */
export const PLOT_LEFT = 88;

export type TimePoint = readonly [number, number | null];

export interface ChartRow {
  t: number;
  v: number | null;
  line: string;
}

/** "14:30:05" within three hours, "14:30" beyond: epoch seconds. */
export function clockText(t: number, seconds: boolean): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  });
}

/**
 * A line's rows as drawn: within [from, to], clamped to [0, max], and a null
 * wherever the recording has a gap longer than `gap` (so the line breaks).
 */
export function chartRows(
  l: { label: string; points: readonly TimePoint[] },
  from: number,
  to: number,
  max: number,
  gap: number,
  min = 0,
): ChartRow[] {
  const out: ChartRow[] = [];
  let last: number | undefined;
  for (const [t, v] of l.points) {
    if (t < from || t > to) continue;
    if (last !== undefined && t - last > gap) out.push({ t: (t + last) / 2, v: null, line: l.label });
    out.push({ t, v: v === null ? null : Math.min(Math.max(v, min), max), line: l.label });
    last = t;
  }
  return out;
}
