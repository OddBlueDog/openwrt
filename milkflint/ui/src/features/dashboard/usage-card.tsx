import type { ReactElement } from 'react';
import { usePoll } from '@/hooks/use-poll';
import { formatBytes } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { deviceLabel } from '../clients/model';
import { getPeriods, getUsage, loadNames, loadRouterIps, periodStart } from '../data-statistics/api';
import { sharedCall } from '@/lib/shared-call';
import { EMPTY_GOES } from './fit';
import { OffNote, StateBadge, Widget, WidgetLink } from './widget';

interface Usage {
  /** the current accounting period's start (YYYY-MM-DD) */
  start: string | undefined;
  rx: number;
  tx: number;
  /** `name` undefined when it has none; `address` its IPv4 address, else its MAC */
  top: { key: string; name: string | undefined; address: string; rx: number; tx: number }[];
}

/** The current period's totals and busiest devices; 'off' while Data usage is off, 'missing' without it. */
async function loadUsage(): Promise<Usage | 'off' | 'missing'> {
  const periods = await getPeriods();
  if (!periods.installed) return 'missing';
  if (periods.enabled === false) return 'off';
  const [rows, names, routerIps] = await Promise.all([getUsage('', 'mac'), loadNames(), loadRouterIps()]);
  const devices = rows.filter((r) => r.ip === undefined || !routerIps.has(r.ip));
  return {
    start: periods.periods[0],
    rx: devices.reduce((n, r) => n + r.rx, 0),
    tx: devices.reduce((n, r) => n + r.tx, 0),
    top: devices
      .slice(0, 4)
      .map((r) => ({ key: r.key, name: names.get(r.key.toLowerCase()), address: r.ip ?? r.key, rx: r.rx, tx: r.tx })),
  };
}

// one call for every Data usage widget on Home
const readUsage = sharedCall(loadUsage);

// download and upload keep the colours they have on every page
function Total({ swatch, label, bytes, fit }: { swatch: string; label: string; bytes: number; fit?: 1 }): ReactElement {
  return (
    <div data-fit={fit} className="flex flex-col gap-0.5">
      <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className={`size-2 rounded-full ${swatch}`} aria-hidden="true" />
        {label}
      </dt>
      <dd className="text-lg font-semibold tracking-tight tabular @xs:text-xl">{formatBytes(bytes)}</dd>
    </div>
  );
}

/** Data usage's current period: totals and the busiest devices. */
export function UsageCard({ ap }: { ap: boolean }): ReactElement {
  const { data, error } = usePoll(readUsage, 60_000);
  const link = <WidgetLink href={href('data-statistics')}>Details</WidgetLink>;

  if (ap) {
    return (
      <Widget>
        <OffNote action={<WidgetLink href={href('mode')}>Operating mode</WidgetLink>}>
          In access point mode your main router counts the traffic.
        </OffNote>
      </Widget>
    );
  }
  if (data === undefined) {
    return (
      <Widget>
        {error === undefined ? (
          <p className="px-5 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <OffNote action={link}>The router didn’t say how much was used.</OffNote>
        )}
      </Widget>
    );
  }
  if (data === 'off' || data === 'missing') {
    return (
      <Widget aside={<StateBadge tone="off">Off</StateBadge>}>
        <OffNote
          action={<WidgetLink href={href('data-statistics')}>{data === 'off' ? 'Turn on Data usage' : 'Data usage'}</WidgetLink>}
        >
          {data === 'off'
            ? 'It counts how much each device downloads and uploads.'
            : 'This firmware doesn’t count how much each device downloads and uploads.'}
        </OffNote>
      </Widget>
    );
  }

  const most = Math.max(1, ...data.top.map((r) => r.rx + r.tx));
  return (
    <Widget status={data.start === undefined ? 'This period' : `Since ${periodStart(data.start)}`} aside={link}>
      <div className="flex flex-1 flex-col gap-4 px-5">
        <dl className="flex flex-wrap gap-x-5 gap-y-2 @xs:gap-x-8">
          <Total swatch="bg-chart-2" label="Downloaded" bytes={data.rx} />
          {/* the devices go first, then this, when the widget is short of room */}
          <Total swatch="bg-chart-1" label="Uploaded" bytes={data.tx} fit={1} />
        </dl>
        {data.top.length === 0 ? (
          <p data-fit className="text-sm text-muted-foreground">
            No traffic counted yet in this period.
          </p>
        ) : (
          <ul className={cn('flex flex-col gap-2.5', EMPTY_GOES)} aria-label="Busiest devices this period">
            {data.top.map((r) => (
              <li key={r.key} data-fit className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  {/* an unnamed device as on Data usage and All devices: so called, its address under it */}
                  <span className="flex min-w-0 flex-col">
                    <span className={cn('truncate', r.name === undefined && 'text-muted-foreground')}>{deviceLabel(r.name)}</span>
                    {r.name === undefined && (
                      <span className="font-mono text-xs break-all text-muted-foreground">{r.address}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">
                    {formatBytes(r.rx)} down · {formatBytes(r.tx)} up
                  </span>
                </div>
                <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                  <div className="rounded-full bg-chart-2" style={{ width: `${String((r.rx / most) * 100)}%` }} />
                  <div className="rounded-full bg-chart-1" style={{ width: `${String((r.tx / most) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Widget>
  );
}
