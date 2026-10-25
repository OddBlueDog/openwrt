import { type ReactElement, useId } from 'react';
import { cn } from '@/lib/utils';
import { ChartHover } from './chart-hover';
import { paths, toPoints } from './path';

/**
 * A small filled line of recent values, e.g. CPU use over the last minutes.
 * With `format` (and `label`), hovering it shows the value there.
 */
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
  const id = useId();
  const { line, area } = paths(toPoints(values, max, slots));
  const svg = (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" className={cn('h-10 w-full', format !== undefined && 'h-full', format === undefined && className)}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
  if (format === undefined) return svg;
  return (
    <div className={cn('relative h-10 w-full', className)}>
      {svg}
      <ChartHover series={[{ label: label ?? '', color, values }]} slots={slots} max={max} format={format} timeOf={timeOf} above />
    </div>
  );
}
