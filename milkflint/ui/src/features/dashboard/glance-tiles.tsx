// The glance widgets as drawn: a small title, the one word or number with its
// state, and the page it opens; and the traffic as one quiet line pair. Their
// states come from glance.ts.
import type { ReactElement } from 'react';
import { niceCeil } from '@/components/charts/path';
import { seriesDash } from '@/components/charts/series';
import { SeriesSwatch } from '@/components/charts/series-swatch';
import { Card } from '@/components/ui/card';
import { formatBitrate } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { Glance } from './glance';
import { trafficGlance } from './glance';
import { TimeChart } from './time-chart';
import { type Dashboard, HISTORY, POLL_MS } from './use-dashboard';
import { Dot, WidgetLink } from './widget';

const valueTone = { warning: 'text-warning', destructive: 'text-destructive' } as const;

/** One fact: the whole tile opens its page. */
export function GlanceTile({ glance }: { glance: Glance }): ReactElement {
  const { tone } = glance;
  return (
    <a
      href={href(glance.route)}
      className="flex min-w-0 flex-col gap-1.5 rounded-xl border bg-card px-5 py-4 text-card-foreground shadow-xs transition-colors duration-fast hover:border-rule hover:bg-accent/40"
    >
      <h2 className="text-sm font-medium text-muted-foreground">{glance.title}</h2>
      <p className="flex min-w-0 items-center gap-2 text-2xl font-semibold tracking-tight whitespace-nowrap tabular">
        {tone !== undefined && <Dot tone={tone} className="size-2.5" />}
        <span className={cn('truncate', (tone === 'warning' || tone === 'destructive') && valueTone[tone])}>{glance.value}</span>
      </p>
      {glance.detail !== undefined && <p className="text-sm text-muted-foreground">{glance.detail}</p>}
    </a>
  );
}

// download and upload keep the series they have on every page
const DOWN = 'var(--chart-2)';
const UP = 'var(--chart-1)';

/** The internet's traffic of the last minutes: the two rates and their lines, no scale. */
export function GlanceTraffic({ d }: { d: Dashboard }): ReactElement {
  const { down, up } = trafficGlance(d, false);
  const last = d.history[d.history.length - 1];
  const seconds = (HISTORY * POLL_MS) / 1000;
  const to = last?.t ?? 0;
  const from = to - seconds + POLL_MS / 1000;
  const peak = Math.max(0, ...d.history.flatMap((s) => [s.wanDown ?? 0, s.wanUp ?? 0]));
  // never below 1 Mbit/s, so a quiet line doesn't look busy
  const max = niceCeil(Math.max(peak * 1.1, 1e6));
  return (
    <Card aria-label="Traffic" className="gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5">
        <dl className="flex gap-6 text-sm">
          {(
            [
              ['Down', DOWN, down],
              ['Up', UP, up],
            ] as const
          ).map(([label, color, value]) => (
            <div key={label} className="flex items-center gap-2">
              <dt className="flex items-center gap-1.5 text-muted-foreground">
                <SeriesSwatch color={color} dash={seriesDash(color, 2)} />
                {label}
              </dt>
              <dd className="font-semibold tabular">{value === undefined ? '—' : formatBitrate(value)}</dd>
            </div>
          ))}
        </dl>
        <WidgetLink href={href('data-statistics')}>Data statistics</WidgetLink>
      </div>
      <div className="px-5">
        <TimeChart
          bare
          lines={[
            { label: 'Download', color: DOWN, points: d.history.map((s) => [s.t, s.wanDown ?? null] as const), area: true },
            { label: 'Upload', color: UP, points: d.history.map((s) => [s.t, s.wanUp ?? null] as const), area: true },
          ]}
          from={from}
          to={to}
          max={max}
          step={POLL_MS / 1000}
          format={formatBitrate}
          label={`Internet download and upload over the last ${String(seconds / 60)} minutes`}
          xLabels={[]}
          className="h-20"
        />
      </div>
    </Card>
  );
}
