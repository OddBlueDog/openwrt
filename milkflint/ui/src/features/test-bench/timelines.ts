// The run second by second, for the report's timelines and the checks that
// need more than a phase's totals: each device's latency and speeds, and
// from the router's samples its CPU per core, Smart Queue each way, the
// WAN port, connections, softnet and the members' Wi-Fi stations. Times are
// ms from the run's start (t0); a second's point sits in its middle.
import type { Phase } from './api';
import type { RouterLine, RttSample } from './analysis';
import type { RunRecord } from './member';

const palette = ['var(--chart-2)', 'var(--chart-1)', 'var(--chart-3)', 'var(--chart-4)'];
/** A member's colour in the charts: the palette, then paler and deeper mixes of it. */
export function memberColor(i: number): string {
  const c = palette[i % palette.length] ?? 'var(--chart-2)';
  return i < palette.length ? c : `color-mix(in oklab, ${c} ${i < 2 * palette.length ? '55%' : '30%'}, var(--foreground))`;
}

/** [ms from the start, value]; null breaks the line. */
export type TPoint = readonly [number, number | null];

const mid = (sec: number): number => sec * 1000 + 500;

/** One point per second from `by` (second -> value), a gap (null) where seconds are missing. */
function seconds(by: ReadonlyMap<number, number | null>): TPoint[] {
  const keys = [...by.keys()].sort((a, b) => a - b);
  const out: TPoint[] = [];
  let prev: number | undefined;
  for (const s of keys) {
    if (prev !== undefined && s > prev + 1) out.push([mid(prev + 1), null]);
    out.push([mid(s), by.get(s) ?? null]);
    prev = s;
  }
  return out;
}

/** The worst answered probe in each second (null: none answered), and when probes went unanswered. */
export function worstEachSecond(samples: readonly RttSample[], t0: number): { points: TPoint[]; lost: number[] } {
  const by = new Map<number, number | null>();
  const lost: number[] = [];
  for (const x of samples) {
    const sec = Math.floor((x.t - t0) / 1000);
    const v = by.get(sec);
    if (x.ms === null) {
      lost.push(x.t - t0);
      if (v === undefined) by.set(sec, null);
    } else by.set(sec, v === undefined || v === null ? x.ms : Math.max(v, x.ms));
  }
  return { points: seconds(by), lost };
}

/** Whether a member's part in a phase loads the line that way. */
export function loads(role: string | undefined, dir: 'd' | 'u'): boolean {
  return role === 'both' || role === (dir === 'd' ? 'down' : 'up');
}

/**
 * A member's download or upload, Mbit/s each second. Seconds of a phase in
 * which it was to load that way and moved nothing are 0 (it records only
 * what arrived).
 */
export function memberRate(records: readonly RunRecord[], dir: 'd' | 'u', t0: number, phases: readonly Phase[], member: string, end: number): TPoint[] {
  const by = new Map<number, number | null>();
  for (const p of phases) {
    if (!loads(p.roles[member], dir)) continue;
    for (let s = Math.ceil(p.start / 1000); s < Math.floor((p.start + p.dur) / 1000) && t0 + s * 1000 < end; s++) by.set(s, 0);
  }
  for (const r of records) {
    if (r[0] !== 'tp' || r[1] !== dir || r[2] < t0 || r[2] >= end) continue;
    const s = Math.floor((r[2] - t0) / 1000);
    by.set(s, (by.get(s) ?? 0) + (r[3] * 8) / 1e6);
  }
  return seconds(by);
}

/** What a member received from its device-to-device partners, Mbit/s each second. */
export function peerRate(records: readonly RunRecord[], t0: number): TPoint[] {
  const by = new Map<number, number | null>();
  for (const r of records) {
    if (r[0] !== 'pb' || r[2] < t0) continue;
    const s = Math.floor((r[2] - t0) / 1000);
    by.set(s, (by.get(s) ?? 0) + (r[3] * 8) / 1e6);
  }
  return seconds(by);
}

// ---- The router's samples ----

/** The WAN port: the first sample names it; older runs' from Smart Queue's queue on it. */
export function wanPort(lines: readonly RouterLine[]): string | undefined {
  const named = lines.find((l) => l.wan !== undefined)?.wan;
  if (named !== undefined) return named;
  for (const l of lines) for (const k of Object.keys(l.cake)) if (!k.startsWith('ifb')) return k.split(' ')[0];
  return undefined;
}

/** A value per sample, from the router's lines (null where `pick` has none). */
export function routerSeries(lines: readonly RouterLine[], t0: number, pick: (l: RouterLine) => number | null | undefined): TPoint[] {
  const out: TPoint[] = [];
  for (const l of lines) {
    const v = pick(l);
    if (v !== undefined) out.push([l.t - t0, v]);
  }
  return out;
}

/** An interface's rate one way (0: received, 1: sent), Mbit/s. */
export function ifRate(lines: readonly RouterLine[], t0: number, dev: string, i: 0 | 1): TPoint[] {
  return routerSeries(lines, t0, (l) => {
    if (l.dt === undefined || l.dt <= 0) return undefined;
    // an idle interface is left out of a sample: nothing moved
    return ((l.if?.[dev]?.[i] ?? 0) * 8) / l.dt / 1e6;
  });
}

export interface CakeSecond {
  /** ms from the start */
  t: number;
  /** the busiest tin's average and peak delay, of the tins that sent anything this second (undefined: none did) */
  avgMs: number | undefined;
  peakMs: number | undefined;
  /** this second's drops and ECN marks, every tin */
  drops: number;
  marks: number;
  /** queued, bytes */
  backlog: number;
  /** what it sent, Mbit/s */
  mbit: number;
}

/**
 * Smart Queue one way, each second: downloads are the queues on the ifb
 * device, uploads those on the WAN port. With cake_mq, each of its queues
 * is a CAKE of its own, summed here.
 */
export function cakeSeconds(lines: readonly RouterLine[], t0: number, dir: 'down' | 'up'): CakeSecond[] {
  const out: CakeSecond[] = [];
  let prev: RouterLine | undefined;
  for (const l of lines) {
    const keys = Object.keys(l.cake).filter((k) => k.startsWith('ifb') === (dir === 'down'));
    if (keys.length === 0) {
      prev = l;
      continue;
    }
    const was = prev;
    prev = l;
    if (was === undefined || l.dt === undefined || l.dt <= 0) continue;
    const s: CakeSecond = { t: l.t - t0, avgMs: undefined, peakMs: undefined, drops: 0, marks: 0, backlog: 0, mbit: 0 };
    for (const k of keys) {
      const q = l.cake[k];
      const p = was.cake[k];
      if (q === undefined) continue;
      s.backlog += q[3];
      if (p === undefined) continue;
      s.mbit += (Math.max(0, q[0] - p[0]) * 8) / l.dt / 1e6;
      q[4].forEach((tin, i) => {
        const pt = p[4][i];
        if (pt === undefined) return;
        s.drops += Math.max(0, tin[1] - pt[1]);
        s.marks += Math.max(0, tin[2] - pt[2]);
        if (tin[0] > pt[0]) {
          s.avgMs = Math.max(s.avgMs ?? 0, tin[6] / 1000);
          s.peakMs = Math.max(s.peakMs ?? 0, tin[5] / 1000);
        }
      });
    }
    out.push(s);
  }
  return out;
}

/** Each CPU's busy share (and its softirq share) per sample, a row per CPU; each sample covers `spans` (the time since the one before). */
export function cpuRows(lines: readonly RouterLine[], t0: number): { spans: [number, number][]; busy: (number | null)[][]; softirq: (number | null)[][] } {
  const spans: [number, number][] = [];
  const busy: (number | null)[][] = [];
  const softirq: (number | null)[][] = [];
  for (const l of lines) {
    if (l.cpu === undefined) continue;
    const i = spans.length;
    spans.push([l.t - t0 - (l.dt ?? 1) * 1000, l.t - t0]);
    l.cpu.forEach((c, cpu) => {
      busy[cpu] ??= [];
      softirq[cpu] ??= [];
      busy[cpu][i] = c?.[0] ?? null;
      softirq[cpu][i] = c?.[1] ?? null;
    });
  }
  // a CPU missing from a sample: no figure there
  for (const row of [...busy, ...softirq]) for (let i = 0; i < spans.length; i++) row[i] ??= null;
  return { spans, busy, softirq };
}

/** softnet each second, every CPU summed: packets dropped from a backlog (1), and times NAPI ran out of budget (2). */
export function softnetRate(lines: readonly RouterLine[], t0: number, i: 1 | 2): TPoint[] {
  return routerSeries(lines, t0, (l) => (l.sn === undefined || l.dt === undefined || l.dt <= 0 ? undefined : l.sn.reduce((a, c) => a + (c[i] ?? 0), 0) / l.dt));
}

export interface StationSample {
  t: number;
  txMbit: number | null;
  signal: number | null;
  /** what AQL had queued for it, ms */
  aqlMs: number | null;
  /** since the sample before: retries and failed frames, shares of frames sent (null: it sent none) */
  retries: number | null;
  failed: number | null;
  /** frames sent since the sample before */
  frames: number;
}

/** A member's Wi-Fi station every 2 s, as the router saw it (none: it isn't on the router's Wi-Fi). */
export function stationSamples(lines: readonly RouterLine[], t0: number, member: string): StationSample[] {
  const out: StationSample[] = [];
  let prev: number[] | undefined;
  for (const l of lines) {
    const s = l.wifi?.sta[member];
    if (s === undefined) continue;
    const c = s.c.map((x) => x ?? 0);
    const frames = prev === undefined ? 0 : Math.max(0, (c[0] ?? 0) - (prev[0] ?? 0));
    const share = (i: number): number | null => (prev === undefined || frames === 0 ? null : Math.max(0, (c[i] ?? 0) - (prev[i] ?? 0)) / frames);
    out.push({
      t: l.t - t0,
      txMbit: s.tx_mbit ?? null,
      signal: s.signal ?? null,
      aqlMs: s.aql === undefined || s.aql === null ? null : s.aql / 1000,
      retries: share(1),
      failed: share(2),
      frames,
    });
    prev = c;
  }
  return out;
}
