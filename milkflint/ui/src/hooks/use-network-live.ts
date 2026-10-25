// What the router's CPUs are doing for the network, live: the Ethernet's
// receive rings and RSS table, its send side, the Wi-Fi driver, RPS and
// Smart Queue's queues, and which CPU each one runs on. Shared by the
// Performance Tuning and Smart Queue pages.
import { useRef } from 'react';
import { usePoll } from '@/hooks/use-poll';
import { getPipeline, type NetThread, type Pipeline } from '@/lib/api/pipeline';
import { type CakeQdisc, type CakeTin, getSqmStatus } from '@/lib/api/stats';
import { isVpnShaper } from '@/features/vpn-client/sections';
import { isGuestShaper } from '@/features/wifi-guest/guest';

/** clock ticks per second in /proc/<pid>/stat (USER_HZ) */
const TICKS = 100;

export interface CpuNow {
  cpu: number;
  /** share of the time busy, and busy in softirq (forwarding, NAT, CAKE) */
  busy: number | undefined;
  network: number | undefined;
}

export interface RingNow {
  ring: number;
  /** where its NAPI thread runs, when that's one CPU (else its interrupt's) */
  cpu: number | undefined;
  /** interrupts a second */
  irqRate: number | undefined;
  /** its NAPI thread's CPU use, in CPUs */
  load: number | undefined;
  /** its share of the RSS table: the flows it gets */
  share: number;
}

export interface QueueNow {
  key: string;
  dev: string;
  download: boolean;
  /** cake_mq's sub-queue number (its transmit queue + 1); 0 for a plain cake */
  number: number;
  bits: number | undefined;
  avgDelayUs: number | undefined;
  flows: number;
  /** the CPU it runs on, when the RSS ring that feeds it is pinned to one */
  cpu: number | undefined;
}

export interface ThreadNow {
  /** the kernel's name (napi/mtk_eth-7, mt76-tx phy0) */
  name: string;
  /** what it does, in words */
  role: string;
  /** where it may run */
  cpus: number[];
  /** its CPU use, in CPUs */
  load: number | undefined;
  /** the share of the time it was ready to run but waited for a CPU */
  waiting: number | undefined;
  /** how long it waited, on average, each time it got a CPU: µs */
  waitPerRunUs: number | undefined;
}

export interface NetworkLive {
  cpus: CpuNow[];
  /** undefined: this router (or image) has no RSS */
  rss: { table: number[]; hash: string | undefined; spreading: boolean } | undefined;
  rings: RingNow[];
  send: { cpu: number | undefined; irqRate: number | undefined; load: number | undefined } | undefined;
  wifi: {
    irqs: { name: string; cpu: number | undefined; irqRate: number | undefined }[];
    /** the driver's threads: where they may run, and their CPU use in all */
    cpus: number[];
    load: number | undefined;
    threads: number;
  };
  /** the CPUs the wired ports' packets are spread over by RPS; empty: none */
  rps: number[];
  /** every network thread, with how long it waits for a CPU; empty when the kernel doesn't record it */
  threads: ThreadNow[];
  queues: QueueNow[];
  /** CAKE's statistics as tc gives them, and each qdisc's rate in bit/s by queueKey() */
  qdiscs: CakeQdisc[];
  rates: Map<string, number | undefined>;
}

interface Sample {
  at: number;
  pipeline: Pipeline;
  bytes: Map<string, number>;
}

const single = (cpus: readonly number[]): number | undefined => (cpus.length === 1 ? cpus[0] : undefined);

// mt76 makes a NAPI thread per receive ring in its ring order, so with the
// MT7986's six rings (no WED) the threads, by id, are: band 0's data (2.4
// GHz), the two firmware event rings, band 1's data (5 GHz), band 1's
// send-done ring (unused on the MT7986) and the send-done ring both bands
// use. Other chips have other rings: their threads keep their names.
const MT7986_RINGS = ['2.4 GHz receive', 'firmware messages', 'firmware messages (WA)', '5 GHz receive', 'idle ring', 'send-done, both bands'];

/** Words for each network thread, by its kernel name. */
function threadRoles(p: Pipeline): Map<string, string> {
  const roles = new Map<string, string>();
  for (const r of p.rings) if (r.thread !== null) roles.set(r.thread.name, `Ethernet ring ${String(r.ring)}`);
  if (p.tx.thread !== null) roles.set(p.tx.thread.name, 'Ethernet send-done');
  for (const t of p.eth_threads) roles.set(t.name, 'Ethernet');
  const napi = new Map<string, { id: number; name: string }[]>();
  for (const t of p.wifi.threads) {
    const m = /^(napi\/phy\d+)-(\d+)$/.exec(t.name);
    if (m?.[1] !== undefined && m[2] !== undefined) napi.set(m[1], [...(napi.get(m[1]) ?? []), { id: Number(m[2]), name: t.name }]);
    else if (t.name.startsWith('mt76-tx')) roles.set(t.name, 'Wi-Fi transmit');
  }
  for (const list of napi.values()) {
    const sorted = list.sort((a, b) => a.id - b.id);
    sorted.forEach((t, i) => {
      roles.set(t.name, `Wi-Fi ${sorted.length === MT7986_RINGS.length ? (MT7986_RINGS[i] ?? 'ring') : 'receive ring'}`);
    });
  }
  return roles;
}
export const queueKey = (q: CakeQdisc): string => `${q.dev} ${q.parent ?? q.handle ?? ''}`;

/** the busiest tin of a cake: its delays are the queue's */
function busiest(q: CakeQdisc): CakeTin | undefined {
  return (q.tins ?? []).reduce<CakeTin | undefined>((best, t) => ((t.sent_bytes ?? 0) > (best?.sent_bytes ?? -1) ? t : best), undefined);
}

function compute(now: Sample, before: Sample | undefined, qdiscs: CakeQdisc[]): NetworkLive {
  const seconds = before === undefined ? 0 : (now.at - before.at) / 1000;
  const rate = (a: number | undefined, b: number | undefined): number | undefined =>
    a === undefined || b === undefined || seconds <= 0 ? undefined : Math.max(0, a - b) / seconds;
  const p = now.pipeline;
  const old = before?.pipeline;
  const threadLoad = (t: NetThread | null | undefined, was: NetThread | null | undefined): number | undefined => {
    const r = rate(t?.time, was?.name === t?.name ? was?.time : undefined);
    return r === undefined ? undefined : r / TICKS;
  };

  const cpuBefore = new Map(old?.cpu.map((c) => [c.name, c]));
  const cpus = p.cpu
    .filter((c) => c.name !== 'cpu')
    .map((c, i): CpuNow => {
      const b = cpuBefore.get(c.name);
      const total = c.total - (b?.total ?? c.total);
      if (b === undefined || total <= 0) return { cpu: i, busy: undefined, network: undefined };
      const busy = Math.max(0, Math.min(1, 1 - (c.idle - b.idle) / total));
      const network = Math.max(0, Math.min(busy, ((c.softirq ?? 0) - (b.softirq ?? 0)) / total));
      return { cpu: i, busy, network };
    });

  const table = p.rss?.table ?? [];
  const entries = table.reduce((n, x) => n + x, 0);
  // RSS is at work when the table sends flows anywhere but ring 0, where
  // everything lands without it
  const spreading = table.some((x, ring) => ring > 0 && x > 0);
  const rings = p.rings.map((r): RingNow => {
    const was = old?.rings.find((x) => x.ring === r.ring);
    return {
      ring: r.ring,
      cpu: single(r.thread?.cpus ?? []) ?? single(r.irq?.cpus ?? []),
      irqRate: rate(r.irq?.count, was?.irq?.count),
      load: threadLoad(r.thread, was?.thread),
      share: entries > 0 ? (table[r.ring] ?? 0) / entries : r.ring === 0 ? 1 : 0,
    };
  });

  const allThreads = (x: Pipeline | undefined): NetThread[] =>
    x === undefined
      ? []
      : [
          ...[x.tx.thread, ...x.rings.map((r) => r.thread)].filter((t): t is NetThread => t !== null),
          ...x.eth_threads,
          ...x.wifi.threads,
        ];
  const oldThreads = new Map(allThreads(old).map((t) => [t.name, t]));
  const roles = threadRoles(p);
  // the Ethernet's threads as listed, then the Wi-Fi rings by NAPI id, then its transmit thread
  const order = (t: NetThread, i: number): number => {
    const napi = /^napi\/phy\d+-(\d+)$/.exec(t.name)?.[1];
    return napi !== undefined ? 1e6 + Number(napi) : t.name.startsWith('mt76-tx') ? 2e6 + i : i;
  };
  const threads = allThreads(p)
    .map((t, i) => ({ t, key: order(t, i) }))
    .sort((a, b) => a.key - b.key)
    .map(({ t }) => t)
    .filter((t) => typeof t.wait === 'number')
    .map((t): ThreadNow => {
      const was = oldThreads.get(t.name);
      const waited = rate(t.wait ?? undefined, was?.wait ?? undefined);
      const runs = (t.runs ?? 0) - (was?.runs ?? t.runs ?? 0);
      const waitedNs = (t.wait ?? 0) - (was?.wait ?? t.wait ?? 0);
      return {
        name: t.name,
        role: roles.get(t.name) ?? t.name,
        cpus: t.cpus,
        load: threadLoad(t, was),
        waiting: waited === undefined ? undefined : Math.min(1, waited / 1e9),
        // a thread that waited all along without getting a CPU has no average yet
        waitPerRunUs: was === undefined ? undefined : runs > 0 ? Math.max(0, waitedNs) / runs / 1000 : waitedNs > 0 ? undefined : 0,
      };
    });

  const wifiCpus = [...new Set(p.wifi.threads.flatMap((t) => t.cpus))].sort((a, b) => a - b);
  const wifiLoads = p.wifi.threads.map((t) => threadLoad(t, old?.wifi.threads.find((x) => x.name === t.name)));

  const rss = p.rss === null ? undefined : { table, hash: p.rss.hash ?? undefined, spreading };
  const ringCpu = (txq: number): number | undefined => (rss?.spreading === true ? rings.find((r) => r.ring === txq)?.cpu : undefined);
  const queues: QueueNow[] = [];
  // the internet's queues: Guest Wi-Fi's speed limit is a CAKE too
  for (const root of qdiscs.filter((q) => !isGuestShaper(q.dev) && !isVpnShaper(q.dev))) {
    const download = root.dev.startsWith('ifb');
    if (root.kind === 'cake_mq') {
      const major = root.handle ?? '';
      for (const q of qdiscs.filter((x) => x.kind === 'cake' && x.dev === root.dev && x.parent?.startsWith(major) === true)) {
        const number = parseInt(q.parent?.split(':')[1] ?? '0', 16);
        const key = queueKey(q);
        queues.push({
          key,
          dev: q.dev,
          download,
          number,
          bits: ((r) => (r === undefined ? undefined : r * 8))(rate(now.bytes.get(key), before?.bytes.get(key))),
          avgDelayUs: busiest(q)?.avg_delay_us,
          flows: (q.tins ?? []).reduce((n, t) => n + (t.sparse_flows ?? 0) + (t.bulk_flows ?? 0), 0),
          // the ifb's transmit queue N carries what ring N received
          cpu: download ? ringCpu(number - 1) : undefined,
        });
      }
    } else if (root.parent === undefined) {
      const key = queueKey(root);
      queues.push({
        key,
        dev: root.dev,
        download,
        number: 0,
        bits: ((r) => (r === undefined ? undefined : r * 8))(rate(now.bytes.get(key), before?.bytes.get(key))),
        avgDelayUs: busiest(root)?.avg_delay_us,
        flows: (root.tins ?? []).reduce((n, t) => n + (t.sparse_flows ?? 0) + (t.bulk_flows ?? 0), 0),
        cpu: undefined,
      });
    }
  }

  return {
    cpus,
    rss,
    rings,
    send:
      p.tx.irq === null && p.tx.thread === null
        ? undefined
        : {
            cpu: single(p.tx.thread?.cpus ?? []) ?? single(p.tx.irq?.cpus ?? []),
            irqRate: rate(p.tx.irq?.count, old?.tx.irq?.count),
            load: threadLoad(p.tx.thread, old?.tx.thread),
          },
    wifi: {
      irqs: p.wifi.irqs.map((i) => ({
        name: i.name,
        cpu: single(i.cpus),
        irqRate: rate(i.count, old?.wifi.irqs.find((x) => x.irq === i.irq)?.count),
      })),
      cpus: wifiCpus,
      load: wifiLoads.some((l) => l === undefined) ? undefined : wifiLoads.reduce<number>((n, l) => n + (l ?? 0), 0),
      threads: p.wifi.threads.length,
    },
    rps: [...new Set(p.rps.flatMap((d) => d.queues.flat()))].sort((a, b) => a - b),
    threads,
    queues: queues.sort((a, b) => {
      if (a.download !== b.download) return a.download ? -1 : 1;
      const dev = a.dev.localeCompare(b.dev);
      return dev !== 0 ? dev : a.number - b.number;
    }),
    qdiscs,
    rates: new Map(
      qdiscs.map((q) => {
        const r = rate(now.bytes.get(queueKey(q)), before?.bytes.get(queueKey(q)));
        return [queueKey(q), r === undefined ? undefined : r * 8];
      }),
    ),
  };
}

async function fetchSample(): Promise<{ pipeline: Pipeline; qdiscs: CakeQdisc[] }> {
  const [pipeline, sqm] = await Promise.all([getPipeline(), getSqmStatus().catch(() => ({ qdiscs: [] as CakeQdisc[] }))]);
  return { pipeline, qdiscs: sqm.qdiscs };
}

/** Polls every `intervalMs`; rates need two samples, so the first result has none. */
export function useNetworkLive(intervalMs = 2000): { data: NetworkLive | undefined; error: unknown } {
  const prev = useRef<Sample>(undefined);
  const { data, error } = usePoll(async (): Promise<NetworkLive> => {
    const { pipeline, qdiscs } = await fetchSample();
    const sample: Sample = { at: performance.now(), pipeline, bytes: new Map(qdiscs.map((q) => [queueKey(q), q.bytes ?? 0])) };
    const live = compute(sample, prev.current, qdiscs);
    prev.current = sample;
    return live;
  }, intervalMs);
  return { data, error };
}
