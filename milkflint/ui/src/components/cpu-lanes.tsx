import { ArrowDownIcon, ArrowUpIcon, EthernetPortIcon, type LucideIcon, SendIcon, ShuffleIcon, WifiIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import type { NetworkLive, QueueNow } from '@/hooks/use-network-live';
import { formatBitrate, formatNumber, formatPercent } from '@/lib/format';
import { cpuText } from '@/lib/network-text';
import { cn } from '@/lib/utils';

// One lane per CPU with what runs on it: the Ethernet's receive rings, its
// send side, the Wi-Fi interrupt and Smart Queue's queues, then a lane for
// what may run on several CPUs (the Wi-Fi threads, queues no ring feeds).

type Tone = 'ring' | 'download' | 'upload' | 'wifi' | 'muted';

const toneClass: Record<Tone, string> = {
  ring: 'border-chart-3/35 bg-chart-3/10 [&_svg]:text-chart-3',
  download: 'border-chart-2/35 bg-chart-2/10 [&_svg]:text-chart-2',
  upload: 'border-chart-1/35 bg-chart-1/10 [&_svg]:text-chart-1',
  wifi: 'border-chart-4/35 bg-chart-4/10 [&_svg]:text-chart-4',
  muted: 'border-border bg-muted/40 [&_svg]:text-muted-foreground',
};

interface Chip {
  key: string;
  icon: LucideIcon;
  tone: Tone;
  title: string;
  detail: string;
  /** nothing flows through it right now */
  idle?: boolean;
  hint?: string;
}

/** 5,700 -> "5.7k/s" */
function perSecond(n: number | undefined): string {
  if (n === undefined) return '—/s';
  return n >= 1000 ? `${formatNumber(n / 1000, 1)}k/s` : `${formatNumber(n)}/s`;
}

/** a thread's CPU use: 0.13 -> "13% CPU" */
function load(n: number | undefined): string {
  return n === undefined ? '— CPU' : `${formatPercent(n)} CPU`;
}

function queueChip(q: QueueNow): Chip {
  const name = q.number === 0 ? 'queue' : `queue ${String(q.number)}`;
  return {
    key: q.key,
    icon: q.download ? ArrowDownIcon : ArrowUpIcon,
    tone: q.download ? 'download' : 'upload',
    title: `${q.download ? 'Download' : 'Upload'} ${name}`,
    detail: `${q.bits === undefined ? '—' : formatBitrate(q.bits)} · ${q.avgDelayUs === undefined ? '—' : `${formatNumber(q.avgDelayUs / 1000, 1)} ms`}`,
    idle: q.bits !== undefined && q.bits < 8_000,
    hint: `Smart Queue (CAKE) on ${q.dev}: its rate now, and the average delay in its busiest tin.`,
  };
}

/** Queues of one direction no ring feeds: one chip for them all. */
function sharedQueues(queues: QueueNow[], download: boolean): Chip | undefined {
  const qs = queues.filter((q) => q.download === download);
  const only = qs[0];
  if (only === undefined) return undefined;
  if (qs.length === 1) return queueChip(only);
  const busy = qs.filter((q) => q.bits !== undefined && q.bits >= 8_000);
  const bits = qs.some((q) => q.bits !== undefined) ? qs.reduce((n, q) => n + (q.bits ?? 0), 0) : undefined;
  return {
    key: `${only.dev} shared`,
    icon: download ? ArrowDownIcon : ArrowUpIcon,
    tone: download ? 'download' : 'upload',
    title: `${download ? 'Download' : 'Upload'}: ${String(busy.length)} of ${String(qs.length)} queues busy`,
    detail: bits === undefined ? '—' : formatBitrate(bits),
    idle: busy.length === 0 && bits !== undefined,
    hint: `Smart Queue’s multi-queue CAKE on ${only.dev}: each queue runs on whichever CPU sends its packets.`,
  };
}

function lanes(live: NetworkLive): { perCpu: Chip[][]; shared: Chip[]; sharedCpus: number[] } {
  const perCpu: Chip[][] = live.cpus.map(() => []);
  const at = (cpu: number | undefined): Chip[] | undefined => (cpu === undefined ? undefined : perCpu[cpu]);
  const shared: Chip[] = [];

  for (const r of live.rings) {
    const flows = r.share;
    const chip: Chip = {
      key: `ring ${String(r.ring)}`,
      icon: EthernetPortIcon,
      tone: 'ring',
      title: `Ring ${String(r.ring)}`,
      detail: flows > 0 ? `${formatPercent(flows)} of flows · ${perSecond(r.irqRate)} · ${load(r.load)}` : 'no flows',
      idle: flows === 0,
      hint: 'An Ethernet receive ring: its interrupt and NAPI thread, the share of flows the RSS table sends it, interrupts a second and its thread’s CPU use.',
    };
    (at(r.cpu) ?? shared).push(chip);
  }
  if (live.send !== undefined) {
    (at(live.send.cpu) ?? shared).push({
      key: 'send',
      icon: SendIcon,
      tone: 'muted',
      title: 'Ethernet send',
      detail: `${perSecond(live.send.irqRate)} · ${load(live.send.load)}`,
      hint: 'The Ethernet’s send-done interrupt and the thread that frees what was sent (to the internet and the wired ports).',
    });
  }
  for (const w of live.wifi.irqs) {
    (at(w.cpu) ?? shared).push({
      key: `wifi irq ${w.name}`,
      icon: WifiIcon,
      tone: 'wifi',
      title: 'Wi-Fi interrupt',
      detail: perSecond(w.irqRate),
      hint: `The Wi-Fi chip’s interrupt (${w.name}); it wakes the Wi-Fi threads.`,
    });
  }
  for (const q of live.queues.filter((x) => x.cpu !== undefined)) at(q.cpu)?.push(queueChip(q));

  if (live.wifi.threads > 0) {
    shared.push({
      key: 'wifi threads',
      icon: WifiIcon,
      tone: 'wifi',
      title: `Wi-Fi threads (${String(live.wifi.threads)})`,
      detail: live.wifi.load === undefined ? '— CPU' : `${formatNumber(live.wifi.load, 2)} CPUs`,
      hint: `The Wi-Fi driver’s receive, send-done and transmit threads, on ${cpuText(live.wifi.cpus)}.`,
    });
  }
  const unpinned = live.queues.filter((q) => q.cpu === undefined);
  for (const download of [true, false]) {
    const chip = sharedQueues(unpinned, download);
    if (chip !== undefined) shared.push(chip);
  }
  if (live.rps.length > 0) {
    shared.push({
      key: 'rps',
      icon: ShuffleIcon,
      tone: 'muted',
      title: 'Packet steering (RPS)',
      detail: `to ${cpuText(live.rps)}`,
      hint: 'What the wired ports receive is handed on to these CPUs by flow, in software.',
    });
  }
  const sharedCpus = [...new Set([...live.wifi.cpus, ...live.rps])].sort((a, b) => a - b);
  return { perCpu, shared, sharedCpus };
}

function ChipView({ chip }: { chip: Chip }): ReactElement {
  const Icon = chip.icon;
  return (
    <div
      title={chip.hint}
      className={cn('flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-xs', toneClass[chip.tone], chip.idle === true && 'opacity-55')}
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="font-medium whitespace-nowrap">{chip.title}</span>
      <span className="truncate text-muted-foreground tabular">{chip.detail}</span>
    </div>
  );
}

function LoadBar({ busy, network }: { busy: number | undefined; network: number | undefined }): ReactElement {
  return (
    <div className="flex h-2 overflow-hidden rounded-full bg-muted">
      <div className="h-full bg-chart-2 transition-all duration-500" style={{ width: `${String((network ?? 0) * 100)}%` }} />
      <div className="h-full bg-chart-1/70 transition-all duration-500" style={{ width: `${String(((busy ?? 0) - (network ?? 0)) * 100)}%` }} />
    </div>
  );
}

/** The RSS table as a bar: each ring's share of the flows. */
export function RssTable({ live }: { live: NetworkLive }): ReactElement | null {
  if (live.rss === undefined) return null;
  const total = live.rss.table.reduce((n, x) => n + x, 0);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between gap-2 text-xs text-muted-foreground">
        <span>RSS table: which ring each flow’s hash picks</span>
        <span className="tabular">
          {formatNumber(total)} entries{live.rss.hash === undefined ? '' : ` · ${live.rss.hash}`}
        </span>
      </div>
      <div className="flex h-6 gap-0.5 overflow-hidden rounded-md">
        {live.rss.table.map((n, ring) =>
          n === 0 ? null : (
            <div
              key={ring}
              className={cn(
                'flex min-w-0 items-center justify-center text-[11px] font-medium tabular',
                ring === 0 ? 'bg-muted text-muted-foreground' : 'bg-chart-3/20 text-chart-3',
              )}
              style={{ flexGrow: n }}
              title={`Ring ${String(ring)}: ${String(n)} of ${String(total)} entries`}
            >
              <span className="truncate px-1">
                Ring {ring} · {formatPercent(n / total)}
              </span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/** One lane per CPU, then the shared lane, then a legend. */
export function CpuLanes({ live }: { live: NetworkLive }): ReactElement {
  const { perCpu, shared, sharedCpus } = lanes(live);
  return (
    <div className="flex flex-col gap-2">
      {live.cpus.map((c, i) => (
        <div key={c.cpu} className="grid gap-2 rounded-lg border bg-background/60 p-2.5 sm:grid-cols-[7.5rem_1fr] sm:items-center">
          <div className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">CPU {c.cpu}</span>
              <span className="text-xs tabular text-muted-foreground">{c.busy === undefined ? '—' : formatPercent(c.busy)}</span>
            </div>
            <LoadBar busy={c.busy} network={c.network} />
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {(perCpu[i] ?? []).length === 0 ? (
              <span className="text-xs text-muted-foreground">nothing of the network’s pinned here</span>
            ) : (
              (perCpu[i] ?? []).map((chip) => <ChipView key={chip.key} chip={chip} />)
            )}
          </div>
        </div>
      ))}
      {shared.length > 0 && (
        <div className="grid gap-2 rounded-lg border border-dashed p-2.5 sm:grid-cols-[7.5rem_1fr] sm:items-center">
          <div className="flex flex-col text-sm">
            <span className="font-medium">Shared</span>
            <span className="text-xs text-muted-foreground">{sharedCpus.length > 0 ? cpuText(sharedCpus) : 'any CPU'}</span>
          </div>
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {shared.map((chip) => (
              <ChipView key={chip.key} chip={chip} />
            ))}
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-2" /> Network work (forwarding, NAT, CAKE)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-chart-1/70" /> Everything else
        </span>
      </div>
    </div>
  );
}
