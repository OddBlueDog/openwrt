// What AdGuard Home is seeing, on its page while it's on: lookups and blocks
// over its window, the names asked for and blocked most, and the devices
// asking most, as its own dashboard shows them. Read once a minute while the
// page is open and in view (a live read pauses while it's hidden); the router
// takes them from the reply it already keeps for the page's status, so
// reading them adds nothing for AdGuard Home to work out. Devices are named
// from the router's host hints, read every five minutes.
import { type ReactElement, useState } from 'react';
import { niceCeil } from '@/components/charts/scale';
import { SeriesSwatch } from '@/components/charts/series-swatch';
import { seriesDash } from '@/components/charts/series';
import { CardHeading } from '@/components/card-heading';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Freshness } from '@/components/freshness';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { deviceLabel } from '../clients/model';
import { TimeChart } from '@/components/charts/time-chart';
import { agoLabels } from '../dashboard/model';
import type { AdGuardInsights } from './api';
import { slotSeconds, shareOf, slotTimes } from './model';
import { type Insights, useInsights } from './queries';

/** Rows shown before "Show all". */
const SHORT = 5;

const LOOKUPS = 'var(--chart-1)';
const BLOCKED = 'var(--chart-2)';

export function InsightsCard(): ReactElement {
  const insights = useInsights();
  const { ready, span, at, next } = insights;
  return (
    <Card>
      <CardHeading
        title={span === undefined ? 'What it’s seeing' : `What it’s seeing, last ${span}`}
        description="From AdGuard Home’s own counts, read only while this page is open. Its query log and full lists are in its web interface."
        status={ready ? <Freshness at={at} next={next} /> : 'Refreshes every minute'}
      />
      <CardContent className="flex flex-col gap-6">
        <InsightsBody insights={insights} />
      </CardContent>
    </Card>
  );
}

/**
 * What it's seeing: the totals and the chart, then the three top lists. In
 * Home's widget (`widget`) the chart is shorter, the lists sit side by side
 * from a narrower width, and the rows that don't fit go (fit.ts), the last
 * of each list first, rather than waiting behind "Show all".
 */
export function InsightsBody({ insights, widget = false }: { insights: Insights; widget?: boolean }): ReactElement {
  const { data, error, ready, span, names } = insights;
  if (data === undefined)
    return (
      <p className="text-sm text-muted-foreground">
        {error === undefined ? 'Reading its figures…' : 'The router couldn’t read its figures. It tries again in a minute.'}
      </p>
    );
  if (!ready)
    return (
      <p className="text-sm text-muted-foreground">
        It isn’t giving its figures yet: it may still be starting. It tries again in a minute.
      </p>
    );
  const lists = { widget };
  return (
    <>
      <Lookups data={data} at={data.at ?? 0} span={span ?? ''} chart={widget ? 'h-28' : 'h-36'} />
      <div className="@container">
        <div className={cn('grid gap-6 @3xl:gap-8', widget ? '@lg:grid-cols-3' : '@3xl:grid-cols-3')}>
          <Ranked
            {...lists}
            title="Asked for most"
            rows={data.top_queried ?? []}
            color="bg-chart-1"
            empty="Nothing asked for yet."
          />
          <Ranked
            {...lists}
            title="Blocked most"
            rows={data.top_blocked ?? []}
            color="bg-chart-2"
            empty={
              (data.total ?? 0) > 0
                ? 'Nothing blocked yet. Its blocklists are chosen in its web interface.'
                : 'Nothing blocked yet.'
            }
          />
          <Ranked
            {...lists}
            title="Devices asking most"
            rows={data.top_clients ?? []}
            color="bg-chart-1"
            empty="No devices counted yet."
            nameOf={(address) => names.get(address.toLowerCase())}
          />
        </div>
      </div>
    </>
  );
}

/** Lookups and blocks per hour (or day) over its window, with the totals as the key. */
function Lookups({
  data,
  at,
  span,
  chart,
}: {
  data: AdGuardInsights;
  at: number;
  span: string;
  /** the chart's height */
  chart: string;
}): ReactElement {
  const queries = data.queries ?? [];
  const blocked = data.blocked ?? [];
  const times = slotTimes(queries.length, data.unit, at);
  const peak = Math.max(0, ...queries);
  const total = data.total ?? 0;
  const share = shareOf(data.total_blocked ?? 0, total);
  const from = times[0] ?? at;
  return (
    <div className="flex flex-col gap-3">
      <dl className="flex flex-wrap gap-x-8 gap-y-2">
        <Key color={LOOKUPS} label="Lookups" value={formatNumber(total)} />
        <Key
          color={BLOCKED}
          label="Blocked"
          value={`${formatNumber(data.total_blocked ?? 0)}${share === undefined ? '' : ` · ${share}`}`}
        />
      </dl>
      <TimeChart
        lines={[
          { label: 'Lookups', color: LOOKUPS, points: queries.map((v, i) => [times[i] ?? at, v] as const), area: true },
          { label: 'Blocked', color: BLOCKED, points: blocked.map((v, i) => [times[i] ?? at, v] as const), area: true },
        ]}
        from={from}
        to={at}
        max={niceCeil(Math.max(peak * 1.1, 10))}
        step={slotSeconds(data.unit)}
        format={(v) => formatNumber(v)}
        label={`Lookups and blocked lookups per ${data.unit === 'days' ? 'day' : 'hour'} over the last ${span}`}
        xLabels={agoLabels(from, at, span)}
        className={chart}
        empty={total === 0 ? 'No lookups counted yet' : undefined}
      />
    </div>
  );
}

function Key({ color, label, value }: { color: string; label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <SeriesSwatch color={color} dash={seriesDash(color, 2)} />
        {label}
      </dt>
      <dd className="text-xl font-semibold tracking-tight tabular">{value}</dd>
    </div>
  );
}

/** A top list: each name and its count over a bar against the first's, the first five until asked for the rest. */
function Ranked({
  title,
  rows,
  color,
  empty,
  nameOf,
  widget,
}: {
  title: string;
  rows: readonly { name: string; count: number }[];
  /** the bar's colour: the chart's for what it counts */
  color: string;
  empty: string;
  /** for devices: the name the router knows an address by */
  nameOf?: (address: string) => string | undefined;
  /** on Home: every row, the ones that don't fit going last first (the same row of each list together) */
  widget: boolean;
}): ReactElement {
  const [all, setAll] = useState(false);
  const top = Math.max(1, rows[0]?.count ?? 1);
  const shown = all || widget ? rows : rows.slice(0, SHORT);
  return (
    <section className="flex min-w-0 flex-col gap-2" aria-label={title}>
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.map((r, i) => {
            const name = nameOf?.(r.name);
            return (
              // the first row stays; the rest go from the last (the higher rank first), a row of each list at a time
              <li key={r.name} className="flex flex-col gap-1.5" data-fit={widget && i > 0 ? String(i) : undefined}>
                <span className="flex items-baseline justify-between gap-3 text-sm">
                  {nameOf === undefined ? (
                    <span className="min-w-0 truncate" title={r.name}>
                      {r.name}
                    </span>
                  ) : (
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className={cn('truncate', name === undefined && 'text-muted-foreground')}>{deviceLabel(name)}</span>
                      <span className="font-mono text-xs break-all text-muted-foreground">{r.name}</span>
                    </span>
                  )}
                  <span className="shrink-0 text-muted-foreground tabular">
                    {formatNumber(r.count)}
                    <span className="sr-only"> lookups</span>
                  </span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <span
                    className={cn('block h-full rounded-full', color)}
                    style={{ width: `${String((r.count / top) * 100)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {!widget && rows.length > SHORT && (
        <Button
          variant="link"
          size="sm"
          className="h-auto self-start px-0"
          aria-expanded={all}
          onClick={() => {
            setAll((x) => !x);
          }}
        >
          {all ? 'Show the first five' : `Show all ${String(rows.length)}`}
        </Button>
      )}
    </section>
  );
}
