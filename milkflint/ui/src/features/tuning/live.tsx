// Performance tuning's live views, every 2 s: each CPU and the network work
// it does, and how long each network thread waits for a CPU (the kernel's
// scheduler statistics). Read only: they show what the settings lead to.
import type { ReactElement } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { CpuLanes, RssTable } from '@/components/cpu-lanes';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { NetworkLive } from '@/hooks/use-network-live';
import { formatNumber, formatPercent } from '@/lib/format';
import { cpuText, pathSentence } from '@/lib/network-text';
import type { TuningStatus } from './api';
import { spreadBadge } from './model';

export function WorkCard({ live }: { live: { data: NetworkLive | undefined; error: unknown } }): ReactElement {
  const { data, error } = live;
  const badge = data === undefined ? undefined : spreadBadge(data);
  return (
    <Card>
      <CardHeading
        title="Where the work runs"
        description="Live, every 2 s: each CPU and the network work it does. Hover an item for what it is."
        action={badge !== undefined && <Badge variant={badge.variant}>{badge.text}</Badge>}
      />
      <CardContent className="flex flex-col gap-4">
        {data === undefined ? (
          <p className="text-sm text-muted-foreground">{error === undefined ? 'Loading…' : 'Not available on this router.'}</p>
        ) : (
          <>
            <p className="text-sm">{pathSentence(data)}</p>
            <RssTable live={data} />
            <CpuLanes live={data} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** "85 µs", "1.2 ms" */
function usText(us: number): string {
  return us < 1000 ? `${formatNumber(us)} µs` : `${formatNumber(us / 1000, us < 10_000 ? 1 : 0)} ms`;
}

/** ms of waiting per second */
function waitingText(share: number): string {
  const ms = share * 1000;
  return `${formatNumber(ms, ms < 10 ? 1 : 0)} ms/s`;
}

/**
 * How long each network thread waits for a CPU while other work holds it
 * (the kernel's scheduler statistics, /proc/<pid>/schedstat), live. Read
 * only: the kernel is built without preemption, as OpenWrt's.
 */
export function WaitsCard({ status, live }: { status: TuningStatus | undefined; live: NetworkLive | undefined }): ReactElement {
  const kernel = status?.kernel;
  const threads = live?.threads ?? [];
  return (
    <Card>
      <CardHeading
        title="Waiting for a CPU"
        description="Live, every 2 s: how long each network thread was ready to run while other work held its CPU."
      />
      <CardContent className="flex flex-col gap-3">
        {kernel !== undefined && !kernel.waits ? (
          <p className="text-sm text-muted-foreground">This image’s kernel doesn’t record how long threads wait for a CPU.</p>
        ) : live === undefined ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : threads.length === 0 ? (
          <p className="text-sm text-muted-foreground">No network driver threads on this router.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Thread</TableHead>
                  <TableHead className="text-right">Busy</TableHead>
                  <TableHead className="text-right">Waiting</TableHead>
                  <TableHead className="text-right">Per wake</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {threads.map((t) => (
                  <TableRow key={t.name}>
                    <TableCell className="whitespace-normal">
                      <span className="flex min-w-0 flex-col">
                        <span>{t.role}</span>
                        <span className="text-xs break-all text-muted-foreground tabular">
                          <span className="font-mono">{t.name}</span> · {cpuText(t.cpus)}
                        </span>
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular">{t.load === undefined ? '…' : formatPercent(t.load)}</TableCell>
                    <TableCell className="text-right tabular">{t.waiting === undefined ? '…' : waitingText(t.waiting)}</TableCell>
                    <TableCell className="text-right tabular">
                      {t.waitPerRunUs === undefined ? '…' : usText(t.waitPerRunUs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-xs text-muted-foreground">
              Busy is its share of one CPU; waiting, the time it was ready to run but another thread or softirq work held its CPU;
              per wake, how long that took on average each time it got the CPU.
            </p>
          </>
        )}
        {kernel?.hz !== null && kernel?.hz !== undefined && (
          <div className="border-t">
            <InfoRow label="Kernel ticks">{`${String(kernel.hz)} a second, fixed in the image`}</InfoRow>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
