// About this router: the full read-out Home's System card links to. It opens
// on the router's name, model, firmware and how long it's been up, then
// every figure it reports about itself: hardware and firmware in full, each
// core, memory in parts, storage, its addresses and every temperature
// sensor. Read every 3 s while the page is open; the Processor card opens
// the process list.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { ProcessesButton } from '@/components/processes/processes-sheet';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { ipv4, type NetworkInterface, wanInterfaces, wanIpv6 } from '@/lib/api/network';
import type { Stats } from '@/lib/api/stats';
import { firmwareName, memoryInUse } from '@/lib/api/system';
import { formatBytes, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { useLive } from '@/lib/query/use-live';
import { cn } from '@/lib/utils';
import { coreLoads } from './model';
import { systemQueries } from './queries';

const TITLE = 'About this router';
const DESCRIPTION =
  'Everything the router reports about itself, read every 3 s: hardware, firmware, memory, storage, addresses and temperatures.';

/** A label and its value on one line; a long value (`wrap`) wraps rather than running out of the card, a short one keeps together. */
function Row({ label, children, wrap = false }: { label: string; children: ReactNode; wrap?: boolean }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-6 py-2.5 text-sm">
      <dt className={cn('text-muted-foreground', wrap ? 'shrink-0' : 'min-w-0')}>{label}</dt>
      <dd className={cn('text-right font-medium tabular', wrap ? 'min-w-0 break-words' : 'shrink-0 whitespace-nowrap')}>
        {children}
      </dd>
    </div>
  );
}

function Meter({
  label,
  used,
  total,
  format,
}: {
  label: string;
  used: number;
  total: number;
  format: (n: number) => string;
}): ReactElement {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5 py-3">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="min-w-0 text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium whitespace-nowrap tabular">
          {format(used)} <span className="font-normal text-muted-foreground">of {format(total)}</span>
        </span>
      </div>
      <Progress
        value={pct}
        aria-label={`${label}: ${formatPercent(pct / 100)}`}
        indicatorClassName={pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-chart-1'}
      />
    </div>
  );
}

/** A cell of the opening answer: its label above its value, or beside it on a phone. */
function Cell({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-4 px-5 py-3 md:flex-col md:items-start md:justify-start md:gap-1 md:py-4">
      <dt className="shrink-0 text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words tabular md:text-left">{children}</dd>
    </div>
  );
}

/** What a temperature sensor measures: the port or radio it's on, else its own name. */
function sensorLabel(t: Stats['temperatures'][number], wan: NetworkInterface | undefined): string {
  if (typeof t.port === 'string') {
    if (t.port === wan?.device || t.port === wan?.l3_device) return 'WAN port';
    const lan = /^lan(\d+)$/.exec(t.port);
    return lan === null ? `Port ${t.port}` : `LAN ${lan[1] ?? ''} port`;
  }
  if (typeof t.wiphy === 'string') return `Wi-Fi radio ${t.wiphy}`;
  return /cpu/i.test(t.name) ? 'CPU' : t.name;
}

function tempBadge(c: number): ReactElement | null {
  if (c >= 85) return <Badge variant="destructive">Hot</Badge>;
  if (c >= 70) return <Badge variant="warning">Warm</Badge>;
  return null;
}

export function SystemOverviewPage(): ReactElement {
  const boardQuery = useQuery(systemQueries.board());
  const live = useLive(systemQueries.overview());
  // the samples the cores' loads are worked out between: each answer counted once, by when it came
  const [samples, setSamples] = useState<{
    at?: number | undefined;
    now?: Stats['cpu'] | undefined;
    before?: Stats['cpu'] | undefined;
  }>({});
  if (live.data !== undefined && live.at !== samples.at) {
    setSamples({ at: live.at, now: live.data.stats.cpu, before: samples.now });
  }

  const error = boardQuery.error ?? live.error;
  if (boardQuery.data === undefined || live.data === undefined) {
    return (
      <>
        <PageHeader title={TITLE} description={DESCRIPTION} />
        {error === undefined || error === null ? (
          <FormSkeleton />
        ) : (
          <LoadError
            error={error}
            retry={() => {
              void boardQuery.refetch();
              live.refresh();
            }}
          />
        )}
      </>
    );
  }

  const { info, stats, interfaces } = live.data;
  const board = boardQuery.data;
  const cores = samples.at === live.at ? coreLoads(samples.before, stats.cpu) : undefined;
  const mem = info.memory;
  const used = memoryInUse(mem);
  const wan = interfaces.find((i) => i.interface === 'wan');
  const lan = interfaces.find((i) => i.interface === 'lan');
  const v6 = wanIpv6(wanInterfaces(interfaces));
  const coreRows = cores ?? stats.cpu.filter((c) => c.name !== 'cpu').map(() => undefined);
  const time = new Date(info.localtime * 1000);

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div className="flex flex-col gap-4">
        <Card className="gap-0 py-0">
          <dl className="grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)] md:divide-x">
            <div className="flex min-w-0 flex-col gap-1 border-b px-5 py-4 md:border-b-0">
              <dt className="sr-only">Router</dt>
              <dd className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-lg font-semibold tracking-tight">{board.hostname}</span>
                <span className="text-sm text-muted-foreground">{board.model ?? 'Router'}</span>
              </dd>
            </div>
            <Cell label="Firmware">{firmwareName(board.release) ?? '—'}</Cell>
            <Cell label="Up for">{formatDuration(info.uptime)}</Cell>
            <Cell label="Router time">
              {time.toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' })}
            </Cell>
          </dl>
        </Card>

        <div className="grid items-start gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeading
                title="Hardware and firmware"
                status={
                  <>
                    To install another firmware, see{' '}
                    <Link {...pageLink('upgrade')} className="font-medium link">
                      Upgrade
                    </Link>
                    .
                  </>
                }
              />
              <CardContent>
                <dl className="divide-y">
                  <Row label="Model" wrap>
                    {board.model ?? '—'}
                  </Row>
                  <Row label="Board" wrap>
                    {board.board_name ?? '—'}
                  </Row>
                  <Row label="Processor" wrap>
                    {board.system ?? '—'}
                  </Row>
                  <Row label="Firmware" wrap>
                    {firmwareName(board.release) ?? '—'}
                  </Row>
                  {board.release?.description !== undefined && board.release.description !== firmwareName(board.release) && (
                    <Row label="OpenWrt release" wrap>
                      {board.release.description}
                    </Row>
                  )}
                  <Row label="Kernel">{board.kernel ?? '—'}</Row>
                  {board.rootfs_type !== undefined && <Row label="Root file system">{board.rootfs_type}</Row>}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeading title="Memory" status={`${formatBytes(mem.total)} in all`} />
              <CardContent>
                <Meter label="In use" used={used} total={mem.total} format={formatBytes} />
                <dl className="divide-y border-t">
                  <Row label="Cached (freed when needed)">{formatBytes(mem.cached ?? 0)}</Row>
                  <Row label="Buffered (freed when needed)">{formatBytes(mem.buffered)}</Row>
                  {mem.available !== undefined && <Row label="Available">{formatBytes(mem.available)}</Row>}
                  <Row label="Free">{formatBytes(mem.free)}</Row>
                  <Row label="Shared">{formatBytes(mem.shared)}</Row>
                  {info.swap !== undefined && info.swap.total > 0 && (
                    <Row label="Swap used">{formatBytes(info.swap.total - info.swap.free)}</Row>
                  )}
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeading
                title="Temperatures"
                description={stats.temperatures.length === 0 ? undefined : 'Each sensor the router has, now.'}
              />
              <CardContent>
                {stats.temperatures.length === 0 ? (
                  <p className="text-sm text-muted-foreground">This router reports no temperature sensors.</p>
                ) : (
                  <dl className="divide-y">
                    {stats.temperatures.map((t) => (
                      <div key={t.name} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                        <dt className="flex min-w-0 flex-col">
                          <span>{sensorLabel(t, wan)}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{t.name}</span>
                        </dt>
                        <dd className="flex shrink-0 items-center gap-2">
                          {tempBadge(t.celsius)}
                          <span className="font-medium tabular">{t.celsius.toFixed(1)} °C</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeading
                title="Processor"
                status={`${String(coreRows.length)} cores, over the last 3 s`}
                action={<ProcessesButton look="card" />}
              />
              <CardContent className="flex flex-col gap-3">
                <ul className="flex flex-col gap-2.5">
                  {coreRows.map((c, i) => (
                    <li key={i} className="grid grid-cols-[4rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                      <span className="text-muted-foreground">Core {i}</span>
                      <Progress
                        value={(c ?? 0) * 100}
                        aria-label={`Core ${String(i)}: ${c === undefined ? 'reading' : formatPercent(c)}`}
                        indicatorClassName="bg-chart-1"
                      />
                      <span className="text-right font-medium tabular">{c === undefined ? '—' : formatPercent(c)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="divide-y border-t">
                  <Row label="Load, 1 · 5 · 15 min">{info.load.map((l) => (l / 65536).toFixed(2)).join(' · ')}</Row>
                </dl>
              </CardContent>
            </Card>
            <Card>
              <CardHeading title="Storage and connections" description="Settings and installed packages live on the overlay." />
              <CardContent className="divide-y">
                {info.root !== undefined && (
                  <Meter label="Overlay (/)" used={info.root.used * 1024} total={info.root.total * 1024} format={formatBytes} />
                )}
                {info.tmp !== undefined && (
                  <Meter
                    label="Temporary (/tmp, in memory)"
                    used={info.tmp.used * 1024}
                    total={info.tmp.total * 1024}
                    format={formatBytes}
                  />
                )}
                {stats.conntrack.count !== null && stats.conntrack.max !== null && (
                  <Meter
                    label="Tracked connections"
                    used={stats.conntrack.count}
                    total={stats.conntrack.max}
                    format={(n) => formatNumber(n)}
                  />
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeading
                title="Addresses"
                status={
                  <>
                    Set on{' '}
                    <Link {...pageLink('internet')} className="font-medium link">
                      Internet
                    </Link>{' '}
                    and{' '}
                    <Link {...pageLink('lan')} className="font-medium link">
                      LAN & DHCP
                    </Link>
                    .
                  </>
                }
              />
              <CardContent>
                <dl className="divide-y">
                  <Row label="LAN">{ipv4(lan) ?? '—'}</Row>
                  <Row label="WAN IPv4">{ipv4(wan) ?? (wan?.up === true ? 'none' : 'not connected')}</Row>
                  <Row label="WAN IPv6" wrap>
                    {v6.address ?? (v6.range === undefined ? '—' : 'none of its own')}
                  </Row>
                  {v6.range !== undefined && (
                    <Row label="IPv6 range" wrap>
                      {v6.range}
                    </Row>
                  )}
                  <Row label="DNS servers" wrap>
                    {wan?.['dns-server']?.join(', ') ?? '—'}
                  </Row>
                </dl>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}
