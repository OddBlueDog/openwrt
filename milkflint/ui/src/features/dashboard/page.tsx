import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CpuIcon,
  GlobeIcon,
  MemoryStickIcon,
  RefreshCwIcon,
  WifiIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ipv4 } from '@/lib/api/network';
import { firmwareName } from '@/lib/api/system';
import { useRouterMode } from '@/lib/router-mode';
import { formatBitrate, formatBytes, formatDuration, formatPercent } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import { ClientsCard } from './clients-card';
import { QualityCard } from './quality-card';
import { RadiosCard } from './radios-card';
import { SqmCard } from './sqm-card';
import { StatCard } from './stat-card';
import { SystemCard } from './system-card';
import { TemperaturesCard } from './temperatures-card';
import { TrafficCard } from './traffic-card';
import { UsageCard } from './usage-card';
import { type Dashboard, POLL_MS, useDashboard } from './use-dashboard';

function Live({ stale }: { stale: boolean }): ReactElement {
  return stale ? (
    <Badge variant="warning">
      <RefreshCwIcon className="animate-spin" /> Reconnecting
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1.5 text-muted-foreground">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-success" />
      </span>
      Live · every {POLL_MS / 1000} s
    </Badge>
  );
}

function StatCards({ d }: { d: Dashboard }): ReactElement {
  const mem = d.info.memory;
  const used = mem.total - (mem.available ?? mem.free + mem.buffered);
  const load = d.info.load.map((l) => (l / 65536).toFixed(2)).join(' · ');
  const latest = d.history[d.history.length - 1];
  const bands = new Map<string, number>();
  for (const c of d.clients) bands.set(c.band ?? 'Other', (bands.get(c.band ?? 'Other') ?? 0) + 1);
  // in access point mode the way out is the LAN, to the main router
  const ap = useRouterMode() === 'ap';
  const gateway = d.lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
  const online = ap ? d.lan?.up === true && gateway !== undefined : d.wan?.up === true;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        icon={CpuIcon}
        title="CPU"
        value={d.cpu === undefined ? '—' : formatPercent(d.cpu)}
        detail={`load ${load}`}
        spark={d.history.map((s) => s.cpu)}
        sparkMax={1}
        sparkFormat={formatPercent}
        sparkTimes={d.history.map((s) => s.t)}
      >
        {d.cores.length > 1 && (
          <div className="mt-1 flex gap-1" aria-label="Per-core use">
            {d.cores.map((c, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col items-center gap-0.5" title={`Core ${String(i)}: ${formatPercent(c)}`}>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary/70" style={{ width: `${String(c * 100)}%` }} />
                </div>
                <span className="text-xs text-muted-foreground tabular">{formatPercent(c)}</span>
              </div>
            ))}
          </div>
        )}
      </StatCard>

      <StatCard
        icon={MemoryStickIcon}
        title="Memory"
        value={formatPercent(used / mem.total)}
        detail={`${formatBytes(used)} of ${formatBytes(mem.total)} in use`}
        spark={d.history.map((s) => s.memory)}
        sparkMax={1}
        sparkFormat={formatPercent}
        sparkTimes={d.history.map((s) => s.t)}
        sparkColor="var(--chart-2)"
      />

      <StatCard
        icon={WifiIcon}
        title="Wi-Fi clients"
        value={d.clients.length}
        detail={
          latest?.wifiDown === undefined
            ? 'measuring…'
            : `↓ ${formatBitrate(latest.wifiDown)}  ↑ ${formatBitrate(latest.wifiUp ?? 0)}`
        }
        spark={d.history.map((s) => (s.wifiDown === undefined ? undefined : s.wifiDown + (s.wifiUp ?? 0)))}
        sparkMax={Math.max(1, ...d.history.map((s) => (s.wifiDown ?? 0) + (s.wifiUp ?? 0)))}
        sparkColor="var(--chart-3)"
      >
        <div className="mt-1 flex flex-wrap gap-1">
          {[...bands].map(([band, n]) => (
            <Badge key={band} variant="secondary" className="font-normal">
              {band}: {n}
            </Badge>
          ))}
        </div>
      </StatCard>

      <StatCard
        icon={GlobeIcon}
        title={ap ? 'Main router' : 'Internet'}
        value={
          <span className="flex items-center gap-2">
            <span className={online ? 'size-2.5 rounded-full bg-success' : 'size-2.5 rounded-full bg-destructive'} />
            {ap ? (online ? 'Connected' : 'Not connected') : online ? 'Online' : 'Offline'}
          </span>
        }
        detail={
          ap
            ? online
              ? `${ipv4(d.lan) ?? 'no IPv4'} · via ${gateway ?? ''}`
              : 'No address from it yet'
            : online
              ? `${ipv4(d.wan) ?? 'no IPv4'} · up ${formatDuration(d.wan?.uptime ?? 0)}`
              : `WAN ${d.wan === undefined ? 'not configured' : 'down'}`
        }
        spark={d.history.map((s) => s.wanDown)}
        sparkMax={Math.max(1, ...d.history.map((s) => s.wanDown ?? 0))}
        sparkColor="var(--chart-2)"
      >
        {latest?.wanDown !== undefined && (
          <div className="mt-1 flex gap-3 font-mono text-[11px] text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <ArrowDownIcon className="size-3" />
              {formatBitrate(latest.wanDown)}
            </span>
            <span className="flex items-center gap-0.5">
              <ArrowUpIcon className="size-3" />
              {formatBitrate(latest.wanUp ?? 0)}
            </span>
          </div>
        )}
      </StatCard>
    </div>
  );
}

function Loading(): ReactElement {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-44 rounded-xl" />
      ))}
      <Skeleton className="h-80 rounded-xl sm:col-span-2 xl:col-span-3" />
      <Skeleton className="h-80 rounded-xl sm:col-span-2 xl:col-span-1" />
    </div>
  );
}

export function DashboardPage(): ReactElement {
  const { data, error, loading, refresh } = useDashboard();

  return (
    <>
      <PageHeader
        title={data?.board.hostname ?? 'Dashboard'}
        description={
          data === undefined
            ? 'Everything at a glance, live.'
            : [data.board.model, firmwareName(data.board.release)].filter(Boolean).join(' · ')
        }
        actions={data !== undefined && <Live stale={error !== undefined} />}
      />

      {data === undefined && error !== undefined && !loading ? (
        <Alert variant="destructive">
          <ActivityIcon />
          <AlertTitle>Couldn&apos;t load the router&apos;s status</AlertTitle>
          <AlertDescription>
            {errorMessage(error)}
            <Button variant="outline" size="sm" onClick={refresh} className="mt-2">
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      ) : data === undefined ? (
        <Loading />
      ) : (
        <div className="flex flex-col gap-4">
          <StatCards d={data} />
          <div className="grid gap-4 xl:grid-cols-3">
            <TrafficCard d={data} className="xl:col-span-2" />
            <RadiosCard d={data} />
          </div>
          <div className="grid gap-4 xl:grid-cols-3">
            <ClientsCard d={data} className="xl:col-span-2" />
            <SystemCard d={data} />
          </div>
          <TemperaturesCard d={data} />
          {/* each shows only while its feature is on */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-4 empty:hidden">
            <QualityCard />
            <UsageCard />
            <SqmCard d={data} />
          </div>
          <MemoryNote d={data} />
        </div>
      )}
    </>
  );
}

/** Explains the memory figure once, quietly, below everything. */
function MemoryNote({ d }: { d: Dashboard }): ReactElement {
  const cache = (d.info.memory.cached ?? 0) + d.info.memory.buffered;
  return (
    <p className="text-xs text-muted-foreground">
      Memory &ldquo;in use&rdquo; leaves out {formatBytes(cache)} of cache, which Linux frees whenever it&apos;s needed.
    </p>
  );
}
