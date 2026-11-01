// A run's figures from its raw parts: the members' records, the router's
// pings (probes.jsonl) and its once-a-second samples (router.jsonl), each
// cut to a phase's window by the router's clock, which every part shares.
import { z } from 'zod';
import type { Phase, PhaseKind } from './api';
import type { RunRecord } from './member';

// ---- Statistics ----

/** The p-th percentile (0..1) of sorted values, interpolated between neighbours. */
export function percentile(sorted: readonly number[], p: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const i = (sorted.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(i);
  const a = sorted[lo] ?? 0;
  const b = sorted[Math.min(sorted.length - 1, lo + 1)] ?? a;
  return a + (b - a) * (i - lo);
}

export interface RttSample {
  /** router ms the probe went */
  t: number;
  /** its time; null: no answer (lost, or too late) */
  ms: number | null;
}

export interface RttStats {
  sent: number;
  lost: number;
  median: number | undefined;
  p95: number | undefined;
  p99: number | undefined;
  max: number | undefined;
  /** the mean change between one answer and the next, ms */
  jitter: number | undefined;
}

export function rttStats(samples: readonly RttSample[]): RttStats {
  const ordered = [...samples].sort((a, b) => a.t - b.t);
  const answered = ordered.flatMap((s) => (s.ms === null ? [] : [s.ms]));
  const sorted = [...answered].sort((a, b) => a - b);
  let jitter: number | undefined;
  if (answered.length > 1) {
    let sum = 0;
    for (let i = 1; i < answered.length; i++) sum += Math.abs((answered[i] ?? 0) - (answered[i - 1] ?? 0));
    jitter = sum / (answered.length - 1);
  }
  return {
    sent: samples.length,
    lost: samples.length - answered.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted[sorted.length - 1],
    jitter,
  };
}

// ---- Phases ----

/** A run as the report needs it: when it began and was to end, and how it ended (router ms). */
export interface ReportRun {
  t0: number;
  end: number;
  ended?: { reason: string; at: number; by?: string | null | undefined } | null | undefined;
}

/** Phases that load the network (a DNS phase only browses). */
export const LOAD_KINDS: ReadonlySet<PhaseKind> = new Set(['wan_down', 'wan_up', 'wan_both', 'd2d', 'household']);
/** Phases that load the internet line. */
export const WAN_KINDS: ReadonlySet<PhaseKind> = new Set(['wan_down', 'wan_up', 'wan_both', 'household']);

export interface PhaseWindow {
  index: number;
  phase: Phase;
  /** router ms */
  from: number;
  to: number;
}

/** Loads take a moment to fill the line: their first seconds are left out of a phase's figures. */
export const RAMP_MS = 2000;

/** Each phase's window, without the first RAMP_MS of a load phase. */
export function phaseWindows(t0: number, phases: readonly Phase[], ramp: number = RAMP_MS): PhaseWindow[] {
  return phases.map((phase, index) => {
    const start = t0 + phase.start;
    const loaded = phase.kind !== 'idle' && phase.kind !== 'cooldown' && phase.kind !== 'connect';
    return { index, phase, from: start + Math.min(loaded ? ramp : 0, phase.dur / 2), to: start + phase.dur };
  });
}

/** The phases the run reached, each cut at its end (a run stopped early). */
export function runWindows(run: ReportRun, phases: readonly Phase[], ramp: number = RAMP_MS): PhaseWindow[] {
  const end = run.ended?.at ?? run.end;
  return phaseWindows(run.t0, phases, ramp)
    .filter((w) => w.from < end)
    .map((w) => ({ ...w, to: Math.min(w.to, end) }));
}

const inside = (t: number, w: { from: number; to: number }): boolean => t >= w.from && t < w.to;

// ---- A member's records ----

/** A member's probes to the router ('r') or the internet ('w'), by when they went. */
export function memberRtts(records: readonly RunRecord[], target: 'r' | 'w', w?: { from: number; to: number }): RttSample[] {
  const out: RttSample[] = [];
  for (const r of records) {
    if (r[0] === 'rtt' && r[1] === target && (w === undefined || inside(r[3], w))) out.push({ t: r[3], ms: r[4] });
  }
  return out;
}

export interface Throughput {
  /** the window's average, Mbit/s */
  mbit: number;
  /** its busiest second, Mbit/s */
  peak: number;
  bytes: number;
}

/** A member's download ('d') or upload ('u') in a window; undefined if it moved nothing. */
export function memberThroughput(records: readonly RunRecord[], dir: 'd' | 'u', w: { from: number; to: number }): Throughput | undefined {
  let bytes = 0;
  const perSecond = new Map<number, number>();
  for (const r of records) {
    if (r[0] !== 'tp' || r[1] !== dir || !inside(r[2], w)) continue;
    bytes += r[3];
    const s = Math.floor((r[2] - w.from) / 1000);
    perSecond.set(s, (perSecond.get(s) ?? 0) + r[3]);
  }
  if (bytes === 0) return undefined;
  const secs = Math.max(0.001, (w.to - w.from) / 1000);
  let peak = 0;
  for (const b of perSecond.values()) peak = Math.max(peak, b);
  return { mbit: (bytes * 8) / secs / 1e6, peak: (peak * 8) / 1e6, bytes };
}

/** Cloudflare's view of a member's transfers in a window: its median RTT, and retransmits and losses in all. */
export function serverView(records: readonly RunRecord[], w: { from: number; to: number }): { rtt: number | undefined; retrans: number; lost: number; n: number } {
  const rtts: number[] = [];
  let retrans = 0;
  let lost = 0;
  for (const r of records) {
    if (r[0] !== 'cf' || !inside(r[1], w)) continue;
    rtts.push(r[2]);
    retrans += r[4];
    lost += r[5];
  }
  rtts.sort((a, b) => a - b);
  return { rtt: percentile(rtts, 0.5), retrans, lost, n: rtts.length };
}

// ---- The router's pings ----

const probeLine = z.object({ t: z.number(), r: z.record(z.string(), z.array(z.tuple([z.number(), z.number(), z.number().nullable()]))) });
export type ProbeLine = z.output<typeof probeLine>;

export function parseLines<T>(lines: readonly string[], schema: z.ZodType<T>): T[] {
  const out: T[] = [];
  for (const l of lines) {
    try {
      const p = schema.safeParse(JSON.parse(l));
      if (p.success) out.push(p.data);
    } catch {
      // a line cut short
    }
  }
  return out;
}

export function parseProbes(lines: readonly string[]): ProbeLine[] {
  return parseLines(lines, probeLine);
}

/** The router's pings to a target (a member's id, 'wan', 'far'), by when they went, each once. */
export function routerRtts(lines: readonly ProbeLine[], key: string, w?: { from: number; to: number }): RttSample[] {
  const seen = new Set<number>();
  const out: RttSample[] = [];
  for (const l of lines) {
    for (const [n, sent, ms] of l.r[key] ?? []) {
      if (seen.has(n) || (w !== undefined && !inside(sent, w))) continue;
      seen.add(n);
      out.push({ t: sent, ms });
    }
  }
  return out;
}

// ---- The router's samples ----

const cakeTin = z.tuple([z.number(), z.number(), z.number(), z.number(), z.number(), z.number(), z.number()]).rest(z.number());
const cakeQdisc = z.tuple([z.number(), z.number(), z.number(), z.number(), z.array(cakeTin)]);
/** A member's Wi-Fi station: its rates and signal, and counters so far (tx packets, retries, failed, rx packets, tx bytes, rx bytes, airtime tx, rx µs). */
const station = z.object({
  dev: z.string().nullish(),
  signal: z.number().nullish(),
  tx_mbit: z.number().nullish(),
  rx_mbit: z.number().nullish(),
  c: z.array(z.number().nullable()).catch([]),
  /** what AQL has queued for it, µs */
  aql: z.number().nullish(),
});
const routerLine = z.object({
  t: z.number(),
  dt: z.number().optional(),
  /** the first sample's: the WAN port (Smart Queue's download queue is on ifb4<it>) */
  wan: z.string().optional().catch(undefined),
  /** per CPU, shares of its time: busy, softirq, irq */
  cpu: z.array(z.tuple([z.number(), z.number(), z.number()]).nullable()).optional(),
  /** per CPU: NET_RX and NET_TX softirqs */
  sirq: z.array(z.array(z.number().nullable())).optional().catch(undefined),
  /** per CPU, softnet: processed, dropped, squeezed */
  sn: z.array(z.array(z.number().nullable())).optional(),
  /** per interface: rx bytes, tx bytes, rx packets, tx packets, rx drops, tx drops, rx errors, tx errors */
  if: z.record(z.string(), z.array(z.number().nullable())).optional(),
  /** the threads that move packets, and the bench's way in: shares of a CPU, by name */
  th: z.record(z.string(), z.number()).optional().catch(undefined),
  cake: z.record(z.string(), cakeQdisc).catch({}),
  /** connections tracked */
  ct: z.number().optional().catch(undefined),
  /** CPU shares of the recorder, the prober and bench-dns */
  self: z.array(z.number()).optional(),
  /** every 2 s: the members' stations, and per AP its stations' counters summed */
  wifi: z
    .object({ sta: z.record(z.string(), station).catch({}), ap: z.record(z.string(), z.array(z.number())).catch({}) })
    .optional()
    .catch(undefined),
  /** the connection scan: tracked, offloaded, and per member (to the router itself left out) flows, offloaded, TCP, UDP, established */
  ct_scan: z.object({ n: z.number(), off: z.number(), m: z.record(z.string(), z.array(z.number())).catch({}), ms: z.number().optional() }).nullish(),
  /** every 5 s: the Ethernet driver's drop and error counters, so far */
  eth: z.record(z.string(), z.record(z.string(), z.number())).optional().catch(undefined),
  /** every 5 s: dnsmasq's counters, so far */
  dns: z.record(z.string(), z.number()).optional().catch(undefined),
  cost_ms: z.number().optional(),
});
export type RouterLine = z.output<typeof routerLine>;

export function parseRouter(lines: readonly string[]): RouterLine[] {
  return parseLines(lines, routerLine);
}

export interface RouterWindow {
  /** the busiest CPU's busy share: its 95th percentile and highest second */
  cpuP95: number | undefined;
  cpuMax: number | undefined;
  /** Smart Queue, each way: the busiest tin's highest average and peak delay (ms), and drops and ECN marks in the window */
  down: CakeWindow | undefined;
  up: CakeWindow | undefined;
  /** softnet: packets dropped from a CPU's backlog, and the times NAPI ran out of budget */
  softnetDrops: number;
  squeezed: number;
  /** the recorder's own CPU, the prober's and bench-dns's: average shares of one CPU */
  self: number | undefined;
  prober: number | undefined;
  dns: number | undefined;
}

export interface CakeWindow {
  avgMs: number;
  peakMs: number;
  drops: number;
  marks: number;
}

/** What the router did in a window. Smart Queue downloads through an ifb device (ifb4<WAN>), uploads on the WAN port. */
export function routerWindow(lines: readonly RouterLine[], w: { from: number; to: number }): RouterWindow {
  const busiest: number[] = [];
  let softnetDrops = 0;
  let squeezed = 0;
  let self = 0;
  let prober = 0;
  let dns = 0;
  let selfN = 0;
  const cake: Record<'down' | 'up', CakeWindow | undefined> = { down: undefined, up: undefined };
  // counters per qdisc and tin, at the window's first sample and its last
  const first = new Map<string, number[]>();
  const last = new Map<string, number[]>();
  for (const l of lines) {
    if (!inside(l.t, w)) continue;
    const cpus = (l.cpu ?? []).flatMap((c) => (c === null ? [] : [c[0]]));
    if (cpus.length > 0) busiest.push(Math.max(...cpus));
    for (const c of l.sn ?? []) {
      softnetDrops += c[1] ?? 0;
      squeezed += c[2] ?? 0;
    }
    if (l.self !== undefined) {
      self += l.self[0] ?? 0;
      prober += l.self[1] ?? 0;
      dns += l.self[2] ?? 0;
      selfN++;
    }
    for (const [key, q] of Object.entries(l.cake)) {
      const dir = key.startsWith('ifb') ? 'down' : 'up';
      const c = (cake[dir] ??= { avgMs: 0, peakMs: 0, drops: 0, marks: 0 });
      q[4].forEach((tin, i) => {
        c.avgMs = Math.max(c.avgMs, tin[6] / 1000);
        c.peakMs = Math.max(c.peakMs, tin[5] / 1000);
        const k = `${key} ${String(i)}`;
        if (!first.has(k)) first.set(k, [tin[1], tin[2], dir === 'down' ? 1 : 0]);
        last.set(k, [tin[1], tin[2], dir === 'down' ? 1 : 0]);
      });
    }
  }
  // drops and marks are counters: the window's are its last sample's less its first's
  for (const [k, b] of last) {
    const a = first.get(k);
    if (a === undefined) continue;
    const c = b[2] === 1 ? cake.down : cake.up;
    if (c === undefined) continue;
    c.drops += Math.max(0, (b[0] ?? 0) - (a[0] ?? 0));
    c.marks += Math.max(0, (b[1] ?? 0) - (a[1] ?? 0));
  }
  busiest.sort((a, b) => a - b);
  return {
    cpuP95: percentile(busiest, 0.95),
    cpuMax: busiest[busiest.length - 1],
    down: cake.down,
    up: cake.up,
    softnetDrops,
    squeezed,
    self: selfN > 0 ? self / selfN : undefined,
    prober: selfN > 0 ? prober / selfN : undefined,
    dns: selfN > 0 ? dns / selfN : undefined,
  };
}

/** The share of a member's connections the router offloaded (software flow offloading), from the scans in a window. */
export function offloaded(lines: readonly RouterLine[], member: string, w: { from: number; to: number }): { flows: number; offloaded: number } | undefined {
  let flows = 0;
  let off = 0;
  for (const l of lines) {
    if (!inside(l.t, w) || l.ct_scan === null || l.ct_scan === undefined) continue;
    const m = l.ct_scan.m[member];
    if (m === undefined) continue;
    flows += m[0] ?? 0;
    off += m[1] ?? 0;
  }
  return flows === 0 ? undefined : { flows, offloaded: off };
}
