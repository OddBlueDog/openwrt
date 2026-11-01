// Device to device, from both ends' records: for each pair a run planned,
// whether a direct path formed and which, RTT and loss each way over the
// probe connection, and throughput over the bulk one in each direction's
// phases. Loss each way needs both ends: x's probes that y says it got, and
// the echoes of y's probes that came back through x.
import type { Phase } from './api';
import { phaseWindows, rttStats, type RttSample, type RttStats, type Throughput } from './analysis';
import type { RunRecord } from './member';
import type { LinkDiag } from './rtc-diag';

interface Window {
  from: number;
  to: number;
}

const inside = (t: number, ws: readonly Window[]): boolean => ws.some((w) => t >= w.from && t < w.to);

/** The pairs a schedule plans, each once, in the order they first appear. */
export function schedulePairs(phases: readonly Pick<Phase, 'pair'>[]): [string, string][] {
  const out: [string, string][] = [];
  for (const p of phases) {
    const [a, b] = p.pair ?? [];
    if (a === undefined || b === undefined) continue;
    if (!out.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) out.push([a, b]);
  }
  return out;
}

/** A member's probes to a partner, by when they went. */
export function peerRtts(records: readonly RunRecord[], partner: string, ws?: readonly Window[]): RttSample[] {
  const out: RttSample[] = [];
  for (const r of records) {
    if (r[0] === 'pp' && r[1] === partner && (ws === undefined || inside(r[3], ws))) out.push({ t: r[3], ms: r[4] });
  }
  return out;
}

/** Bulk data that arrived at a member from a partner in some windows; undefined if none did. */
export function peerThroughput(records: readonly RunRecord[], from: string, ws: readonly Window[]): Throughput | undefined {
  let bytes = 0;
  const perSecond = new Map<number, number>();
  for (const r of records) {
    if (r[0] !== 'pb' || r[1] !== from || !inside(r[2], ws)) continue;
    bytes += r[3];
    const s = Math.floor(r[2] / 1000);
    perSecond.set(s, (perSecond.get(s) ?? 0) + r[3]);
  }
  if (bytes === 0) return undefined;
  const secs = Math.max(0.001, ws.reduce((n, w) => n + Math.max(0, w.to - w.from), 0) / 1000);
  let peak = 0;
  for (const b of perSecond.values()) peak = Math.max(peak, b);
  return { mbit: (bytes * 8) / secs / 1e6, peak: (peak * 8) / 1e6, bytes };
}

export interface Loss {
  sent: number;
  lost: number;
}

function receivedFrom(records: readonly RunRecord[], partner: string): Set<number> | undefined {
  let out: Set<number> | undefined;
  for (const r of records) {
    if (r[0] !== 'pr' || r[1] !== partner) continue;
    out ??= new Set();
    for (const n of r[3]) out.add(n);
  }
  return out;
}

/**
 * Loss from x to y: x's probes that didn't reach y, and of y's probes that
 * reached x, the echoes x sent that didn't reach y. Undefined unless both
 * ends said which probes they got: without that every probe looks lost.
 */
export function directionLoss(xRecs: readonly RunRecord[], yRecs: readonly RunRecord[], x: string, y: string, ws?: readonly Window[]): Loss | undefined {
  const atY = receivedFrom(yRecs, x);
  const atX = receivedFrom(xRecs, y);
  if (atY === undefined || atX === undefined) return undefined;
  let sent = 0;
  let lost = 0;
  for (const r of xRecs) {
    if (r[0] !== 'pp' || r[1] !== y || (ws !== undefined && !inside(r[3], ws))) continue;
    sent++;
    if (!atY.has(r[2])) lost++;
  }
  for (const r of yRecs) {
    if (r[0] !== 'pp' || r[1] !== x || (ws !== undefined && !inside(r[3], ws)) || !atX.has(r[2])) continue;
    sent++;
    if (r[4] === null) lost++;
  }
  return sent === 0 ? undefined : { sent, lost };
}

export interface LinkStatus {
  /** it opened, on either end */
  opened: boolean;
  /** it opened, then failed later in the run */
  dropped: boolean;
  /** how long it took to open, ms */
  ms: number | undefined;
  /** the path it took, from the end that made the offer if it said */
  path: LinkDiag['path'];
  /** each end's last view of it; undefined: that end never reported it */
  a: LinkDiag | undefined;
  b: LinkDiag | undefined;
}

function lastPeer(records: readonly RunRecord[], partner: string, kind: 'p' | 'b'): { event: string; diag: LinkDiag; open: LinkDiag | undefined } | undefined {
  let last: { event: string; diag: LinkDiag; open: LinkDiag | undefined } | undefined;
  let open: LinkDiag | undefined;
  for (const r of records) {
    if (r[0] !== 'peer' || r[2] !== partner || r[3] !== kind) continue;
    if (r[4] === 'open') open = r[5];
    last = { event: r[4], diag: r[5], open };
  }
  return last === undefined ? undefined : { ...last, open };
}

export function linkStatus(aRecs: readonly RunRecord[], bRecs: readonly RunRecord[], a: string, b: string, kind: 'p' | 'b'): LinkStatus {
  const la = lastPeer(aRecs, b, kind);
  const lb = lastPeer(bRecs, a, kind);
  const opens = [la?.open, lb?.open].filter((d): d is LinkDiag => d !== undefined).sort((x, y) => Number(y.offerer) - Number(x.offerer));
  const first = opens[0];
  const dropped = first !== undefined && (la?.event === 'fail' || lb?.event === 'fail');
  return { opened: first !== undefined, dropped, ms: first?.ms, path: opens.find((d) => d.path !== null)?.path ?? null, a: la?.diag, b: lb?.diag };
}

export interface DirectionResult {
  from: string;
  to: string;
  /** the phases that sent this way (both ways counts for each) */
  phases: number;
  throughput: Throughput | undefined;
  /** both ends' probes meanwhile */
  rtt: RttStats;
  /** loss in the data's direction, and back (where the acknowledgements go) */
  loss: Loss | undefined;
  lossBack: Loss | undefined;
}

export interface PairResult {
  a: string;
  b: string;
  probe: LinkStatus;
  bulk: LinkStatus;
  /** RTT while neither sent the other bulk data (connect, idle and settle phases) */
  quiet: RttStats;
  ab: DirectionResult;
  ba: DirectionResult;
  /** loss each way over the whole run */
  loss: { ab: Loss | undefined; ba: Loss | undefined };
}

/** Each planned pair's figures, from both ends' records. */
export function pairResults(t0: number, end: number, phases: readonly Phase[], records: ReadonlyMap<string, readonly RunRecord[]>): PairResult[] {
  const windows = phaseWindows(t0, phases)
    .filter((w) => w.from < end)
    .map((w) => ({ ...w, to: Math.min(w.to, end) }));
  return schedulePairs(phases).map(([a, b]) => {
    const ra = records.get(a) ?? [];
    const rb = records.get(b) ?? [];
    const between = (w: (typeof windows)[number]): boolean => {
      const [x, y] = w.phase.pair ?? [];
      return (x === a && y === b) || (x === b && y === a);
    };
    const quiet = windows.filter((w) => w.phase.kind === 'idle' || w.phase.kind === 'cooldown' || w.phase.kind === 'connect');
    const direction = (from: string, to: string): DirectionResult => {
      const ws = windows.filter((w) => between(w) && (w.phase.dir === 'both' || (w.phase.dir === 'ba' ? w.phase.pair?.[1] === from : w.phase.pair?.[0] === from)));
      const [rf, rt] = from === a ? [ra, rb] : [rb, ra];
      return {
        from,
        to,
        phases: ws.length,
        throughput: ws.length === 0 ? undefined : peerThroughput(rt, from, ws),
        rtt: rttStats(ws.length === 0 ? [] : [...peerRtts(ra, b, ws), ...peerRtts(rb, a, ws)]),
        loss: ws.length === 0 ? undefined : directionLoss(rf, rt, from, to, ws),
        lossBack: ws.length === 0 ? undefined : directionLoss(rt, rf, to, from, ws),
      };
    };
    return {
      a,
      b,
      probe: linkStatus(ra, rb, a, b, 'p'),
      bulk: linkStatus(ra, rb, a, b, 'b'),
      quiet: rttStats(quiet.length === 0 ? [] : [...peerRtts(ra, b, quiet), ...peerRtts(rb, a, quiet)]),
      ab: direction(a, b),
      ba: direction(b, a),
      loss: { ab: directionLoss(ra, rb, a, b, [{ from: t0, to: end }]), ba: directionLoss(rb, ra, b, a, [{ from: t0, to: end }]) },
    };
  });
}

/** A member's probes to all its partners in a window, for its row in a phase. */
export function memberPeerRtts(records: readonly RunRecord[], w: Window): RttSample[] {
  const out: RttSample[] = [];
  for (const r of records) if (r[0] === 'pp' && r[3] >= w.from && r[3] < w.to) out.push({ t: r[3], ms: r[4] });
  return out;
}
