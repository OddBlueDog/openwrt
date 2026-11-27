// A small filled line of recent values, e.g. CPU use over the last minutes:
// TimeChart at a glance (no scale or times), its values right-aligned in
// `slots`. With `format` (and `label`), hovering it shows the value there,
// in a card above it.
import type { ReactElement } from 'react';
import { clockText, type TimePoint } from './time-axis';
import { TimeChart } from './time-chart';

export function Sparkline({
  values,
  max,
  slots,
  color = 'var(--chart-1)',
  className,
  label,
  format,
  timeOf,
}: {
  values: readonly (number | undefined)[];
  max: number;
  slots: number;
  color?: string | undefined;
  className?: string | undefined;
  label?: string | undefined;
  /** A drawn value as shown when hovering. */
  format?: ((value: number) => string) | undefined;
  /** Epoch seconds of a slot, shown when hovering it. */
  timeOf?: ((slot: number) => number | undefined) | undefined;
}): ReactElement {
  const offset = slots - values.length;
  // a slot's own number when no time is known (or a slot has none)
  const at = (slot: number): number => (timeOf === undefined ? slot : (timeOf(slot) ?? slot));
  const points: TimePoint[] = values.map((v, i) => [at(offset + i), v ?? null]);
  const from = at(0);
  const to = at(slots - 1);
  const step = slots > 1 ? (to - from) / (slots - 1) : 1;
  return (
    <TimeChart
      lines={[{ label: label ?? '', color, points, area: true }]}
      from={from}
      to={Math.max(to, from + 1)}
      max={max}
      step={step}
      format={format ?? String}
      timeText={timeOf === undefined ? () => '' : (t) => clockText(t, step < 60)}
      label={label ?? ''}
      className={className ?? 'h-10 w-full'}
      bare
      hover={format !== undefined}
    />
  );
}
