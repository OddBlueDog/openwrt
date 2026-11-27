// A latency chart with its table: clock times along the bottom, a band up to
// the worst answer where a point stands for several probes, red marks where
// probes were lost, grey where nothing was recorded. The table under it is
// also the legend: a name shows or hides a line, and the scale fits the
// lines left, from their lowest to their highest typical time, short of a
// spike far above a line's typical (drawn at the top, marked and said).
import { ChevronUpIcon, DownloadIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { type BarPart, BarChart } from '@/components/charts/bar-chart';
import type { TimePoint } from '@/components/charts/time-axis';
import { type ChartLine as TimeLine, TimeChart } from '@/components/charts/time-chart';
import type { ChartTooltipContent } from '@tanstack/charts';
import { type Column, DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import {
  type ChartLine,
  chartScale,
  formatLoss,
  formatSliceTime,
  type LineStats,
  lineStats,
  lossBins,
  LOSS_BINS,
  lossSliceAt,
  offScale,
  pointStep,
  slotValues,
  timeTicks,
  unrecorded,
} from './chart-data';
import { seriesDash } from '@/components/charts/series';
import { SeriesSwatch } from '@/components/charts/series-swatch';
import { useTheme } from '@/lib/theme';

/**
 * Red marks where probes got no answer: a slice of the span each, darker the
 * bigger its share lost. Hovering (or tapping) a slice says when, how many
 * and on which line.
 */
function LossStrip({ lines, start, end }: { lines: readonly ChartLine[]; start: number; end: number }): ReactElement {
  const span = end - start;
  const bins = useMemo(() => lossBins(lines, start, end), [lines, start, end]);
  const bars = useMemo(() => {
    const out: BarPart[][] = Array.from({ length: LOSS_BINS }, () => []);
    for (const b of bins) {
      const at = Math.round(((b.from - start) / span) * LOSS_BINS);
      out[at] = [
        { value: 1, color: `color-mix(in oklab, var(--destructive) ${String(Math.round(45 + 55 * b.share))}%, transparent)` },
      ];
    }
    return out;
  }, [bins, start, span]);
  const card = useCallback(
    (at: number): ChartTooltipContent => {
      const slice = lossSliceAt(lines, start, end, (at + 0.5) / LOSS_BINS);
      return {
        title: formatSliceTime(slice.from, slice.to, span),
        rows: [
          ...(slice.lines.length === 0
            ? [{ label: slice.rounds === 0 ? 'Nothing measured' : 'Every probe answered', value: '' }]
            : slice.lines.map((l) => ({
                label: l.label,
                value: `${String(l.lost)} of ${String(l.rounds)} lost`,
                color: l.color,
              }))),
          { label: 'A darker mark is a bigger share lost; one mark can be a single probe, not an outage.', value: '' },
        ],
      };
    },
    [lines, start, end, span],
  );
  return (
    <div className="relative mt-1.5 rounded-sm bg-muted/60">
      <span className="absolute top-1/2 right-full -translate-y-1/2 pr-2 text-xs text-muted-foreground">lost</span>
      <BarChart
        bars={bars}
        max={1}
        gap={0}
        cursor="line"
        card={card}
        label={
          bins.length === 0
            ? 'No probes lost'
            : `Probes lost at ${String(bins.length)} points in this span; the table has each line's share`
        }
        className="h-2"
      />
    </div>
  );
}

/** Room for the scale's labels: the plot, the loss strip and the times line up after it. */
const PLOT_LEFT = 56;

function Plot({
  label,
  lines,
  allLines,
  start,
  end,
  spanLabel,
  minSpan,
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
  minSpan: number;
  format: (v: number) => string;
  hoverFormat: (v: number) => string;
}): ReactElement {
  // the typical times set the scale, short of a spike far above a line's
  // typical; a worst answer far above them is cut off at the top
  const { min, max, ticks, above } = chartScale(lines, minSpan);
  const steps = lines.filter((l) => l.points.length > 1).map((l) => pointStep(l.points));
  const step = Math.max(1, Math.min(...steps, 900));
  // every line on one grid of slots, so hovering reads them all at a time
  const shown = useMemo(() => {
    const slots = Math.round((end - start) / step) + 1;
    const at = (i: number): number => start + i * step;
    return lines.map((l): TimeLine => {
      const s = slotValues(l, start, step, slots, hoverFormat);
      return {
        label: l.label,
        color: l.color,
        points: s.values.map((v, i): TimePoint => [at(i), v ?? null]),
        upper: s.upper.flatMap((u, i): TimePoint[] => (u === undefined ? [] : [[at(i), u]])),
        notes: new Map(s.notes.flatMap((n, i): [number, string][] => (n === undefined ? [] : [[at(i), n]]))),
      };
    });
  }, [lines, start, end, step, hoverFormat]);
  const xLabels = useMemo(() => [...timeTicks(start, end), { t: end, label: 'now' }], [start, end]);
  const bands = useMemo(() => unrecorded(allLines, start, end), [allLines, start, end]);
  // one mark per slice of the span for a line's points above the top, not one each
  const cuts = useMemo(() => offScale(lines, start, end, max), [lines, start, end, max]);

  return (
    <div className="flex flex-col gap-1.5">
      <TimeChart
        lines={shown}
        from={start}
        to={end}
        min={min}
        max={max}
        ticks={ticks}
        step={step}
        format={format}
        hoverFormat={hoverFormat}
        label={`${label} over the last ${spanLabel}`}
        xLabels={xLabels}
        xGrid
        cuts={cuts}
        bands={bands}
        left={PLOT_LEFT}
        className="mt-3 h-58"
      />
      <div style={{ paddingLeft: PLOT_LEFT }}>
        <LossStrip lines={lines} start={start} end={end} />
      </div>
      {above !== undefined && (
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <ChevronUpIcon aria-hidden="true" strokeWidth={3} className="mt-0.5 size-3 shrink-0" />
          <span>
            The scale stops at {format(max)}: {above.count === 1 ? 'one point is' : `${formatNumber(above.count)} points are`}{' '}
            above it, marked at the top; the highest was {hoverFormat(above.highest)}.
          </span>
        </p>
      )}
    </div>
  );
}

/** A line's row in the table: its stats, its key's dash, and whether it's hidden. */
interface StatsRow {
  line: ChartLine;
  stats: LineStats;
  /** the line's dash, where the theme dashes lines drawn together: the key shows it */
  dash: string | undefined;
  off: boolean;
}

// narrow, the figures share the width; from sm, the name takes what the figures leave
const FIGURE = 'py-1.5 pr-0 pl-2 text-right whitespace-nowrap tabular sm:w-[4.75rem] sm:pl-3';
const figure = (v: number | undefined, format: (v: number) => string, className?: string): ReactElement => (
  <span className={cn('text-xs sm:text-sm', className)}>{v === undefined ? '—' : format(v)}</span>
);

/** The table under the chart, which is also its legend: a name shows or hides its line. */
function StatsTable({
  lines,
  hidden,
  dashing,
  spanLabel,
  format,
  onToggle,
}: {
  lines: readonly ChartLine[];
  hidden: ReadonlySet<string>;
  /** a chart the theme dashes keys every line as a line (solid ones too), so the keys read alike */
  dashing: boolean;
  spanLabel: string;
  format: (v: number) => string;
  onToggle: (key: string) => void;
}): ReactElement {
  const rows = useMemo(
    () =>
      lines.map((line): StatsRow => ({
        line,
        stats: lineStats(line),
        dash: dashing ? (seriesDash(line.color, lines.length) ?? 'none') : undefined,
        off: hidden.has(line.key),
      })),
    [lines, dashing, hidden],
  );
  const columns = useMemo(
    (): Column<StatsRow>[] => [
      {
        label: `Last ${spanLabel}`,
        // the name truncates rather than push the figures out
        className: 'w-[31%] max-w-0 py-1 pr-2 pl-0 sm:w-auto',
        cell: ({ line, dash, off }) => (
          <button
            type="button"
            aria-pressed={!off}
            title={off ? `Show ${line.label}` : `Hide ${line.label}`}
            className="flex w-full min-w-0 items-center gap-2 rounded-sm py-0.5 text-left text-xs outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
            onClick={() => {
              onToggle(line.key);
            }}
          >
            {dash === undefined ? (
              <span
                className="size-2.5 shrink-0 rounded-full border-2"
                style={{ borderColor: line.color, background: off ? 'transparent' : line.color }}
              />
            ) : (
              <SeriesSwatch color={line.color} dash={dash} className={cn(off && 'opacity-40')} />
            )}
            <span className={cn('min-w-0 font-medium sm:truncate', off && 'font-normal line-through')}>{line.label}</span>
            {line.detail !== undefined && (
              <span className="hidden truncate font-mono text-xs font-normal text-muted-foreground lg:inline">{line.detail}</span>
            )}
          </button>
        ),
      },
      {
        label: 'Now',
        className: cn(FIGURE, 'w-[17%]'),
        cell: ({ line, stats }) =>
          stats.now === null ? (
            <span className="text-xs text-destructive sm:text-sm">{line.countLoss ? 'lost' : '—'}</span>
          ) : (
            figure(stats.now, format, 'font-medium')
          ),
      },
      {
        label: 'Typical',
        title: 'The median',
        className: cn(FIGURE, 'w-[18%]'),
        cell: ({ stats }) => figure(stats.typical, format),
      },
      {
        label: 'Best',
        title: 'The fastest answer',
        className: cn(FIGURE, 'hidden sm:table-cell'),
        cell: ({ stats }) => figure(stats.best, format),
      },
      {
        label: 'Worst',
        title: '95th percentile',
        className: cn(FIGURE, 'w-[17%]'),
        cell: ({ stats }) => figure(stats.worst, format),
      },
      {
        label: 'Lost',
        title: 'Probes without an answer',
        className: cn(FIGURE, 'w-[17%]'),
        cell: ({ line, stats }) => (
          <span className={cn('text-xs sm:text-sm', line.countLoss && stats.loss > 0 && 'text-warning')}>
            {line.countLoss ? formatLoss(stats.loss) : '—'}
          </span>
        ),
      },
    ],
    [spanLabel, format, onToggle],
  );
  return (
    <DataTable
      label={`Each line over the last ${spanLabel}`}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.line.key}
      empty="No lines."
      framed={false}
      cards={false}
      rowProps={(r) => ({ className: cn(r.off && 'text-muted-foreground') })}
    />
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
  minSpan = 5,
  format,
  hoverFormat,
  csv,
}: {
  label: string;
  lines: readonly ChartLine[];
  start: number;
  end: number;
  spanLabel: string;
  /** The narrowest the scale gets, in the values' unit. */
  minSpan?: number;
  /** The scale's labels. */
  format: (v: number) => string;
  /** Values when hovering and in the table. */
  hoverFormat: (v: number) => string;
  csv: () => Promise<{ name: string; text: string }>;
}): ReactElement {
  // the keys show a line only for series the theme dashes; otherwise the round dot as always
  const dashes = useTheme().theme.chart.dash;
  // a chart the theme dashes keys every line as a line (solid ones too), so the keys read alike
  const dashing = lines.some((l) => seriesDash(l.color, lines.length, false, dashes) !== undefined);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = lines.filter((l) => !hidden.has(l.key));
  const toggle = useCallback((key: string): void => {
    setHidden((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  return (
    <div className="flex flex-col gap-3">
      <Plot
        label={label}
        lines={shown}
        allLines={lines}
        start={start}
        end={end}
        spanLabel={spanLabel}
        minSpan={minSpan}
        format={format}
        hoverFormat={hoverFormat}
      />
      <StatsTable lines={lines} hidden={hidden} dashing={dashing} spanLabel={spanLabel} format={hoverFormat} onToggle={toggle} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 flex-1 basis-64 text-xs text-muted-foreground">
          The scale fits the lines shown, so it may not start at 0. Select a name to hide its line and the scale fits the rest.
          Hover over or tap the “lost” strip to see what was lost when; grey is time with nothing recorded.
        </p>
        <DownloadButton csv={csv} />
      </div>
    </div>
  );
}
