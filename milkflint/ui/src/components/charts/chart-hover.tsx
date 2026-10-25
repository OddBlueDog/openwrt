// Hovering (or tapping) a chart: a guide line at the nearest point, a dot on
// each series and a small card with the time and the values there. Laid
// over the chart's plot area, in the same 0..slots-1 coordinates.
import { type PointerEvent, type ReactElement, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export interface HoverSeries {
  label: string;
  color: string;
  /** As drawn: oldest first, right-aligned to the last slot. */
  values: readonly (number | undefined)[];
}

/** "14:30:05" within minutes, "14:30" within a day, "Tue 14:30" beyond. */
function formatTime(t: number, slotSeconds: number, spanSeconds: number): string {
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  if (slotSeconds < 60) opts.second = '2-digit';
  if (spanSeconds > 36 * 3600) opts.weekday = 'short';
  return new Date(t * 1000).toLocaleString(undefined, opts);
}

export function ChartHover({
  series,
  slots,
  max,
  format,
  timeOf,
  above = false,
}: {
  series: readonly HoverSeries[];
  slots: number;
  /** The top of the scale, as drawn. */
  max: number;
  format: (value: number) => string;
  /** Epoch seconds of a slot, for the card's heading. */
  timeOf?: ((slot: number) => number | undefined) | undefined;
  /** The card above the chart rather than over its top: for small charts at the foot of a card that clips. */
  above?: boolean;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  const [slot, setSlot] = useState<number>();

  const onPointer = (e: PointerEvent<HTMLDivElement>): void => {
    const r = ref.current?.getBoundingClientRect();
    if (r === undefined || r.width === 0) return;
    const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    setSlot(Math.round(f * (slots - 1)));
  };

  const rows =
    slot === undefined
      ? []
      : series.map((s) => {
          const i = slot - (slots - s.values.length);
          return { s, v: i >= 0 ? s.values[i] : undefined };
        });
  const shown = slot !== undefined && rows.some((r) => r.v !== undefined);
  const x = slot === undefined || slots <= 1 ? 100 : (slot / (slots - 1)) * 100;
  const t = slot === undefined ? undefined : timeOf?.(slot);
  // the step and span from the right, where the data is (it's right-aligned)
  const tEnd = timeOf?.(slots - 1);
  const tPrev = timeOf?.(slots - 2);
  const t0 = timeOf?.(0);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="absolute inset-0 touch-pan-y"
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={() => {
        setSlot(undefined);
      }}
    >
      {shown && (
        <>
          <div className="pointer-events-none absolute inset-y-0 w-px bg-foreground/30" style={{ left: `${String(x)}%` }} />
          {rows.map(
            ({ s, v }) =>
              v !== undefined && (
                <span
                  key={s.label}
                  className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background"
                  style={{ left: `${String(x)}%`, top: `${String(100 - (max > 0 ? Math.min(v / max, 1) : 0) * 100)}%`, background: s.color }}
                />
              ),
          )}
          <div
            className={cn(
              'pointer-events-none absolute z-10 flex min-w-36 flex-col gap-1 rounded-md border bg-popover px-2.5 py-2 text-xs whitespace-nowrap text-popover-foreground shadow-md',
              above ? 'bottom-full mb-1.5' : 'top-0',
            )}
            style={{ left: `${String(x)}%`, transform: x > 55 ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)' }}
          >
            {t !== undefined && (
              <span className="font-mono text-[10px] text-muted-foreground">
                {formatTime(t, tEnd !== undefined && tPrev !== undefined ? tEnd - tPrev : 60, t0 !== undefined && tEnd !== undefined ? tEnd - t0 : 0)}
              </span>
            )}
            {rows.map(({ s, v }) => (
              <span key={s.label} className="flex items-center gap-2">
                <span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} />
                <span className="text-muted-foreground">{s.label}</span>
                <span className="ml-auto pl-3 font-medium tabular">{v === undefined ? '—' : format(v)}</span>
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
