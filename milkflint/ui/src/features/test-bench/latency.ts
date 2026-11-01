// Latency at rest and under load, per device and target: what each device
// measured to the router, the internet and its device-to-device partners,
// the router's pings to it, and the router's own pings to the internet.
// "Idle" is the idle phases, "loaded" those that load the network
// (LOAD_KINDS); what load added is the loaded p95 less the idle median.
import { LOAD_KINDS, memberRtts, type PhaseWindow, routerRtts, type RttSample, type RttStats, rttStats, runWindows } from './analysis';
import { memberPeerRtts } from './pairs';
import { reportRun, type RunData } from './run-data';

/**
 * router, internet, peers: a device's own probes; ping: the router's pings
 * to the device; wan, far: the router's pings to its gateway and to the
 * plan's internet host.
 */
export type LatencyTarget = 'router' | 'internet' | 'peers' | 'ping' | 'wan' | 'far';

export interface PhaseLatency {
  window: PhaseWindow;
  stats: RttStats;
  /** its p95 less the idle median, ms */
  added: number | undefined;
}

export interface LatencyRow {
  /** null: the router's own pings */
  member: string | null;
  target: LatencyTarget;
  idle: RttStats;
  loaded: RttStats;
  added: number | undefined;
  /** each loaded phase's */
  phases: PhaseLatency[];
  /** sent pings and never got an answer (a device whose firewall doesn't answer them, as Windows by default) */
  silent: boolean;
}

function samples(data: RunData, member: string | null, target: LatencyTarget, w: { from: number; to: number }): RttSample[] {
  const recs = member === null ? [] : (data.records.get(member) ?? []);
  switch (target) {
    case 'router':
      return memberRtts(recs, 'r', w);
    case 'internet':
      return memberRtts(recs, 'w', w);
    case 'peers':
      return memberPeerRtts(recs, w);
    case 'ping':
      return member === null ? [] : routerRtts(data.probes, member, w);
    case 'wan':
    case 'far':
      return routerRtts(data.probes, target, w);
  }
}

const addedTo = (s: RttStats, idle: RttStats): number | undefined => (s.p95 === undefined || idle.median === undefined ? undefined : s.p95 - idle.median);

/** A row per device and target it has figures for, then the router's own. */
export function latencyRows(data: RunData): LatencyRow[] {
  const windows = runWindows(reportRun(data), data.meta.schedule.phases);
  const idleWs = windows.filter((w) => w.phase.kind === 'idle');
  const loadWs = windows.filter((w) => LOAD_KINDS.has(w.phase.kind));
  const sources: [string | null, LatencyTarget][] = [
    ...data.meta.members.flatMap((m): [string, LatencyTarget][] => [
      [m.id, 'router'],
      [m.id, 'internet'],
      [m.id, 'peers'],
      [m.id, 'ping'],
    ]),
    [null, 'wan'],
    [null, 'far'],
  ];
  const out: LatencyRow[] = [];
  for (const [member, target] of sources) {
    const idleS = idleWs.flatMap((w) => samples(data, member, target, w));
    const loadS = loadWs.flatMap((w) => samples(data, member, target, w));
    if (idleS.length + loadS.length === 0) continue;
    const idle = rttStats(idleS);
    const loaded = rttStats(loadS);
    out.push({
      member,
      target,
      idle,
      loaded,
      added: addedTo(loaded, idle),
      phases: loadWs.map((w) => {
        const stats = rttStats(samples(data, member, target, w));
        return { window: w, stats, added: addedTo(stats, idle) };
      }),
      silent: idle.lost === idle.sent && loaded.lost === loaded.sent,
    });
  }
  return out;
}
