import { type ReactElement, useId } from 'react';
import { formatBitrate } from '@/lib/format';
import { ChartHover } from './chart-hover';
import { niceCeil, paths, toPoints } from './path';

export interface Series {
  label: string;
  color: string;
  values: readonly (number | undefined)[];
}

/** Series over time sharing one scale (by default bit/s, as for throughput). */
export function ThroughputChart({
  series,
  slots,
  spanLabel,
  format = formatBitrate,
  label = 'Throughput',
  minMax = 0,
  timeOf,
  hoverFormat = format,
}: {
  series: readonly Series[];
  slots: number;
  spanLabel: string;
  format?: (value: number) => string;
  label?: string;
  /** The scale never goes below this, so quiet periods don't look busy. */
  minMax?: number;
  /** Epoch seconds of a slot, shown when hovering it. */
  timeOf?: ((slot: number) => number | undefined) | undefined;
  /** A value when hovering (default `format`), e.g. with more decimals than the scale. */
  hoverFormat?: (value: number) => string;
}): ReactElement {
  const id = useId();
  const peak = Math.max(0, ...series.flatMap((s) => s.values.filter((v): v is number => v !== undefined)));
  const max = niceCeil(Math.max(peak * 1.1, minMax));

  return (
    <div className="flex flex-col gap-2">
      <div className="relative h-52">
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between">
          {[max, max / 2, 0].map((v) => (
            <div key={v} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-right font-mono text-[10px] text-muted-foreground tabular">
                {format(v)}
              </span>
              <div className="h-px flex-1 border-t border-dashed border-border" />
            </div>
          ))}
        </div>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} over the last ${spanLabel}`}
          className="absolute inset-y-[7px] right-0 left-[5.5rem] h-[calc(100%-14px)] w-[calc(100%-5.5rem)]"
        >
          <defs>
            {series.map((s, i) => (
              <linearGradient key={s.label} id={`${id}-${String(i)}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {series.map((s, i) => {
            const { line, area } = paths(toPoints(s.values, max, slots));
            return (
              <g key={s.label}>
                <path d={area} fill={`url(#${id}-${String(i)})`} />
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-y-[7px] right-0 left-[5.5rem]">
          <ChartHover series={series} slots={slots} max={max} format={hoverFormat} timeOf={timeOf} />
        </div>
      </div>
      <div className="flex justify-between pl-[5.5rem] font-mono text-[10px] text-muted-foreground">
        <span>{spanLabel} ago</span>
        <span>now</span>
      </div>
    </div>
  );
}
