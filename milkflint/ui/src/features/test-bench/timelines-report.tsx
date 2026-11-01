import { ChartSplineIcon } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { HeatStrip } from '@/components/charts/heat-strip';
import { PLOT_LEFT } from '@/components/charts/time-axis';
import { type TimeBand, TimelineChart, type TimelineSeries } from '@/components/charts/timeline-chart';
import { Button } from '@/components/ui/button';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { memberRtts, routerRtts } from './analysis';
import { phaseName } from './phase-names';
import { clockText, phaseStyle } from './phases';
import { memberPeerRtts } from './pairs';
import { reportRun, type RunData } from './run-data';
import {
  cakeSeconds,
  cpuRows,
  ifRate,
  memberColor,
  memberRate,
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

function Picker<K extends string>({ value, options, onChange, label }: { value: K; options: readonly { key: K; label: string }[]; onChange: (k: K) => void; label: string }): ReactElement {
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

function Chart({ title, hint, action, children }: { title: string; hint?: string; action?: ReactElement | false; children: ReactElement }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{title}</span>
          {hint !== undefined && <span className="text-[11px] text-muted-foreground">{hint}</span>}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

const hasData = (s: TimelineSeries): boolean => s.points.some((p) => p[1] !== null && p[1] > 0) || (s.marks?.length ?? 0) > 0;
function pts<T extends { t: number }>(xs: readonly T[], pick: (x: T) => number | null | undefined): TPoint[] {
  return xs.map((x) => [x.t, pick(x) ?? null]);
}

type LatencyView = 'router' | 'internet' | 'ping' | 'peers';
type WifiView = 'rate' | 'retries' | 'aql';

/** The run second by second: latency, speeds, then what the router did, all on one time axis with the phases behind. */
export function Timelines({ data }: { data: RunData }): ReactElement | null {
  const [hover, setHover] = useState<number>();
  const [latency, setLatency] = useState<LatencyView>('internet');
  const [wifiView, setWifiView] = useState<WifiView>('rate');
  // what's drawn depends on the run only; a hover redraws the guide line and card
  const built = useMemo(() => {
    const t0 = data.meta.t0;
    const run = reportRun(data);
    const to = Math.max(1000, (run.ended?.at ?? run.end) - t0);
    const phases = data.meta.schedule.phases.filter((p) => p.start < to);
    const bands: TimeBand[] = phases.map((p, i) => ({ from: p.start, to: Math.min(p.start + p.dur, to), shade: i % 2 === 1 }));
    const members = data.meta.members;
    const color = (id: string): string => memberColor(members.findIndex((m) => m.id === id));
    const lat = (view: LatencyView): TimelineSeries[] => {
      const out: TimelineSeries[] = members.map((m) => {
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
      return out.filter((s) => s.points.some((p) => p[1] !== null));
    };
    const latencyViews = (['router', 'internet', 'ping', 'peers'] as const).map((k) => ({ k, series: lat(k) })).filter((v) => v.series.length > 0);

    const wan = wanPort(data.router);
    const speed: TimelineSeries[] = [];
    if (wan !== undefined) {
      speed.push({ label: 'Internet line ↓', color: 'var(--chart-2)', points: ifRate(data.router, t0, wan, 0) });
      speed.push({ label: 'Internet line ↑', color: 'var(--chart-1)', points: ifRate(data.router, t0, wan, 1) });
    }
    for (const m of members) {
      const recs = data.records.get(m.id) ?? [];
      const c = color(m.id);
      speed.push({ label: `${m.name} ↓`, color: c, points: memberRate(recs, 'd', t0, phases, m.id, t0 + to), dashed: true });
      speed.push({ label: `${m.name} ↑`, color: c, points: memberRate(recs, 'u', t0, phases, m.id, t0 + to), dashed: true });
      speed.push({ label: `${m.name} from its peer`, color: c, points: peerRate(recs, t0) });
    }

    const down = cakeSeconds(data.router, t0, 'down');
    const up = cakeSeconds(data.router, t0, 'up');
    const cake = down.length + up.length > 0;
    const delay: TimelineSeries[] = [
      { label: '↓ average', color: 'var(--chart-2)', points: pts(down, (s) => s.avgMs) },
      { label: '↑ average', color: 'var(--chart-1)', points: pts(up, (s) => s.avgMs) },
      { label: '↓ peak', color: 'var(--chart-2)', points: pts(down, (s) => s.peakMs), dashed: true },
      { label: '↑ peak', color: 'var(--chart-1)', points: pts(up, (s) => s.peakMs), dashed: true },
    ];
    const signals: TimelineSeries[] = [
      { label: '↓ drops', color: 'var(--chart-2)', points: pts(down, (s) => s.drops) },
      { label: '↓ ECN marks', color: 'var(--chart-2)', points: pts(down, (s) => s.marks), dashed: true },
      { label: '↑ drops', color: 'var(--chart-1)', points: pts(up, (s) => s.drops) },
      { label: '↑ ECN marks', color: 'var(--chart-1)', points: pts(up, (s) => s.marks), dashed: true },
    ];
    const backlog: TimelineSeries[] = [
      { label: '↓ queued', color: 'var(--chart-2)', points: pts(down, (s) => s.backlog) },
      { label: '↑ queued', color: 'var(--chart-1)', points: pts(up, (s) => s.backlog) },
    ];

    const cpu = cpuRows(data.router, t0);
    const conns: TimelineSeries[] = [
      { label: 'Tracked', color: 'var(--chart-3)', points: routerSeries(data.router, t0, (l) => l.ct) },
      { label: 'Offloaded', color: 'var(--chart-2)', points: routerSeries(data.router, t0, (l) => l.ct_scan?.off) },
    ];
    const softnet: TimelineSeries[] = [
      { label: 'Dropped', color: 'var(--destructive)', points: softnetRate(data.router, t0, 1) },
      { label: 'Squeezed', color: 'var(--chart-4)', points: softnetRate(data.router, t0, 2) },
    ];

    const stations = members.map((m) => ({ m, s: stationSamples(data.router, t0, m.id) })).filter((x) => x.s.length > 0);
    const wifi = (view: WifiView): TimelineSeries[] =>
      stations.map(({ m, s }) => ({
        label: m.name,
        color: color(m.id),
        points: s.map((x): TPoint => [x.t, view === 'rate' ? x.txMbit : view === 'retries' ? x.retries : x.aqlMs]),
      }));
    return { to, phases, bands, latencyViews, speed: speed.filter(hasData), cake, delay, signals, backlog, cpu, conns, softnet, stations: stations.length, wifi };
  }, [data]);
  const { to, phases } = built;
  const common = { from: 0, to, bands: built.bands, timeText: clockText, hover, onHover: setHover };

  if (data.router.length === 0 && built.latencyViews.length === 0) return null;
  const view = built.latencyViews.find((v) => v.k === latency) ?? built.latencyViews[0];
  const latencyNames: Record<LatencyView, string> = { router: 'To the router', internet: 'To the internet', ping: 'Router’s pings', peers: 'To peers' };
  const softnetQuiet = !built.softnet.some(hasData);

  return (
    <section className="flex flex-col gap-5">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <ChartSplineIcon className="size-4 text-muted-foreground" /> Over time
      </h3>

      <div className="relative h-5" style={{ marginLeft: PLOT_LEFT }} aria-label="The run’s phases">
        {phases.map((p, i) => {
          const left = (p.start / to) * 100;
          const width = (Math.min(p.dur, to - p.start) / to) * 100;
          return (
            <div key={i} className="absolute inset-y-0 flex min-w-0 flex-col gap-0.5" style={{ left: `${String(left)}%`, width: `${String(width)}%` }} title={phaseName(p)}>
              <span className={cn('h-1.5 rounded-full', phaseStyle[p.kind].bar)} />
              <span className="truncate px-0.5 text-[10px] leading-3 text-muted-foreground">{phaseName(p)}</span>
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
          <TimelineChart {...common} series={view.series} format={msText} minMax={10} label={`Latency ${latencyNames[view.k].toLowerCase()}`} />
        </Chart>
      )}

      {built.speed.length > 0 && (
        <Chart title="Speed" hint="The internet line as the router’s WAN port counted it; each device’s own loads dashed">
          <TimelineChart {...common} series={built.speed} format={mbit} minMax={1} label="Speed" />
        </Chart>
      )}

      {built.cake && (
        <>
          <Chart title="Smart Queue delay" hint="The busiest tin’s, of those that sent anything that second">
            <TimelineChart {...common} series={built.delay} format={msText} minMax={5} className="h-28" label="Smart Queue delay" />
          </Chart>
          <Chart title="Smart Queue drops and marks" hint="Each second, every tin">
            <TimelineChart {...common} series={built.signals} format={perSecond} minMax={1} className="h-28" label="Smart Queue drops and marks" />
          </Chart>
          <Chart title="Smart Queue backlog">
            <TimelineChart {...common} series={built.backlog} format={kb} minMax={1024} className="h-28" label="Smart Queue backlog" />
          </Chart>
        </>
      )}

      {built.cpu.spans.length > 0 && (
        <Chart title="Router CPU, per core" hint="Busy share each second, the deeper the busier; the hover adds its softirq share">
          <HeatStrip
            {...common}
            rows={built.cpu.busy.map((values, i) => ({
              label: `CPU ${String(i)}`,
              values,
              detail: (at) => {
                const si = built.cpu.softirq[i]?.[at];
                return si === null || si === undefined ? undefined : `softirq ${formatPercent(si)}`;
              },
            }))}
            spans={built.cpu.spans}
            format={formatPercent}
            label="Router CPU per core"
          />
        </Chart>
      )}

      {built.conns.some(hasData) && (
        <Chart title="Connections" hint="Offloaded: from the connection scans, every few seconds">
          <TimelineChart {...common} series={built.conns} format={(v) => formatNumber(v)} minMax={10} tolerance={6000} className="h-28" label="Connections" />
        </Chart>
      )}

      {built.cpu.spans.length > 0 &&
        (softnetQuiet ? (
          <p className="text-xs text-muted-foreground">softnet: no packets dropped from a CPU’s backlog and no squeezes in the run.</p>
        ) : (
          <Chart title="softnet" hint="Packets dropped from a CPU’s backlog, and the times NAPI ran out of budget, every CPU">
            <TimelineChart {...common} series={built.softnet} format={perSecond} minMax={1} className="h-28" label="softnet" />
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
          <TimelineChart
            {...common}
            series={built.wifi(wifiView)}
            format={wifiView === 'rate' ? mbit : wifiView === 'retries' ? formatPercent : msText}
            max={wifiView === 'retries' ? 1 : undefined}
            minMax={wifiView === 'aql' ? 1 : 10}
            tolerance={2500}
            label={`Wi-Fi ${wifiView}`}
          />
        </Chart>
      )}
    </section>
  );
}
