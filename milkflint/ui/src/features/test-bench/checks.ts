// The report's verdicts: each check grades one thing a run measured against
// its thresholds (pass, warn, fail), notes something that isn't a fault
// (info), or says why it couldn't be measured (skip). The thresholds are
// this browser's (the report's Thresholds panel) and go into an export
// with the checks they gave.
import { formatNumber } from '@/lib/format';
import { LOAD_KINDS, type PhaseWindow, percentile, routerRtts, rttStats, runWindows, WAN_KINDS } from './analysis';
import type { RunSettings } from './api';
import { routerSites, siteMedian } from './dns-pages';
import { type LatencyRow, latencyRows, type LatencyTarget } from './latency';
import { pairResults } from './pairs';
import { phaseName } from './phase-names';
import { reportRun, type RunData } from './run-data';
import { cakeSeconds, loads, stationSamples } from './timelines';
import { memberTiming, phasesReached } from './timing';

// ---- Thresholds ----

export interface ThresholdDef {
  label: string;
  unit: string;
  /** which way is better */
  better: 'lower' | 'higher';
  pass: number;
  /** none: short of `pass` is only noted (info), not a warning */
  warn?: number;
  step: number;
}

export const THRESHOLDS = {
  wanAdded: { label: 'Internet latency added under load', unit: 'ms', better: 'lower', pass: 15, warn: 30, step: 1 },
  lanAdded: { label: 'Latency to the router added under load', unit: 'ms', better: 'lower', pass: 20, warn: 50, step: 1 },
  spikes: { label: 'Latency spikes (p99 under load)', unit: 'ms', better: 'lower', pass: 100, warn: 250, step: 5 },
  lanLoss: { label: 'Loss on the home network', unit: '%', better: 'lower', pass: 0.1, warn: 1, step: 0.1 },
  sqmDelay: { label: 'Smart Queue delay with the line full', unit: 'ms', better: 'lower', pass: 10, warn: 20, step: 1 },
  shaperReach: { label: 'Shaped rate reached', unit: '%', better: 'higher', pass: 85, step: 1 },
  cpu: { label: 'Busiest core under load (p95)', unit: '%', better: 'lower', pass: 80, warn: 95, step: 1 },
  squeeze: { label: 'softnet squeezes', unit: 'a second', better: 'lower', pass: 10, warn: 100, step: 1 },
  ifDrops: { label: 'Interface and driver drops', unit: '% of packets', better: 'lower', pass: 0, warn: 0.1, step: 0.01 },
  offload: { label: 'Established connections offloaded', unit: '%', better: 'higher', pass: 90, warn: 50, step: 1 },
  wifiRetries: { label: 'Wi-Fi retries', unit: '% of frames', better: 'lower', pass: 10, warn: 25, step: 1 },
  wifiFailed: { label: 'Wi-Fi frames that failed', unit: '%', better: 'lower', pass: 0.1, warn: 1, step: 0.1 },
  wifiSignal: { label: 'Wi-Fi signal', unit: 'dBm', better: 'higher', pass: -67, warn: -75, step: 1 },
  dnsCached: { label: 'DNS answers from the cache', unit: 'ms', better: 'lower', pass: 2, warn: 10, step: 0.5 },
  dnsUpstream: { label: 'DNS lookups passed on', unit: 'ms', better: 'lower', pass: 150, warn: 400, step: 10 },
  overhead: { label: 'The bench’s own CPU', unit: '% of a core', better: 'lower', pass: 2, warn: 5, step: 0.5 },
  clock: { label: 'Clock sync uncertainty', unit: 'ms', better: 'lower', pass: 10, warn: 25, step: 1 },
} as const satisfies Record<string, ThresholdDef>;

export type ThresholdKey = keyof typeof THRESHOLDS;
export const thresholdKeys = Object.keys(THRESHOLDS) as ThresholdKey[];

/** A threshold as set: `warn` null where it has no warning level. */
export interface Level {
  pass: number;
  warn: number | null;
}
export type Thresholds = Record<ThresholdKey, Level>;

const def = (k: ThresholdKey): ThresholdDef => THRESHOLDS[k];

export function defaultThresholds(): Thresholds {
  return Object.fromEntries(thresholdKeys.map((k) => [k, { pass: def(k).pass, warn: def(k).warn ?? null }])) as Thresholds;
}

/** Thresholds as stored or exported: each number that's there and finite, the default for the rest. */
export function parseThresholds(v: unknown): Thresholds {
  const o = typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const out = defaultThresholds();
  for (const k of thresholdKeys) {
    const l = typeof o[k] === 'object' && o[k] !== null ? (o[k] as Record<string, unknown>) : {};
    const d = def(k);
    out[k] = { pass: num(l['pass'], d.pass), warn: d.warn === undefined ? null : num(l['warn'], d.warn) };
  }
  return out;
}

export type Status = 'pass' | 'warn' | 'fail' | 'info' | 'skip';

/** A figure against a threshold. A warning level on the wrong side of `pass` counts as `pass`. */
export function grade(k: ThresholdKey, value: number, t: Thresholds): Exclude<Status, 'skip'> {
  const d = def(k);
  const l = t[k];
  // figures computed in floating point: 0.1 % may come out as 0.1000000001
  const v = Math.round(value * 1e6) / 1e6;
  const ok = (x: number, limit: number): boolean => (d.better === 'lower' ? x <= limit : x >= limit);
  if (ok(v, l.pass)) return 'pass';
  if (l.warn === null) return 'info';
  const warn = d.better === 'lower' ? Math.max(l.warn, l.pass) : Math.min(l.warn, l.pass);
  return ok(v, warn) ? 'warn' : 'fail';
}

const rank: Record<Status, number> = { skip: 0, pass: 1, info: 2, warn: 3, fail: 4 };
export const worst = (xs: readonly Status[]): Status => xs.reduce<Status>((a, b) => (rank[b] > rank[a] ? b : a), 'skip');

// ---- Checks ----

export type CheckId =
  | 'internet-latency'
  | 'router-latency'
  | 'spikes'
  | 'lan-loss'
  | 'sqm'
  | 'shaper'
  | 'cpu'
  | 'softnet'
  | 'drops'
  | 'offload'
  | 'wifi'
  | 'dns'
  | 'overhead'
  | 'quality';

export interface Check {
  id: CheckId;
  title: string;
  status: Status;
  /** the figure graded, short: "+12 ms" */
  value: string | undefined;
  /** what it's from, or why it couldn't be measured */
  detail: string;
  /** more: per device, per direction */
  notes: string[];
  /** the thresholds it grades against */
  uses: ThresholdKey[];
  /** why it matters */
  why: string;
}

const ms = (v: number): string => `${formatNumber(v, Math.abs(v) < 10 ? 1 : 0)} ms`;
const signed = (v: number): string => `${v >= 0 ? '+' : '−'}${ms(Math.abs(v))}`;
/** a share as a percentage, with the decimals small ones need */
const pct = (share: number): string => `${formatNumber(share * 100, share === 0 ? 0 : share < 0.001 ? 3 : share < 0.01 ? 2 : share < 0.1 ? 1 : 0)}%`;
const count = (n: number): string => formatNumber(n);

/** A latency row in words: "Mac, to the internet", "The router’s pings to Mac". */
function source(r: Pick<LatencyRow, 'member' | 'target'>, name: (id: string | null) => string): string {
  switch (r.target) {
    case 'router':
      return `${name(r.member)}, to the router`;
    case 'internet':
      return `${name(r.member)}, to the internet`;
    case 'peers':
      return `${name(r.member)}, to its peers`;
    case 'ping':
      return `The router’s pings to ${name(r.member)}`;
    case 'wan':
      return 'The router’s pings to its gateway';
    case 'far':
      return 'The router’s pings to the internet';
  }
}

interface Context {
  data: RunData;
  t: Thresholds;
  t0: number;
  end: number;
  windows: PhaseWindow[];
  rows: LatencyRow[];
  name: (id: string | null) => string;
}

const inAny = (t: number, ws: readonly PhaseWindow[]): boolean => ws.some((w) => t >= w.from && t < w.to);

function skip(c: Omit<Check, 'status' | 'value' | 'notes'>): Check {
  return { ...c, status: 'skip', value: undefined, notes: [] };
}

/** The worst a phase's p95 rose over the idle median, of the rows and phases picked. */
function addedCheck(
  x: Context,
  id: CheckId,
  title: string,
  key: 'wanAdded' | 'lanAdded',
  targets: readonly LatencyTarget[],
  kinds: ReadonlySet<string>,
  why: string,
): Check {
  const base = { id, title, uses: [key], why };
  if (!x.windows.some((w) => kinds.has(w.phase.kind))) return skip({ ...base, detail: 'The plan has no phase that loads it.' });
  if (!x.windows.some((w) => w.phase.kind === 'idle')) return skip({ ...base, detail: 'The plan has no idle phase to compare with.' });
  const found = x.rows
    .filter((r) => targets.includes(r.target) && !r.silent)
    .flatMap((r) => r.phases.filter((p) => kinds.has(p.window.phase.kind) && p.added !== undefined).map((p) => ({ r, p, added: p.added ?? 0 })));
  if (found.length === 0) return skip({ ...base, detail: 'Nothing measured it both idle and under load.' });
  const top = found.reduce((a, b) => (b.added > a.added ? b : a));
  // each device's (and the router's) worst
  const perWho = new Map<string, (typeof found)[number]>();
  for (const f of found) {
    const k = `${f.r.member ?? ''} ${f.r.target}`;
    const was = perWho.get(k);
    if (was === undefined || f.added > was.added) perWho.set(k, f);
  }
  return {
    ...base,
    status: grade(key, top.added, x.t),
    value: signed(top.added),
    detail: `${source(top.r, x.name)}, in ${phaseName(top.p.window.phase)}: ${ms(top.r.idle.median ?? 0)} idle, ${ms(top.p.stats.p95 ?? 0)} at the 95th percentile.`,
    notes: [...perWho.values()].map((f) => `${source(f.r, x.name)}: ${signed(f.added)} (${phaseName(f.p.window.phase)})`),
  };
}

function spikes(x: Context): Check {
  const base = { id: 'spikes' as const, title: 'Latency spikes', uses: ['spikes' as const], why: 'Short stalls you notice even when the typical figures are fine.' };
  const found = x.rows
    .filter((r) => !r.silent)
    .flatMap((r) => r.phases.filter((p) => p.stats.p99 !== undefined).map((p) => ({ r, p, p99: p.stats.p99 ?? 0 })));
  if (found.length === 0) return skip({ ...base, detail: 'Nothing was measured under load.' });
  const top = found.reduce((a, b) => (b.p99 > a.p99 ? b : a));
  return {
    ...base,
    status: grade('spikes', top.p99, x.t),
    value: ms(top.p99),
    detail: `The 99th percentile: ${source(top.r, x.name)}, in ${phaseName(top.p.window.phase)} (at most ${ms(top.p.stats.max ?? top.p99)}).`,
    notes: [],
  };
}

function lanLoss(x: Context): Check {
  const base = {
    id: 'lan-loss' as const,
    title: 'Loss on the home network',
    uses: ['lanLoss' as const],
    why: 'Wi-Fi resends lost frames itself, so loss that a device or the router sees means a queue dropped packets.',
  };
  const run = { from: x.t0, to: x.end };
  const sources: { who: string; lost: number; sent: number }[] = [];
  const notes: string[] = [];
  for (const m of x.data.meta.members) {
    const s = rttStats(routerRtts(x.data.probes, m.id, run));
    if (s.sent === 0) continue;
    if (s.lost === s.sent) notes.push(`${m.name} doesn’t answer pings (a firewall, as Windows has by default), so the router’s pings can’t measure its loss.`);
    else sources.push({ who: `the router’s pings to ${m.name}`, lost: s.lost, sent: s.sent });
  }
  for (const p of pairResults(x.t0, x.end, x.data.meta.schedule.phases, x.data.records)) {
    for (const [from, to, l] of [
      [p.a, p.b, p.loss.ab],
      [p.b, p.a, p.loss.ba],
    ] as const) {
      if (l !== undefined && l.sent > 0) sources.push({ who: `${x.name(from)} to ${x.name(to)}, direct`, lost: l.lost, sent: l.sent });
    }
  }
  if (sources.length === 0) return { ...skip({ ...base, detail: 'Nothing measured it: no pings were answered and no devices were paired.' }), notes };
  const top = sources.reduce((a, b) => (b.lost / b.sent > a.lost / a.sent ? b : a));
  const share = top.lost / top.sent;
  return {
    ...base,
    status: grade('lanLoss', share * 100, x.t),
    value: pct(share),
    detail: top.lost === 0 ? `Nothing lost, of ${count(sources.reduce((a, s) => a + s.sent, 0))} probes and pings.` : `The most: ${top.who}, ${count(top.lost)} of ${count(top.sent)} lost.`,
    notes: [...sources.map((s) => `${s.who}: ${count(s.lost)} of ${count(s.sent)} lost`), ...notes],
  };
}

/** Smart Queue's shaped rates, kbit/s (none: it's off). */
function shaper(s: RunSettings): { down: number; up: number } | undefined {
  const q = s.sqm.find((x) => x.enabled === '1' && ((x.download ?? 0) > 0 || (x.upload ?? 0) > 0));
  return q === undefined ? undefined : { down: q.download ?? 0, up: q.upload ?? 0 };
}

/** The directions a plan loads the internet line, and their phases. */
function wanDirections(x: Context): { dir: 'down' | 'up'; ws: PhaseWindow[] }[] {
  const ws = x.windows.filter((w) => WAN_KINDS.has(w.phase.kind));
  return (['down', 'up'] as const)
    .map((dir) => ({ dir, ws: ws.filter((w) => Object.values(w.phase.roles).some((r) => loads(r, dir === 'down' ? 'd' : 'u'))) }))
    .filter((d) => d.ws.length > 0);
}

const arrow = { down: '↓', up: '↑' } as const;

function sqm(x: Context): Check {
  const base = {
    id: 'sqm' as const,
    title: 'Smart Queue with the line full',
    uses: ['sqmDelay' as const],
    why: 'When the line is full, CAKE has to drop or mark packets to keep its queue near its target.',
  };
  const rates = shaper(x.data.meta.settings);
  if (rates === undefined) return skip({ ...base, detail: 'Smart Queue is off.' });
  const dirs = wanDirections(x);
  if (dirs.length === 0) return skip({ ...base, detail: 'The plan loads no internet traffic.' });
  const statuses: Status[] = [];
  const values: string[] = [];
  const notes: string[] = [];
  for (const { dir, ws } of dirs) {
    const kbit = dir === 'down' ? rates.down : rates.up;
    if (kbit <= 0) continue;
    const secs = cakeSeconds(x.data.router, x.t0, dir).filter((s) => inAny(s.t + x.t0, ws));
    if (secs.length === 0) {
      notes.push(`${arrow[dir]} CAKE wasn’t seen on this way.`);
      continue;
    }
    const full = secs.filter((s) => s.mbit * 1000 >= 0.9 * kbit);
    if (full.length >= 5) {
      const delays = full.flatMap((s) => (s.avgMs === undefined ? [] : [s.avgMs])).sort((a, b) => a - b);
      const delay = percentile(delays, 0.5) ?? 0;
      const signals = full.reduce((a, s) => a + s.drops + s.marks, 0);
      const st = grade('sqmDelay', delay, x.t);
      statuses.push(signals === 0 && st === 'pass' ? 'warn' : st);
      values.push(`${arrow[dir]} ${ms(delay)}`);
      notes.push(
        `${arrow[dir]} full for ${count(full.length)} s: the busiest tin’s delay ${ms(delay)} typical, ${ms(delays[delays.length - 1] ?? 0)} at most; ${count(full.reduce((a, s) => a + s.drops, 0))} drops, ${count(full.reduce((a, s) => a + s.marks, 0))} ECN marks.` +
          (signals === 0 ? ' It neither dropped nor marked anything, so the queue that kept the line full may be somewhere else.' : ''),
      );
    } else {
      const peak = Math.max(...secs.map((s) => s.mbit));
      const share = (peak * 1000) / kbit;
      if (share < 0.7) {
        statuses.push('info');
        notes.push(`${arrow[dir]} the line never came near the shaped rate (at most ${pct(share)} of it): Smart Queue wasn’t what limited it.`);
      } else {
        notes.push(`${arrow[dir]} at the shaped rate for only ${count(full.length)} s, too short to judge.`);
      }
    }
  }
  const status = worst(statuses);
  return {
    ...base,
    status,
    value: values.length === 0 ? undefined : values.join(' · '),
    detail:
      values.length > 0
        ? 'The busiest tin’s average delay while CAKE sent at 90% of its rate or more.'
        : status === 'info'
          ? 'The line never came near the shaped rate, so Smart Queue wasn’t what limited it.'
          : 'The line was never full for long enough to judge.',
    notes,
  };
}

function shaperReach(x: Context): Check {
  const base = { id: 'shaper' as const, title: 'Shaped rate reached', uses: ['shaperReach' as const], why: 'Tells the line’s or a server’s limit from the shaper’s.' };
  const rates = shaper(x.data.meta.settings);
  if (rates === undefined) return skip({ ...base, detail: 'Smart Queue is off, so there’s no shaped rate to compare with.' });
  const dirs = wanDirections(x);
  if (dirs.length === 0) return skip({ ...base, detail: 'The plan loads no internet traffic.' });
  const statuses: Status[] = [];
  const values: string[] = [];
  const notes: string[] = [];
  for (const { dir, ws } of dirs) {
    const kbit = dir === 'down' ? rates.down : rates.up;
    const secs = cakeSeconds(x.data.router, x.t0, dir).filter((s) => inAny(s.t + x.t0, ws));
    if (kbit <= 0 || secs.length === 0) continue;
    // the most it kept up for 5 s
    let best = 0;
    for (let i = 0; i < secs.length; i++) {
      const run = secs.slice(i, i + 5);
      if (run.length === 5 || secs.length < 5) best = Math.max(best, run.reduce((a, s) => a + s.mbit, 0) / run.length);
    }
    const share = (best * 1000) / kbit;
    statuses.push(grade('shaperReach', share * 100, x.t));
    values.push(`${arrow[dir]} ${pct(share)}`);
    notes.push(`${arrow[dir]} ${formatNumber(best, best < 10 ? 1 : 0)} of ${formatNumber(kbit / 1000, 0)} Mbit/s, over its best 5 s`);
  }
  const status = worst(statuses);
  if (status === 'skip') return skip({ ...base, detail: 'CAKE wasn’t seen while the line was loaded.' });
  return {
    ...base,
    status,
    value: values.join(' · '),
    detail: status === 'info' ? 'Short of the shaped rate: something else was the limit (the line, the server, a device or its link).' : 'What CAKE sent, of the rate it shapes to.',
    notes,
  };
}

function cpu(x: Context): Check {
  const base = { id: 'cpu' as const, title: 'Router CPU', uses: ['cpu' as const], why: 'Forwarding and CAKE run in softirqs: a core that’s pegged queues and drops packets.' };
  const ws = x.windows.filter((w) => LOAD_KINDS.has(w.phase.kind));
  const busiest = x.data.router.flatMap((l) => {
    if (!inAny(l.t, ws)) return [];
    const c = (l.cpu ?? []).flatMap((v) => (v === null ? [] : [v[0]]));
    return c.length === 0 ? [] : [Math.max(...c)];
  });
  if (busiest.length === 0) return skip({ ...base, detail: ws.length === 0 ? 'The plan has no phase that loads the network.' : 'The router recorded nothing under load.' });
  const warnAt = (x.t.cpu.warn ?? 95) / 100;
  let run = 0;
  let longest = 0;
  for (const b of busiest) {
    run = b >= warnAt ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const p95 = percentile([...busiest].sort((a, b) => a - b), 0.95) ?? 0;
  const pegged = longest >= 3;
  return {
    ...base,
    status: pegged ? 'fail' : grade('cpu', p95 * 100, x.t),
    value: `${pct(p95)} (p95)`,
    detail: `The busiest core each second under load: ${pct(p95)} at the 95th percentile, ${pct(Math.max(...busiest))} at most.`,
    notes: pegged ? [`A core stayed at ${pct(warnAt)} or more for ${count(longest)} s running.`] : [],
  };
}

function softnet(x: Context): Check {
  const base = {
    id: 'softnet' as const,
    title: 'softnet',
    uses: ['squeeze' as const],
    why: 'Drops mean a CPU’s backlog of packets overflowed; squeezes mean NAPI ran out of budget, which now and then is normal.',
  };
  let drops = 0;
  let squeezed = 0;
  let secs = 0;
  for (const l of x.data.router) {
    if (l.t < x.t0 || l.t >= x.end || l.sn === undefined || l.dt === undefined) continue;
    secs += l.dt;
    for (const c of l.sn) {
      drops += c[1] ?? 0;
      squeezed += c[2] ?? 0;
    }
  }
  if (secs === 0) return skip({ ...base, detail: 'The router recorded nothing.' });
  const rate = squeezed / secs;
  return {
    ...base,
    status: drops > 0 ? 'fail' : grade('squeeze', rate, x.t),
    value: `${count(drops)} dropped · ${formatNumber(rate, rate < 10 ? 1 : 0)} squeezes/s`,
    detail: `Over the run: ${count(drops)} packets dropped from a backlog, ${count(squeezed)} squeezes.`,
    notes: [],
  };
}

function drops(x: Context): Check {
  const base = { id: 'drops' as const, title: 'Interface and driver drops', uses: ['ifDrops' as const], why: 'Packets an interface or its driver dropped or got wrong.' };
  const loaded = x.windows.filter((w) => LOAD_KINDS.has(w.phase.kind));
  const idle = x.windows.filter((w) => w.phase.kind === 'idle');
  if (loaded.length === 0) return skip({ ...base, detail: 'The plan has no phase that loads the network.' });
  const sum = (ws: readonly PhaseWindow[]): { counts: Map<string, number[]>; secs: number } => {
    const counts = new Map<string, number[]>();
    let secs = 0;
    for (const l of x.data.router) {
      if (!inAny(l.t, ws) || l.dt === undefined) continue;
      secs += l.dt;
      for (const [dev, c] of Object.entries(l.if ?? {})) {
        const a = counts.get(dev) ?? [0, 0, 0, 0, 0, 0, 0, 0];
        c.forEach((v, i) => (a[i] = (a[i] ?? 0) + (v ?? 0)));
        counts.set(dev, a);
      }
    }
    return { counts, secs };
  };
  const load = sum(loaded);
  const rest = sum(idle);
  // the bridge drops frames it has no use for (other protocols) all the time: only what it drops beyond its idle rate counts
  const brIdle = rest.secs > 0 ? (rest.counts.get('br-lan')?.[4] ?? 0) / rest.secs : 0;
  // the driver's counters that rose over the run
  const eth = x.data.router.filter((l) => l.eth !== undefined && l.t >= x.t0 && l.t < x.end);
  const first = eth[0]?.eth ?? {};
  const last = eth[eth.length - 1]?.eth ?? {};
  const driver = new Map<string, number>();
  const notes: string[] = [];
  for (const [dev, c] of Object.entries(last)) {
    for (const [name, v] of Object.entries(c)) {
      const rise = v - (first[dev]?.[name] ?? v);
      if (rise <= 0) continue;
      driver.set(dev, (driver.get(dev) ?? 0) + rise);
      notes.push(`${dev}’s driver: ${name} +${count(rise)}`);
    }
  }
  let top: { dev: string; bad: number; packets: number } | undefined;
  let packets = 0;
  for (const [dev, c] of load.counts) {
    const p = (c[2] ?? 0) + (c[3] ?? 0);
    packets += p;
    const rx = dev === 'br-lan' ? Math.max(0, (c[4] ?? 0) - brIdle * load.secs) : (c[4] ?? 0);
    const bad = Math.round(rx + (c[5] ?? 0) + (c[6] ?? 0) + (c[7] ?? 0) + (driver.get(dev) ?? 0));
    if (bad > 0) notes.unshift(`${dev}: ${count(bad)} dropped or bad of ${count(p)} packets under load`);
    if (p > 0 && (top === undefined || bad / p > top.bad / top.packets)) top = { dev, bad, packets: p };
  }
  if (top === undefined || packets === 0) return skip({ ...base, detail: 'The router recorded no packets under load.' });
  const share = top.bad / top.packets;
  return {
    ...base,
    status: grade('ifDrops', share * 100, x.t),
    value: top.bad === 0 ? 'none' : `${pct(share)} on ${top.dev}`,
    detail: top.bad === 0 ? 'No interface dropped or got a packet wrong under load.' : `The most: ${top.dev}, ${count(top.bad)} of ${count(top.packets)} packets under load.`,
    notes,
  };
}

function offload(x: Context): Check {
  const base = {
    id: 'offload' as const,
    title: 'Connections offloaded',
    uses: ['offload' as const],
    why: 'A connection that isn’t offloaded takes the slow path through the firewall for every packet.',
  };
  if (x.data.meta.settings.firewall.flow_offloading !== '1') return skip({ ...base, detail: 'Flow offloading is off.' });
  const ws = x.windows.filter((w) => WAN_KINDS.has(w.phase.kind));
  if (ws.length === 0) return skip({ ...base, detail: 'The plan loads no internet traffic.' });
  const per = new Map<string, [number, number]>();
  for (const l of x.data.router) {
    if (!inAny(l.t, ws) || l.ct_scan === null || l.ct_scan === undefined) continue;
    for (const [id, m] of Object.entries(l.ct_scan.m)) {
      const a = per.get(id) ?? [0, 0];
      a[0] += m[1] ?? 0;
      // established ones (older runs: every one)
      a[1] += m[4] ?? m[0] ?? 0;
      per.set(id, a);
    }
  }
  const off = [...per.values()].reduce((a, v) => a + v[0], 0);
  const est = [...per.values()].reduce((a, v) => a + v[1], 0);
  if (est === 0) return skip({ ...base, detail: 'The connection scans saw no established connections from the devices under load.' });
  const share = Math.min(1, off / est);
  return {
    ...base,
    status: grade('offload', share * 100, x.t),
    value: pct(share),
    detail: 'Of the devices’ established connections the router’s scans saw under load (those to the router itself left out).',
    notes: [...per].map(([id, [o, e]]) => `${x.name(id)}: ${count(o)} of ${count(e)}`),
  };
}

function wifi(x: Context): Check {
  const base = {
    id: 'wifi' as const,
    title: 'Wi-Fi links',
    uses: ['wifiRetries' as const, 'wifiFailed' as const, 'wifiSignal' as const],
    why: 'Many retries or failed frames mean a weak or crowded link; a weak signal means a slow rate.',
  };
  const loaded = x.windows.filter((w) => LOAD_KINDS.has(w.phase.kind));
  const statuses: Status[] = [];
  const notes: string[] = [];
  let top: { status: Status; text: string } | undefined;
  for (const m of x.data.meta.members) {
    const all = stationSamples(x.data.router, x.t0, m.id).filter((s) => s.t + x.t0 < x.end);
    if (all.length === 0) continue;
    const busy = all.filter((s) => inAny(s.t + x.t0, loaded));
    const use = busy.some((s) => s.frames > 0) ? busy : all;
    const frames = use.reduce((a, s) => a + s.frames, 0);
    const retries = frames === 0 ? undefined : use.reduce((a, s) => a + (s.retries ?? 0) * s.frames, 0) / frames;
    const failed = frames === 0 ? undefined : use.reduce((a, s) => a + (s.failed ?? 0) * s.frames, 0) / frames;
    const signals = all.flatMap((s) => (s.signal === null ? [] : [s.signal])).sort((a, b) => a - b);
    const signal = percentile(signals, 0.5);
    const mine = [
      retries === undefined ? 'skip' : grade('wifiRetries', retries * 100, x.t),
      failed === undefined ? 'skip' : grade('wifiFailed', failed * 100, x.t),
      signal === undefined ? 'skip' : grade('wifiSignal', signal, x.t),
    ] as Status[];
    const st = worst(mine);
    const text = [
      retries === undefined ? undefined : `${pct(retries)} retries`,
      failed === undefined ? undefined : `${pct(failed)} failed`,
      signal === undefined ? undefined : `${formatNumber(Math.round(signal))} dBm`,
    ]
      .filter((s) => s !== undefined)
      .join(', ');
    statuses.push(st);
    notes.push(`${m.name}: ${text === '' ? 'no figures' : text}`);
    if (top === undefined || rank[st] > rank[top.status]) top = { status: st, text: `${m.name}: ${text}` };
  }
  if (top === undefined) return skip({ ...base, detail: 'No device was on the router’s Wi-Fi.' });
  return {
    ...base,
    status: worst(statuses),
    value: top.text,
    detail: 'Each Wi-Fi device’s link as the router saw it: retries and failed frames of those it sent under load, and its typical signal.',
    notes,
  };
}

function dns(x: Context): Check {
  const base = {
    id: 'dns' as const,
    title: 'DNS',
    uses: ['dnsCached' as const, 'dnsUpstream' as const],
    why: 'Lookups dnsmasq answers from its cache should take no time; those it passes on take as long as its upstream.',
  };
  if (!x.windows.some((w) => w.phase.kind === 'dns' || w.phase.kind === 'household')) return skip({ ...base, detail: 'The plan has no DNS or busy-household phase.' });
  const sites = routerSites(x.data.dns.lookups.filter((l) => l.t >= x.t0 && l.t < x.end));
  if (sites.length === 0) return skip({ ...base, detail: 'The router’s own lookups didn’t run.' });
  const cached = siteMedian(sites.flatMap((s) => (s.fromCache.median === undefined ? [] : [s.fromCache.median])));
  const passed = siteMedian(sites.flatMap((s) => (s.cold.median === undefined ? [] : [s.cold.median])));
  const statuses: Status[] = [];
  const notes: string[] = [];
  if (cached !== undefined) statuses.push(grade('dnsCached', cached, x.t));
  if (passed !== undefined) statuses.push(grade('dnsUpstream', passed, x.t));
  const errors = sites.reduce((a, s) => a + s.errors, 0);
  const unanswered = sites.reduce((a, s) => a + s.cold.failed + s.up.failed + s.passedOn.failed + s.fromCache.failed, 0);
  if (errors > 0) {
    statuses.push('fail');
    notes.push(`${count(errors)} lookups came back with an error (not “no such name”).`);
  }
  if (unanswered > 0) {
    statuses.push('warn');
    notes.push(`${count(unanswered)} lookups got no answer in time.`);
  }
  // the second lookup of a site, at once after the first: dnsmasq's cache should have it
  const again = x.data.dns.lookups.filter((l) => l.k === 'again' && l.fw !== null && l.t >= x.t0 && l.t < x.end);
  const hits = again.filter((l) => l.fw === 0).length;
  if (again.length > 0 && hits / again.length < 0.5) {
    statuses.push('warn');
    notes.push(`dnsmasq answered only ${count(hits)} of ${count(again.length)} repeated lookups from its cache.`);
  }
  return {
    ...base,
    status: worst(statuses),
    value: [cached === undefined ? undefined : `cached ${ms(cached)}`, passed === undefined ? undefined : `passed on ${ms(passed)}`].filter((s) => s !== undefined).join(' · '),
    detail: 'The router’s own lookups, typical over the sites: a site’s name from dnsmasq’s cache, and a made-up name it had to pass on.',
    notes,
  };
}

function overhead(x: Context): Check {
  const base = { id: 'overhead' as const, title: 'The bench’s own cost', uses: ['overhead' as const], why: 'The recorder mustn’t change what it measures.' };
  const shares = x.data.router.flatMap((l) => (l.self === undefined || l.t < x.t0 || l.t >= x.end ? [] : [l.self.reduce((a, b) => a + b, 0)]));
  if (shares.length === 0) return skip({ ...base, detail: 'The router recorded nothing.' });
  const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
  const peak = Math.max(...shares);
  // what the members' polls cost the router's web side
  const web = x.data.router.flatMap((l) => (l.th === undefined || l.t < x.t0 || l.t >= x.end ? [] : [(l.th['rpcd'] ?? 0) + (l.th['uhttpd'] ?? 0)]));
  const webMean = web.length === 0 ? undefined : web.reduce((a, b) => a + b, 0) / web.length;
  return {
    ...base,
    status: grade('overhead', mean * 100, x.t),
    value: `${pct(mean)} of a core`,
    detail: `The recorder, its pings and its DNS lookups: ${pct(mean)} of a core on average, ${pct(peak)} at most.`,
    notes: webMean === undefined ? [] : [`The router’s web side (rpcd, uhttpd), which the devices’ polls and pages go through: ${pct(webMean)} of a core on average.`],
  };
}

function quality(x: Context): Check {
  const base = {
    id: 'quality' as const,
    title: 'Data quality',
    uses: ['clock' as const],
    why: 'The figures are only as good as the devices’ clocks, and their pages staying open.',
  };
  const reached = phasesReached(reportRun(x.data), x.data.meta.schedule.phases);
  const statuses: Status[] = [];
  const notes: string[] = [];
  let clock = 0;
  for (const m of x.data.meta.members) {
    const recs = x.data.records.get(m.id) ?? [];
    if (recs.length === 0) {
      statuses.push('fail');
      notes.push(`${m.name} sent nothing.`);
      continue;
    }
    const t = memberTiming(recs, reached);
    clock = Math.max(clock, t.uncertainty ?? 0);
    if (t.marked < t.phases) notes.push(`${m.name} started ${count(t.marked)} of its ${count(t.phases)} phases.`);
    if (t.hidden) notes.push(`${m.name}’s page was hidden for part of the run: its loads stopped meanwhile.`);
    if (t.lost) notes.push(`${m.name} lost the router for a while.`);
    if (t.marked < t.phases || t.hidden || t.lost) statuses.push('warn');
  }
  statuses.push(grade('clock', clock, x.t));
  const ended = x.data.end?.reason;
  if (ended !== undefined && ended !== 'completed') {
    statuses.push('warn');
    notes.unshift(`The run ended early: ${ended}.`);
  }
  return {
    ...base,
    status: worst(statuses),
    value: `clock ±${ms(clock)}`,
    detail: 'How far a device’s clock sync could be off at worst, whether every device started its phases, and stayed in front and in touch.',
    notes,
  };
}

/** Every check of a finished run, in the report's order. A rehearsal (no traffic) has only data quality. */
export function runChecks(data: RunData, t: Thresholds): Check[] {
  const run = reportRun(data);
  const names = new Map(data.meta.members.map((m) => [m.id, m.name]));
  const x: Context = {
    data,
    t,
    t0: data.meta.t0,
    end: run.ended?.at ?? run.end,
    windows: runWindows(run, data.meta.schedule.phases),
    rows: latencyRows(data),
    name: (id) => (id === null ? 'The router' : (names.get(id) ?? id)),
  };
  if (data.meta.schedule.dry) return [quality(x)];
  return [
    addedCheck(
      x,
      'internet-latency',
      'Internet latency under load',
      'wanAdded',
      ['internet', 'wan', 'far'],
      WAN_KINDS,
      'CAKE aims for 5 ms each way; at around 30 ms more, calls and games start to suffer.',
    ),
    addedCheck(
      x,
      'router-latency',
      'Latency to the router under load',
      'lanAdded',
      ['router', 'ping'],
      LOAD_KINDS,
      'Wi-Fi’s airtime queues keep a busy device’s queue near their target, so the rest of the home stays quick.',
    ),
    spikes(x),
    lanLoss(x),
    sqm(x),
    shaperReach(x),
    cpu(x),
    softnet(x),
    drops(x),
    offload(x),
    wifi(x),
    dns(x),
    overhead(x),
    quality(x),
  ];
}
