import { ArrowDownUpIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { niceCeil } from '@/components/charts/path';
import { formatBitrate } from '@/lib/format';
import { Segmented } from '@/components/ui/segmented';
import { agoLabels } from './model';
import { TimeChart } from './time-chart';
import { type Dashboard, HISTORY, POLL_MS } from './use-dashboard';
import { Widget } from './widget';
import { SeriesSwatch } from '@/components/charts/series-swatch';
import { seriesDash } from '@/components/charts/series';

const views = {
  internet: { label: 'Internet', down: 'wanDown', up: 'wanUp', hint: 'Traffic on the WAN port' },
  wifi: { label: 'Wi-Fi', down: 'wifiDown', up: 'wifiUp', hint: 'Traffic to and from Wi-Fi devices' },
} as const;
type View = keyof typeof views;

// download and upload keep the colours they have on every page
const DOWN = 'var(--chart-2)';
const UP = 'var(--chart-1)';

export function TrafficCard({ d }: { d: Dashboard }): ReactElement {
  const [view, setView] = useState<View>('internet');
  const v = views[view];
  const last = d.history[d.history.length - 1];
  const seconds = (HISTORY * POLL_MS) / 1000;
  // the newest sample is the one this poll took
  const to = last?.t ?? 0;
  const from = to - seconds + POLL_MS / 1000;
  const peak = Math.max(0, ...d.history.flatMap((s) => [s[v.down] ?? 0, s[v.up] ?? 0]));
  // never below 1 Mbit/s, so a quiet line doesn't look busy
  const max = niceCeil(Math.max(peak * 1.1, 1e6));

  return (
    <Widget
      icon={ArrowDownUpIcon}
      title="Throughput"
      description={v.hint}
      aside={
        <Segmented
          label="Traffic shown"
          value={view}
          options={(Object.keys(views) as View[]).map((key) => ({ value: key, label: views[key].label }))}
          onChange={setView}
        />
      }
    >
      <div className="flex flex-col gap-3 px-5">
        <dl className="flex gap-8">
          <Legend color={DOWN} label="Download" value={last?.[v.down]} />
          <Legend color={UP} label="Upload" value={last?.[v.up]} />
        </dl>
        <TimeChart
          lines={[
            { label: 'Download', color: DOWN, points: d.history.map((s) => [s.t, s[v.down] ?? null] as const), area: true },
            { label: 'Upload', color: UP, points: d.history.map((s) => [s.t, s[v.up] ?? null] as const), area: true },
          ]}
          from={from}
          to={to}
          max={max}
          step={POLL_MS / 1000}
          format={formatBitrate}
          label={`${v.label} download and upload over the last ${String(seconds / 60)} minutes`}
          xLabels={agoLabels(from, to, `${String(seconds / 60)} min`)}
          className="h-36 @2xl:h-44"
          empty={
            peak === 0
              ? `No traffic in the last ${String(seconds / 60)} minutes`
              : peak < max / 50
                ? `Quiet: at most ${formatBitrate(peak)} in the last ${String(seconds / 60)} minutes`
                : undefined
          }
        />
      </div>
    </Widget>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number | undefined }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SeriesSwatch color={color} dash={seriesDash(color, 2)} />
        {label}
      </dt>
      <dd className="text-xl font-semibold tracking-tight tabular">{value === undefined ? '—' : formatBitrate(value)}</dd>
    </div>
  );
}
