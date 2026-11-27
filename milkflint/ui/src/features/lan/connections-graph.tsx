// The Connections tab's graph: TCP, UDP and other connections from the tab's
// own reads (connections-history.ts), over the last minute to ten as it stays
// open. It records only while the tab is open, and says so.
import { type ReactElement, useSyncExternalStore } from 'react';
import { niceCeil } from '@/components/charts/scale';
import { type ChartLine, TimeChart } from '@/components/charts/time-chart';
import { formatNumber } from '@/lib/format';
import { gapOf, samplesNow, seriesOf, subscribeSamples, windowOf } from './connections-history';

const clock = (t: number): string =>
  new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

export function ConnectionsGraph(): ReactElement {
  const samples = useSyncExternalStore(subscribeSamples, samplesNow);
  const { from, to } = windowOf(samples);
  const gap = gapOf(samples);
  const s = seriesOf(samples, from, gap);
  const series: ChartLine[] = [
    { label: 'TCP', color: 'var(--chart-1)', points: s.tcp },
    { label: 'UDP', color: 'var(--chart-2)', points: s.udp },
    { label: 'Other', color: 'var(--chart-3)', points: s.other },
  ];
  const minutes = Math.round((to - from) / 60_000);
  return (
    <section aria-labelledby="connections-graph" className="flex flex-col gap-3 rounded-xl border bg-card px-5 py-4 shadow-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="connections-graph" className="text-sm font-medium">
          Connections over time
        </h2>
        <p className="text-xs text-muted-foreground">
          {samples.length < 2
            ? 'Recorded while this tab is open: the lines start with the next reads.'
            : `Recorded while this tab is open: the last ${minutes === 1 ? 'minute' : `${String(minutes)} minutes`}.`}
        </p>
      </div>
      <TimeChart
        lines={series}
        from={from}
        to={to}
        max={niceCeil(
          Math.max(10, 1.1 * Math.max(0, ...samples.filter((x) => x.t >= from).map((x) => Math.max(x.tcp, x.udp, x.other)))),
        )}
        step={gap / 2.5}
        format={(v) => formatNumber(v)}
        timeText={clock}
        className="h-40"
        label="TCP, UDP and other connections while this tab is open"
      />
    </section>
  );
}
