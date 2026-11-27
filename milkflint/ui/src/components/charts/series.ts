// A chart line's dash from the theme (theme.chart.dash, written as
// --mf-chart-N-dash): so lines drawn together can be told apart by more than
// colour. Only where it helps: a line alone stays solid, and a chart that
// already gives dashes a meaning of its own (peak against average, say)
// keeps it.
import type { ChartTokens } from '@/theme/contract';

const SERIES = /^var\(--chart-([1-6])\)$/;

/**
 * The stroke-dasharray for a line drawn in `color`, when `together` series
 * share its chart and the chart doesn't use dashes itself; else undefined
 * (solid). Without the theme's `dashes`, the CSS variable, to apply as
 * style={{ strokeDasharray }} (it doesn't work in the SVG attribute); with
 * them, the dash itself, for a chart that writes the attribute (TanStack
 * Charts), and undefined for a series the theme draws solid, so a key looks
 * as it always has.
 */
export function seriesDash(color: string, together: number, ownDashes = false, dashes?: ChartTokens['dash']): string | undefined {
  if (together < 2 || ownDashes) return undefined;
  const n = SERIES.exec(color)?.[1];
  if (n === undefined) return undefined;
  if (dashes === undefined) return `var(--mf-chart-${n}-dash)`;
  const dash = dashes[Number(n) as keyof ChartTokens['dash']];
  return dash === 'none' ? undefined : dash;
}
