// Performance tuning's live views, every 2 s: each CPU and the network work
// it does, and how long each network thread waits for a CPU (the kernel's
// scheduler statistics). Read only: they show what the settings lead to.
import type { ReactElement } from 'react';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { CpuLanes, RssTable } from '@/components/cpu-lanes';
import { type Column, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import type { NetworkLive, ThreadNow } from '@/hooks/use-network-live';
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

const figure = 'text-right whitespace-nowrap tabular';

/** The threads as listed (Ethernet's, then Wi-Fi's rings and its sending thread); nothing sorts, as live rows would jump. */
const threadColumns: readonly Column<ThreadNow>[] = [
  {
    label: 'Thread',
    cell: (t) => (
      <span className="flex min-w-0 flex-col">
        <span>{t.role}</span>
        <span className="text-xs break-all text-muted-foreground tabular">
          <span className="font-mono">{t.name}</span> · {cpuText(t.cpus)}
        </span>
      </span>
    ),
  },
  { label: 'Busy', cell: (t) => (t.load === undefined ? '…' : formatPercent(t.load)), className: figure },
  { label: 'Waiting', cell: (t) => (t.waiting === undefined ? '…' : waitingText(t.waiting)), className: figure },
  { label: 'Per wake', cell: (t) => (t.waitPerRunUs === undefined ? '…' : usText(t.waitPerRunUs)), className: figure },
];

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
            <DataTable
              label="Network threads"
              columns={threadColumns}
              rows={threads}
              rowKey={(t) => t.name}
              empty="No network driver threads on this router."
              framed={false}
              cards={false}
            />
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
