import { type ReactElement, useState } from 'react';
import { ThroughputChart } from '@/components/charts/throughput-chart';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatBitrate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Dashboard, HISTORY, POLL_MS } from './use-dashboard';

const views = {
  internet: { label: 'Internet', down: 'wanDown', up: 'wanUp', hint: 'Traffic on the WAN port' },
  wifi: { label: 'Wi-Fi', down: 'wifiDown', up: 'wifiUp', hint: 'Traffic to and from Wi-Fi clients' },
} as const;
type View = keyof typeof views;

export function TrafficCard({ d, className }: { d: Dashboard; className?: string }): ReactElement {
  const [view, setView] = useState<View>('internet');
  const v = views[view];
  const down = d.history.map((s) => s[v.down]);
  const up = d.history.map((s) => s[v.up]);
  const last = d.history[d.history.length - 1];
  const span = `${String((HISTORY * POLL_MS) / 60_000)} min`;

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Throughput</CardTitle>
          <CardDescription>{v.hint}</CardDescription>
        </div>
        <CardAction>
          <div role="radiogroup" aria-label="Traffic shown" className="flex rounded-md border bg-muted/50 p-0.5 text-xs">
            {(Object.keys(views) as View[]).map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={view === key}
                onClick={() => {
                  setView(key);
                }}
                className={cn(
                  'rounded-sm px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground',
                  view === key && 'bg-card text-foreground shadow-xs',
                )}
              >
                {views[key].label}
              </button>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-8">
          <Legend color="var(--chart-2)" label="Download" value={last?.[v.down]} />
          <Legend color="var(--chart-1)" label="Upload" value={last?.[v.up]} />
        </div>
        <ThroughputChart
          slots={HISTORY}
          spanLabel={span}
          timeOf={(slot) => d.history[slot - (HISTORY - d.history.length)]?.t}
          series={[
            { label: 'Download', color: 'var(--chart-2)', values: down },
            { label: 'Upload', color: 'var(--chart-1)', values: up },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number | undefined }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-2 rounded-full" style={{ background: color }} />
        {label}
      </span>
      <span className="text-xl font-semibold tracking-tight tabular">
        {value === undefined ? '—' : formatBitrate(value)}
      </span>
    </div>
  );
}
