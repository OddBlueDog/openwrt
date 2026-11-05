// A latency chart with its table: clock times along the bottom, a band up to
// the worst answer where a point stands for several probes, red marks where
// probes were lost, grey where nothing was recorded. The table under it is
// also the legend: a name shows or hides a line, and the scale follows.
import { DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { type PointerEvent, type ReactElement, useEffect, useRef, useState } from 'react';
import { ChartHover } from '@/components/charts/chart-hover';
import { Button } from '@/components/ui/button';
import { cn, errorMessage } from '@/lib/utils';
import { type ChartLine, formatLoss, formatSliceTime, type LineStats, lineStats, lossBins, lossSliceAt, niceScale, pointStep, runs, slotValues, timeTicks, unrecorded } from './chart-data';

function linePaths(line: ChartLine, start: number, end: number, max: number): { line: string; band: string } {
  const x = (t: number): string => (((t - start) / (end - start)) * 100).toFixed(2);
  const y = (v: number): string => (100 - Math.min(v / max, 1) * 100).toFixed(2);
  let d = '';
  let band = '';
  for (const run of runs(line.points)) {
    d += `${run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)} ${y(p.v)}`).join(' ')} `;
    if (run.some((p) => p.worst !== undefined && p.worst > p.v)) {
      const top = run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t)} ${y(p.worst ?? p.v)}`).join(' ');
      const back = [...run].reverse().map((p) => `L${x(p.t)} ${y(p.v)}`).join(' ');
      band += `${top} ${back} Z `;
    }
  }
  return { line: d.trim(), band: band.trim() };
}

/** Red marks where probes got no answer; hovering (or tapping) says when, how many and on which line. */
function LossStrip({ lines, start, end }: { lines: readonly ChartLine[]; start: number; end: number }): ReactElement {
  const [fraction, setFraction] = useState<number>();
  const onPointer = (e: PointerEvent<HTMLDivElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width > 0) setFraction(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const span = end - start;
  const xPct = (t: number): number => ((t - start) / span) * 100;
  const bins = lossBins(lines, start, end);
  const slice = fraction === undefined ? undefined : lossSliceAt(lines, start, end, fraction);
  const x = fraction === undefined ? 0 : fraction * 100;
  // a tap keeps the card up to read: until a tap elsewhere
  const target = useRef<HTMLDivElement>(null);
  const open = fraction !== undefined;
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: globalThis.PointerEvent): void => {
      if (!(e.target instanceof Node && target.current?.contains(e.target) === true)) setFraction(undefined);
    };
    document.addEventListener('pointerdown', away);
    return () => {
      document.removeEventListener('pointerdown', away);
    };
  }, [open]);
  return (
    <div
      className="relative mt-1.5 h-1.5 rounded-sm bg-muted/60"
      data-testid="loss-strip"
      role="img"
      aria-label={bins.length === 0 ? 'No probes lost' : `Probes lost at ${String(bins.length)} points in this span; the table has each line's share`}
    >
      <span className="absolute top-1/2 right-full -translate-y-1/2 pr-2 font-mono text-[10px] text-muted-foreground">lost</span>
      {bins.map((b) => (
        <div
          key={b.from}
          className="absolute inset-y-0 min-w-px bg-destructive"
          style={{ left: `${String(xPct(b.from))}%`, width: `${String(xPct(b.to) - xPct(b.from))}%`, opacity: 0.45 + 0.55 * b.share }}
        />
      ))}
      {slice !== undefined && (
        <>
          <div
            className="pointer-events-none absolute -inset-y-0.5 min-w-0.5 rounded-sm bg-foreground/40"
            style={{ left: `${String(xPct(slice.from))}%`, width: `${String(xPct(slice.to) - xPct(slice.from))}%` }}
          />
          <div
            data-testid="loss-card"
            className="pointer-events-none absolute bottom-full z-20 mb-2 flex w-[min(15rem,100%)] flex-col gap-1 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
            // centred on the pointer, kept within the strip so it stays on a phone's screen
            style={{ left: `clamp(0px, calc(${String(x)}% - 7.5rem), calc(100% - min(15rem, 100%)))` }}
          >
            <span className="font-mono text-[10px] text-muted-foreground">{formatSliceTime(slice.from, slice.to, span)}</span>
            {slice.lines.length === 0 ? (
              <span className="font-medium">{slice.rounds === 0 ? 'Nothing measured' : 'Every probe answered'}</span>
            ) : (
              slice.lines.map((l) => (
                <span key={l.label} className="flex items-center gap-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ background: l.color }} />
                  <span className="min-w-0 truncate text-muted-foreground">{l.label}</span>
                  <span className="ml-auto shrink-0 pl-2 font-medium whitespace-nowrap tabular">
                    {String(l.lost)} of {String(l.rounds)} lost
                  </span>
                </span>
              ))
            )}
            <span className="border-t pt-1 text-[11px] text-muted-foreground">
              Red marks are probes that got no answer; a darker mark means a bigger share of them. A mark can be a single lost probe, not an outage.
            </span>
          </div>
        </>
      )}
      {/* easier to find than the thin strip itself */}
      <div
        ref={target}
        className="absolute -inset-y-1.5 inset-x-0 touch-pan-y"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') setFraction(undefined);
        }}
      />
    </div>
  );
}

function Plot({
  label,
  lines,
  allLines,
  start,
  end,
  spanLabel,
  minMax,
  format,
  hoverFormat,
}: {
  label: string;
  /** The lines shown, which set the scale. */
  lines: readonly ChartLine[];
  /** Every line, for what was recorded. */
  allLines: readonly ChartLine[];
  start: number;
  end: number;
  spanLabel: string;
  minMax: number;
  format: (v: number) => string;
  hoverFormat: (v: number) => string;
}): ReactElement {
  const peak = Math.max(0, ...lines.flatMap((l) => l.points.flatMap((p) => (p.v === undefined ? [] : [p.v]))));
  const { max, ticks } = niceScale(peak, minMax);
  const xPct = (t: number): number => ((t - start) / (end - start)) * 100;

  const steps = lines.filter((l) => l.points.length > 1).map((l) => pointStep(l.points));
  const step = Math.max(1, Math.min(...steps, 900));
  const slots = Math.round((end - start) / step) + 1;
  const hover = lines.map((l) => ({ label: l.label, color: l.color, ...slotValues(l, start, step, slots, hoverFormat) }));

  return (
    <div className="flex flex-col gap-1.5 pl-12" data-testid="latency-plot">
      <div className="relative mt-2 h-52">
        {/* nothing recorded */}
        {unrecorded(allLines, start, end).map((g) => (
          <div
            key={g.from}
            className="absolute inset-y-0 bg-muted/70"
            style={{ left: `${String(xPct(g.from))}%`, width: `${String(xPct(g.to) - xPct(g.from))}%` }}
          />
        ))}
        {/* the scale */}
        {ticks.map((v) => (
          <div key={v} className="pointer-events-none absolute inset-x-0" style={{ top: `${String(100 - (v / max) * 100)}%` }}>
            <span className="absolute right-full w-12 -translate-y-1/2 pr-2 text-right font-mono text-[10px] text-muted-foreground tabular">{format(v)}</span>
            <div className={cn('h-px border-t', v === 0 ? 'border-border' : 'border-dashed border-border/70')} />
          </div>
        ))}
        {/* clock marks */}
        {timeTicks(start, end).map((tick) => (
          <div key={tick.t} className="pointer-events-none absolute inset-y-0 w-px border-l border-dashed border-border/50" style={{ left: `${String(xPct(tick.t))}%` }} />
        ))}
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${label} over the last ${spanLabel}`}
          className="absolute inset-0 size-full overflow-visible"
        >
          {lines.map((l) => {
            const p = linePaths(l, start, end, max);
            return (
              <g key={l.key}>
                {p.band !== '' && <path d={p.band} fill={l.color} fillOpacity="0.12" />}
                <path d={p.line} fill="none" stroke={l.color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
              </g>
            );
          })}
        </svg>
        <div className="absolute inset-0">
          <ChartHover series={hover} slots={slots} max={max} format={hoverFormat} timeOf={(slot) => start + slot * step} />
        </div>
      </div>
      <LossStrip lines={lines} start={start} end={end} />
      <div className="relative h-3.5 font-mono text-[10px] text-muted-foreground">
        {timeTicks(start, end).map((tick) => (
          <span key={tick.t} className="absolute -translate-x-1/2 tabular" style={{ left: `${String(xPct(tick.t))}%` }}>
            {tick.label}
          </span>
        ))}
        <span className="absolute right-0">now</span>
      </div>
    </div>
  );
}

function Value({ v, format, className }: { v: number | undefined; format: (v: number) => string; className?: string }): ReactElement {
  return <td className={cn('py-1.5 pl-2 text-right whitespace-nowrap tabular sm:pl-3', className)}>{v === undefined ? '—' : format(v)}</td>;
}

function StatsRow({
  line,
  stats,
  hidden,
  onToggle,
  format,
}: {
  line: ChartLine;
  stats: LineStats;
  hidden: boolean;
  onToggle: () => void;
  format: (v: number) => string;
}): ReactElement {
  return (
    <tr className={cn('border-t', hidden && 'text-muted-foreground')}>
      <td className="max-w-0 py-1 pr-2">
        <button
          type="button"
          aria-pressed={!hidden}
          title={hidden ? `Show ${line.label}` : `Hide ${line.label}`}
          className="flex w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggle}
        >
          <span className="size-2.5 shrink-0 rounded-full border-2" style={{ borderColor: line.color, background: hidden ? 'transparent' : line.color }} />
          <span className={cn('min-w-0 font-medium sm:truncate', hidden && 'font-normal line-through')}>{line.label}</span>
          {line.detail !== undefined && <span className="hidden truncate font-mono text-[11px] font-normal text-muted-foreground lg:inline">{line.detail}</span>}
        </button>
      </td>
      {stats.now === null ? <td className="py-1.5 pl-2 text-right whitespace-nowrap text-destructive sm:pl-3">{line.countLoss ? 'lost' : '—'}</td> : <Value v={stats.now} format={format} className="font-medium" />}
      <Value v={stats.typical} format={format} />
      <Value v={stats.best} format={format} className="hidden sm:table-cell" />
      <Value v={stats.worst} format={format} />
      <td className={cn('py-1.5 pl-2 text-right whitespace-nowrap tabular sm:pl-3', line.countLoss && stats.loss > 0 && 'text-warning')}>{line.countLoss ? formatLoss(stats.loss) : '—'}</td>
    </tr>
  );
}

function saveText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Saves a CSV; `csv` may have to fetch it first. */
function DownloadButton({ csv }: { csv: () => Promise<{ name: string; text: string }> }): ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const { name, text } = await csv();
      saveText(name, text);
      setError(undefined);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {error !== undefined && <span className="text-xs text-destructive">{error}</span>}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save()}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <DownloadIcon />}
        Download CSV
      </Button>
    </div>
  );
}

export function LatencyChart({
  label,
  lines,
  start,
  end,
  spanLabel,
  minMax = 25,
  format,
  hoverFormat,
  csv,
}: {
  label: string;
  lines: readonly ChartLine[];
  start: number;
  end: number;
  spanLabel: string;
  minMax?: number;
  /** The scale's labels. */
  format: (v: number) => string;
  /** Values when hovering and in the table. */
  hoverFormat: (v: number) => string;
  csv: () => Promise<{ name: string; text: string }>;
}): ReactElement {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = lines.filter((l) => !hidden.has(l.key));
  const toggle = (key: string): void => {
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <Plot label={label} lines={shown} allLines={lines} start={start} end={end} spanLabel={spanLabel} minMax={minMax} format={format} hoverFormat={hoverFormat} />
      <table className="w-full table-fixed text-xs sm:text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="w-[31%] py-1.5 text-left font-normal sm:w-auto">
              Last {spanLabel}
            </th>
            <th scope="col" className="w-[17%] py-1.5 pl-2 text-right font-normal sm:pl-3 sm:w-[4.75rem]">Now</th>
            <th scope="col" className="w-[18%] py-1.5 pl-2 text-right font-normal sm:pl-3 sm:w-[4.75rem]" title="The median">Typical</th>
            <th scope="col" className="hidden py-1.5 pl-2 text-right font-normal sm:table-cell sm:pl-3 sm:w-[4.75rem]" title="The fastest answer">Best</th>
            <th scope="col" className="w-[17%] py-1.5 pl-2 text-right font-normal sm:pl-3 sm:w-[4.75rem]" title="95th percentile">Worst</th>
            <th scope="col" className="w-[17%] py-1.5 pl-2 text-right font-normal sm:pl-3 sm:w-[4.75rem]" title="Probes without an answer">Lost</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <StatsRow
              key={l.key}
              line={l}
              stats={lineStats(l)}
              hidden={hidden.has(l.key)}
              format={hoverFormat}
              onToggle={() => {
                toggle(l.key);
              }}
            />
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
          Select a name to hide its line and rescale the chart. Hover over or tap the “lost” strip to see what was lost when; grey is time with nothing recorded.
        </p>
        <DownloadButton csv={csv} />
      </div>
    </div>
  );
}
