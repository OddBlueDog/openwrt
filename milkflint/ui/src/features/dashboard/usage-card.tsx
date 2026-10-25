import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import { formatBytes } from '@/lib/format';
import { href } from '@/lib/router';
import { getPeriods, getUsage, loadNames, loadRouterIps, periodStart } from '../data-statistics/api';

interface Usage {
  /** the current accounting period's start (YYYY-MM-DD) */
  start: string | undefined;
  rx: number;
  tx: number;
  top: { key: string; name: string; rx: number; tx: number }[];
}

/** The current period's totals and busiest devices; null while Data Statistics is off. */
async function loadUsage(): Promise<Usage | null> {
  const periods = await getPeriods();
  if (!periods.installed || periods.enabled === false) return null;
  const [rows, names, routerIps] = await Promise.all([getUsage('', 'mac'), loadNames(), loadRouterIps()]);
  const devices = rows.filter((r) => r.ip === undefined || !routerIps.has(r.ip));
  return {
    start: periods.periods[0],
    rx: devices.reduce((n, r) => n + r.rx, 0),
    tx: devices.reduce((n, r) => n + r.tx, 0),
    top: devices.slice(0, 4).map((r) => ({ key: r.key, name: names.get(r.key.toLowerCase()) ?? r.ip ?? r.key, rx: r.rx, tx: r.tx })),
  };
}

function Total({ icon: Icon, color, label, bytes }: { icon: typeof ArrowDownIcon; color: string; label: string; bytes: number }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className={`size-3 ${color}`} />
        {label}
      </span>
      <span className="text-xl font-semibold tracking-tight tabular">{formatBytes(bytes)}</span>
    </div>
  );
}

/** Data Statistics' current period, while it's on. */
export function UsageCard(): ReactElement | null {
  const { data } = usePoll(loadUsage, 60_000);
  if (data === undefined || data === null) return null;
  const most = Math.max(1, ...data.top.map((r) => r.rx + r.tx));

  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Data usage</CardTitle>
          <CardDescription>{data.start === undefined ? 'This period' : `Since ${periodStart(data.start)}`}</CardDescription>
        </div>
        <CardAction>
          <a href={href('data-statistics')} className="text-xs text-primary hover:underline">
            Details
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex gap-8">
          <Total icon={ArrowDownIcon} color="text-chart-2" label="Downloaded" bytes={data.rx} />
          <Total icon={ArrowUpIcon} color="text-chart-1" label="Uploaded" bytes={data.tx} />
        </div>
        {data.top.length === 0 ? (
          <p className="text-sm text-muted-foreground">No traffic counted yet in this period.</p>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-label="Busiest devices">
            {data.top.map((r) => (
              <li key={r.key} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{formatBytes(r.rx + r.tx)}</span>
                </div>
                <div className="flex h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="bg-chart-2" style={{ width: `${String((r.rx / most) * 100)}%` }} />
                  <div className="bg-chart-1" style={{ width: `${String((r.tx / most) * 100)}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
