import { CpuIcon, HardDriveIcon, MemoryStickIcon, NetworkIcon, RouterIcon, ThermometerIcon } from 'lucide-react';
import { type ReactElement, useRef } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { usePoll } from '@/hooks/use-poll';
import { getInterfaces, ipv4, type NetworkInterface } from '@/lib/api/network';
import { getStats, type Stats } from '@/lib/api/stats';
import { type Board, firmwareName, getBoard, getInfo, type SystemInfo } from '@/lib/api/system';
import { formatBytes, formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Overview {
  board: Board;
  info: SystemInfo;
  stats: Stats;
  interfaces: NetworkInterface[];
  cores: number[] | undefined;
}

function Meter({ label, used, total, format }: { label: string; used: number; total: number; format: (n: number) => string }): ReactElement {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5 py-2">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular">
          {format(used)} <span className="text-muted-foreground">/ {format(total)}</span>
        </span>
      </div>
      <Progress value={pct} indicatorClassName={pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-chart-2'} />
    </div>
  );
}

export function SystemOverviewPage(): ReactElement {
  const prevCpu = useRef<Stats['cpu']>(undefined);
  const { data, error, refresh } = usePoll(async (): Promise<Overview> => {
    const [board, info, stats, interfaces] = await Promise.all([getBoard(), getInfo(), getStats(), getInterfaces()]);
    const before = new Map(prevCpu.current?.map((c) => [c.name, c]));
    const cores =
      prevCpu.current === undefined
        ? undefined
        : stats.cpu
            .filter((c) => c.name !== 'cpu')
            .map((c) => {
              const p = before.get(c.name);
              const total = c.total - (p?.total ?? c.total);
              return total > 0 ? 1 - (c.idle - (p?.idle ?? c.idle)) / total : 0;
            });
    prevCpu.current = stats.cpu;
    return { board, info, stats, interfaces, cores };
  }, 3000);

  if (data === undefined) {
    return (
      <>
        <PageHeader title="Overview" description="The router itself: hardware, firmware and resources." />
        {error === undefined ? <FormSkeleton /> : <LoadError error={error} retry={refresh} />}
      </>
    );
  }

  const { board, info, stats, interfaces, cores } = data;
  const mem = info.memory;
  const cache = (mem.cached ?? 0) + mem.buffered;
  const used = mem.total - (mem.available ?? mem.free + mem.buffered);
  const wan = interfaces.find((i) => i.interface === 'wan');
  const lan = interfaces.find((i) => i.interface === 'lan');
  const wan6 = interfaces.find((i) => i.interface === 'wan6')?.['ipv6-address']?.[0];

  return (
    <>
      <PageHeader title="Overview" description="The router itself: hardware, firmware and resources." />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card>
          <CardHeading icon={RouterIcon} title={board.hostname} description={board.model} />
          <CardContent className="divide-y">
            <InfoRow label="Firmware">{firmwareName(board.release) ?? '—'}</InfoRow>
            <InfoRow label="Kernel">{board.kernel ?? '—'}</InfoRow>
            <InfoRow label="Board">{board.board_name ?? '—'}</InfoRow>
            <InfoRow label="Up for">{formatDuration(info.uptime)}</InfoRow>
            <InfoRow label="Router time">
              {new Date(info.localtime * 1000).toLocaleString('en-GB', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'medium' })}
            </InfoRow>
          </CardContent>
        </Card>

        <Card>
          <CardHeading icon={CpuIcon} title="Processor" description={`Load ${info.load.map((l) => (l / 65536).toFixed(2)).join(' · ')}`} />
          <CardContent className="flex flex-col gap-3">
            {(cores ?? stats.cpu.filter((c) => c.name !== 'cpu').map(() => undefined)).map((c, i) => (
              <div key={i} className="flex items-center gap-3 text-sm">
                <span className="w-14 text-muted-foreground">Core {i}</span>
                <Progress value={(c ?? 0) * 100} className="flex-1" indicatorClassName="bg-chart-1" />
                <span className="w-10 text-right tabular">{c === undefined ? '—' : formatPercent(c)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeading icon={MemoryStickIcon} title="Memory" description={`${formatBytes(mem.total)} in total`} />
          <CardContent className="divide-y">
            <Meter label="In use" used={used} total={mem.total} format={formatBytes} />
            <InfoRow label="Cache and buffers (freed when needed)">{formatBytes(cache)}</InfoRow>
            <InfoRow label="Free">{formatBytes(mem.free)}</InfoRow>
            {info.swap !== undefined && info.swap.total > 0 && (
              <InfoRow label="Swap used">{formatBytes(info.swap.total - info.swap.free)}</InfoRow>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeading icon={HardDriveIcon} title="Storage" description="Settings and installed packages live on the overlay." />
          <CardContent className="divide-y">
            {info.root !== undefined && (
              <Meter label="Overlay (/)" used={info.root.used * 1024} total={info.root.total * 1024} format={formatBytes} />
            )}
            {info.tmp !== undefined && <Meter label="Temporary (/tmp, in RAM)" used={info.tmp.used * 1024} total={info.tmp.total * 1024} format={formatBytes} />}
            {stats.conntrack.count !== null && stats.conntrack.max !== null && (
              <Meter label="Tracked connections" used={stats.conntrack.count} total={stats.conntrack.max} format={(n) => formatNumber(n)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeading icon={NetworkIcon} title="Addresses" />
          <CardContent className="divide-y">
            <InfoRow label="LAN">{ipv4(lan) ?? '—'}</InfoRow>
            <InfoRow label="WAN IPv4">{ipv4(wan) ?? (wan?.up === true ? 'none' : 'not connected')}</InfoRow>
            <InfoRow label="WAN IPv6">{wan6 === undefined ? '—' : `${wan6.address}/${String(wan6.mask)}`}</InfoRow>
            <InfoRow label="DNS servers">{wan?.['dns-server']?.join(', ') ?? '—'}</InfoRow>
          </CardContent>
        </Card>

        {stats.temperatures.length > 0 && (
          <Card>
            <CardHeading icon={ThermometerIcon} title="Temperatures" />
            <CardContent className="divide-y">
              {stats.temperatures.map((t) => (
                <InfoRow key={t.name} label={t.name}>
                  <span className={cn(t.celsius >= 85 ? 'text-destructive' : t.celsius >= 70 && 'text-warning')}>
                    {t.celsius.toFixed(1)} °C
                  </span>
                </InfoRow>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
