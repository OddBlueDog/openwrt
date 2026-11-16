// Which of the probe's times can be measurements. The probe gives up on an
// answer after 2 s at most (bin/netquality: ping -W 1 to the gateway, -W 2 to
// the internet target and the route servers, 2000 ms per DNS lookup), so a
// longer time isn't a slow answer: the router's clock jumped (a virtual
// machine whose host slept), or the sample is otherwise bad. Such a round is
// left out, a gap rather than a loss, and so is a history point whose typical
// time is impossible. Network quality and Home read the probe through these,
// so neither prints, scores or charts a time that can't be true. Pure
// functions, so the tests (ui/tests) can check them.
import type { Bucket, History, Sample, Stat } from './api';

/** The longest the probe waits for any answer, in ms. */
export const PROBE_TIMEOUT_MS = 2000;

/** The longest time that can be a measurement: the timeout, and half a second for starting the probe on a busy router. */
export const LONGEST_ANSWER_MS = PROBE_TIMEOUT_MS + 500;

/** A time the probe can have measured (ms); null (no answer) and undefined (not asked) say nothing false. */
export function possibleTime(v: number | null | undefined): boolean {
  return v === null || v === undefined || (Number.isFinite(v) && v >= 0 && v <= LONGEST_ANSWER_MS);
}

/** Whether every time in a round can be a measurement. */
export function possibleSample(s: Sample): boolean {
  return (
    possibleTime(s.gateway) &&
    possibleTime(s.internet) &&
    possibleTime(s.dns) &&
    Object.values(s.dns_servers ?? {}).every(possibleTime) &&
    Object.values(s.routes ?? {}).every(possibleTime)
  );
}

/** The rounds without an impossible time: the others are left out, a gap. */
export function possibleSamples(samples: readonly Sample[]): Sample[] {
  return samples.filter(possibleSample);
}

/**
 * A history point (typical, worst, lost, rounds) as far as it can be true:
 * none (a gap) when its typical time is impossible; when only its worst is,
 * that is unknown.
 */
export function possibleStat(stat: Stat): Stat {
  if (stat === null) return null;
  if (!possibleTime(stat[0])) return null;
  return possibleTime(stat[1]) ? stat : [stat[0], null, stat[2], stat[3]];
}

function possibleStats(stats: Record<string, Stat> | undefined): Record<string, Stat> | undefined {
  return stats === undefined ? undefined : Object.fromEntries(Object.entries(stats).map(([k, v]) => [k, possibleStat(v)]));
}

export function possibleBucket(b: Bucket): Bucket {
  const routes = possibleStats(b.routes);
  const dnsServers = possibleStats(b.dns_servers);
  return {
    i: b.i,
    internet: possibleStat(b.internet),
    dns: possibleStat(b.dns),
    ...(b.gateway === undefined ? {} : { gateway: possibleStat(b.gateway) }),
    ...(routes === undefined ? {} : { routes }),
    ...(dnsServers === undefined ? {} : { dns_servers: dnsServers }),
  };
}

/** The probe's history with every impossible point left out. */
export function possibleHistory(h: History): History {
  return { ...h, buckets: h.buckets.map(possibleBucket) };
}
