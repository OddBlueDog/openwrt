import { createChartCursor } from '@tanstack/charts/cursor';
import { type ComponentProps, type ReactElement, useMemo, useState } from 'react';
import { niceCeil } from '@/components/charts/scale';
import { seriesDash } from '@/components/charts/series';
import { SeriesSwatch } from '@/components/charts/series-swatch';
import { PLOT_LEFT } from '@/components/charts/time-axis';
import { type ChartBand, type ChartLine, type ChartMarks, TimeChart } from '@/components/charts/time-chart';
import { Button } from '@/components/ui/button';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { memberRtts, routerRtts } from './analysis';
import { Arrowed } from '@/components/dir';
import { CoresChart } from './cores-chart';
import { phaseName } from './phase-names';
import { clockText, phaseStyle } from './phases';
import { memberPeerRtts } from './pairs';
import { reportRun, type RunData } from './run-data';
import {
  cakeSeconds,
  cpuRows,
  GRID_MS,
  ifRate,
  memberColor,
  memberRate,
  onGrid,
  peerRate,
  routerSeries,
  softnetRate,
  stationSamples,
  type TPoint,
  wanPort,
  worstEachSecond,
} from './timelines';

const msText = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)} ms`;
const mbit = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)} Mbit/s`;
const perSecond = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)}/s`;
const kb = (v: number): string => `${formatNumber(v / 1024, v < 10240 ? 1 : 0)} KB`;

function Picker<K extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: K;
  options: readonly { key: K; label: string }[];
  onChange: (k: K) => void;
  label: string;
}): ReactElement {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit flex-wrap gap-0.5 rounded-md border p-0.5">
      {options.map((o) => (
        <Button
          key={o.key}
          type="button"
          size="sm"
          variant={value === o.key ? 'secondary' : 'ghost'}
          className="h-7 px-3"
          aria-pressed={value === o.key}
          onClick={() => {
            onChange(o.key);
          }}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

function Chart({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint?: string;
  action?: ReactElement | false;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          {hint !== undefined && <span className="text-xs text-muted-foreground">{hint}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** A chart's keys under it, lined up with its plot; a dashed line's paler, as it means something else. */
function Keys({ lines }: { lines: readonly ChartLine[] }): ReactElement {
  // a chart that dashes some lines to say something (peak against average) keeps its own dashes
  const ownDashes = lines.some((l) => l.dashed === true);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground" style={{ paddingLeft: PLOT_LEFT }}>
      {lines.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          <SeriesSwatch
            color={l.color}
            dash={l.dashed === true ? '4 3' : seriesDash(l.color, lines.length, ownDashes)}
            className={cn(l.dashed === true && 'opacity-60')}
          />
          {l.label}
        </span>
      ))}
    </div>
  );
}

/** One of the report's charts, its keys under it; the scale's top a round number over the peak, never under `minMax` (so quiet periods don't look busy) unless `max` fixes it (a share: 1). */
function Timeline({
  max,
  minMax,
  className = 'h-36',
  ...chart
}: Omit<ComponentProps<typeof TimeChart>, 'max'> & { max?: number | undefined; minMax: number }): ReactElement {
  const peak = chart.lines.reduce((m, l) => l.points.reduce((n, p) => (p[1] === null ? n : Math.max(n, p[1])), m), 0);
  return (
    <div className="flex flex-col gap-1.5">
      <TimeChart {...chart} max={max ?? niceCeil(Math.max(peak * 1.1, minMax))} className={className} />
      <Keys lines={chart.lines} />
    </div>
  );
}

const hasData = (l: ChartLine): boolean => l.points.some((p) => p[1] !== null && p[1] > 0);
/** A latency line, and when its probes got no answer. */
type Series = ChartLine & { marks: readonly number[] };
function pts<T extends { t: number }>(xs: readonly T[], pick: (x: T) => number | null | undefined): TPoint[] {
  return xs.map((x) => [x.t, pick(x) ?? null]);
}

type LatencyView = 'router' | 'internet' | 'ping' | 'peers';
type WifiView = 'rate' | 'retries' | 'aql';

/** The run second by second: latency, speeds, then what the router did, all on one time axis with the phases behind. */
export function Timelines({ data }: { data: RunData }): ReactElement | null {
  const [latency, setLatency] = useState<LatencyView>('internet');
  const [wifiView, setWifiView] = useState<WifiView>('rate');
  // one for all the charts: hovering one shows the same moment in each
  const [cursor] = useState(() => createChartCursor<number, number>());
  // what's drawn depends on the run only
  const built = useMemo(() => {
    const t0 = data.meta.t0;
    const run = reportRun(data);
    const to = Math.max(1000, (run.ended?.at ?? run.end) - t0);
    const phases = data.meta.schedule.phases.filter((p) => p.start < to);
    // every other phase shaded
    const bands: ChartBand[] = phases.flatMap((p, i) =>
      i % 2 === 1 ? [{ from: p.start, to: Math.min(p.start + p.dur, to) }] : [],
    );
    const members = data.meta.members;
    const color = (id: string): string => memberColor(members.findIndex((m) => m.id === id));
    // each chart's points on the grid of seconds; `within` reaches a sample's value to the seconds between samples
    const grid = (lines: readonly ChartLine[], within?: number): ChartLine[] =>
      lines.map((l) => ({ ...l, points: onGrid(l.points, to, within) }));
    const lat = (view: LatencyView): { lines: ChartLine[]; marks: ChartMarks[] } => {
      const out: Series[] = members.map((m) => {
        const recs = data.records.get(m.id) ?? [];
        const all = { from: t0, to: t0 + to };
        const s =
          view === 'router'
            ? memberRtts(recs, 'r')
            : view === 'internet'
              ? memberRtts(recs, 'w')
              : view === 'peers'
                ? memberPeerRtts(recs, all)
                : routerRtts(data.probes, m.id, all);
        const w = worstEachSecond(s, t0);
        return { label: m.name, color: color(m.id), points: w.points, marks: w.lost };
      });
      if (view === 'internet') {
        for (const [key, label] of [
          ['wan', 'Router to its gateway'],
          ['far', 'Router to the internet'],
        ] as const) {
          const w = worstEachSecond(routerRtts(data.probes, key, { from: t0, to: t0 + to }), t0);
          out.push({ label, color: 'var(--muted-foreground)', points: w.points, marks: w.lost, dashed: key === 'wan' });
        }
      }
      // a device that never answers the router's pings (a firewall) has only unanswered ones: left out
      const shown = out.filter((s) => s.points.some((p) => p[1] !== null));
      return {
        lines: grid(shown),
        marks: shown.map((s) => ({ label: s.label, color: s.color, times: s.marks })),
      };
    };
    const latencyViews = (['router', 'internet', 'ping', 'peers'] as const)
      .map((k) => ({ k, ...lat(k) }))
      .filter((v) => v.lines.length > 0);

    const wan = wanPort(data.router);
    const speed: ChartLine[] = [];
    if (wan !== undefined) {
      speed.push({ label: 'Internet line, download', color: 'var(--chart-2)', points: ifRate(data.router, t0, wan, 0) });
      speed.push({ label: 'Internet line, upload', color: 'var(--chart-1)', points: ifRate(data.router, t0, wan, 1) });
    }
    for (const m of members) {
      const recs = data.records.get(m.id) ?? [];
      const c = color(m.id);
      speed.push({
        label: `${m.name}, download`,
        color: c,
        points: memberRate(recs, 'd', t0, phases, m.id, t0 + to),
        dashed: true,
      });
      speed.push({
        label: `${m.name}, upload`,
        color: c,
        points: memberRate(recs, 'u', t0, phases, m.id, t0 + to),
        dashed: true,
      });
      speed.push({ label: `${m.name} from its peer`, color: c, points: peerRate(recs, t0) });
    }

    const down = cakeSeconds(data.router, t0, 'down');
    const up = cakeSeconds(data.router, t0, 'up');
    const cake = down.length + up.length > 0;
    const delay = grid([
      { label: 'Download, average', color: 'var(--chart-2)', points: pts(down, (s) => s.avgMs) },
      { label: 'Upload, average', color: 'var(--chart-1)', points: pts(up, (s) => s.avgMs) },
      { label: 'Download, peak', color: 'var(--chart-2)', points: pts(down, (s) => s.peakMs), dashed: true },
      { label: 'Upload, peak', color: 'var(--chart-1)', points: pts(up, (s) => s.peakMs), dashed: true },
    ]);
    const signals = grid([
      { label: 'Download drops', color: 'var(--chart-2)', points: pts(down, (s) => s.drops) },
      { label: 'Download ECN marks', color: 'var(--chart-2)', points: pts(down, (s) => s.marks), dashed: true },
      { label: 'Upload drops', color: 'var(--chart-1)', points: pts(up, (s) => s.drops) },
      { label: 'Upload ECN marks', color: 'var(--chart-1)', points: pts(up, (s) => s.marks), dashed: true },
    ]);
    const backlog = grid([
      { label: 'Download queued', color: 'var(--chart-2)', points: pts(down, (s) => s.backlog) },
      { label: 'Upload queued', color: 'var(--chart-1)', points: pts(up, (s) => s.backlog) },
    ]);

    const cpu = cpuRows(data.router, t0);
    // the connection scans are 10 s apart
    const conns = grid(
      [
        { label: 'Tracked', color: 'var(--chart-3)', points: routerSeries(data.router, t0, (l) => l.ct) },
        { label: 'Offloaded', color: 'var(--chart-2)', points: routerSeries(data.router, t0, (l) => l.ct_scan?.off) },
      ],
      6000,
    );
    const softnet = grid([
      { label: 'Dropped', color: 'var(--destructive)', points: softnetRate(data.router, t0, 1) },
      { label: 'Squeezed', color: 'var(--chart-4)', points: softnetRate(data.router, t0, 2) },
    ]);

    const stations = members.map((m) => ({ m, s: stationSamples(data.router, t0, m.id) })).filter((x) => x.s.length > 0);
    // the stations every 2 s
    const wifi = (view: WifiView): ChartLine[] =>
      grid(
        stations.map(({ m, s }) => ({
          label: m.name,
          color: color(m.id),
          points: s.map((x): TPoint => [x.t, view === 'rate' ? x.txMbit : view === 'retries' ? x.retries : x.aqlMs]),
        })),
        2500,
      );
    return {
      to,
      phases,
      bands,
      latencyViews,
      speed: grid(speed.filter(hasData)),
      cake,
      delay,
      signals,
      backlog,
      cpu,
      conns,
      softnet,
      stations: stations.length,
      wifi: { rate: wifi('rate'), retries: wifi('retries'), aql: wifi('aql') },
    };
  }, [data]);
  const { to, phases } = built;
  const common = { from: 0, to, step: GRID_MS, bands: built.bands, timeText: clockText, cursor, left: PLOT_LEFT };

  if (data.router.length === 0 && built.latencyViews.length === 0) return null;
  const view = built.latencyViews.find((v) => v.k === latency) ?? built.latencyViews[0];
  const latencyNames: Record<LatencyView, string> = {
    router: 'To the router',
    internet: 'To the internet',
    ping: 'Router’s pings',
    peers: 'To peers',
  };
  const softnetQuiet = !built.softnet.some(hasData);

  return (
    <section className="flex flex-col gap-5">
      <h3 className="text-sm font-semibold">Over time</h3>

      <div className="relative h-6" style={{ marginLeft: PLOT_LEFT }} aria-label="The run’s phases">
        {phases.map((p, i) => {
          const left = (p.start / to) * 100;
          const width = (Math.min(p.dur, to - p.start) / to) * 100;
          return (
            <div
              key={i}
              className="absolute inset-y-0 flex min-w-0 flex-col gap-0.5"
              style={{ left: `${String(left)}%`, width: `${String(width)}%` }}
              title={phaseName(p)}
            >
              <span className={cn('h-1.5 rounded-full', phaseStyle[p.kind].bar)} />
              <span className="truncate px-0.5 text-xs leading-4 text-muted-foreground">
                <Arrowed text={phaseName(p)} />
              </span>
            </div>
          );
        })}
      </div>

      {view !== undefined && (
        <Chart
          title="Latency"
          hint="The worst probe in each second; a tick along the foot is one that got no answer"
          action={
            built.latencyViews.length > 1 && (
              <Picker
                label="Latency to"
                value={view.k}
                options={built.latencyViews.map((v) => ({ key: v.k, label: latencyNames[v.k] }))}
                onChange={setLatency}
              />
            )
          }
        >
          <Timeline
            {...common}
            lines={view.lines}
            marks={view.marks}
            format={msText}
            minMax={10}
            label={`Latency ${latencyNames[view.k].toLowerCase()}`}
          />
        </Chart>
      )}

      {built.speed.length > 0 && (
        <Chart title="Speed" hint="The internet line as the router’s WAN port counted it; each device’s own loads dashed">
          <Timeline {...common} lines={built.speed} format={mbit} minMax={1} label="Speed" />
        </Chart>
      )}

      {built.cake && (
        <>
          <Chart
            title="Smart Queue delay"
            hint="Each queue’s, weighted by what it sent that second; none where too few packets went to tell"
          >
            <Timeline {...common} lines={built.delay} format={msText} minMax={5} className="h-28" label="Smart Queue delay" />
          </Chart>
          <Chart title="Smart Queue drops and marks" hint="Each second, every tin">
            <Timeline
              {...common}
              lines={built.signals}
              format={perSecond}
              minMax={1}
              className="h-28"
              label="Smart Queue drops and marks"
            />
          </Chart>
          <Chart title="Smart Queue backlog">
            <Timeline {...common} lines={built.backlog} format={kb} minMax={1024} className="h-28" label="Smart Queue backlog" />
          </Chart>
        </>
      )}

      {built.cpu.spans.length > 0 && (
        <Chart
          title="Router CPU, per core"
          hint="Busy share each second, the deeper the busier; the hover adds its softirq share"
        >
          <CoresChart cpu={built.cpu} from={0} to={to} timeText={clockText} cursor={cursor} label="Router CPU per core" />
        </Chart>
      )}

      {built.conns.some(hasData) && (
        <Chart title="Connections" hint="Offloaded: from the connection scans, every few seconds">
          <Timeline
            {...common}
            lines={built.conns}
            format={(v) => formatNumber(v)}
            minMax={10}
            className="h-28"
            label="Connections"
          />
        </Chart>
      )}

      {built.cpu.spans.length > 0 &&
        (softnetQuiet ? (
          <p className="text-xs text-muted-foreground">
            softnet: no packets dropped from a CPU’s backlog and no squeezes in the run.
          </p>
        ) : (
          <Chart title="softnet" hint="Packets dropped from a CPU’s backlog, and the times NAPI ran out of budget, every CPU">
            <Timeline {...common} lines={built.softnet} format={perSecond} minMax={1} className="h-28" label="softnet" />
          </Chart>
        ))}

      {built.stations > 0 && (
        <Chart
          title="Wi-Fi"
          hint="Each Wi-Fi device’s station, every 2 s"
          action={
            <Picker
              label="Wi-Fi figure"
              value={wifiView}
              options={[
                { key: 'rate', label: 'Rate' },
                { key: 'retries', label: 'Retries' },
                { key: 'aql', label: 'Queued' },
              ]}
              onChange={setWifiView}
            />
          }
        >
          <Timeline
            {...common}
            lines={built.wifi[wifiView]}
            format={wifiView === 'rate' ? mbit : wifiView === 'retries' ? formatPercent : msText}
            max={wifiView === 'retries' ? 1 : undefined}
            minMax={wifiView === 'aql' ? 1 : 10}
            label={`Wi-Fi ${wifiView}`}
          />
        </Chart>
      )}
    </section>
  );
}
