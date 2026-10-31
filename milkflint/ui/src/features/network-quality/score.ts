// Turning probe samples into a summary and a 0-100 score. Pure functions, so
// the scoring is easy to check and tune.
import type { Sample } from './api';

export type Probe = 'gateway' | 'internet' | 'dns';

export interface ProbeSummary {
  /** Latest result (ms); null when the latest probe got no answer. */
  current: number | null;
  /** Median of the answered probes in the window. */
  typical: number | undefined;
  /** 95th percentile of the answered probes. */
  worst: number | undefined;
  /** Share of probes with no answer, 0..1. */
  loss: number;
  answered: number;
}

export interface Summary {
  probes: Record<Probe, ProbeSummary>;
  /** Mean change between consecutive internet pings (ms). */
  jitter: number | undefined;
  score: number | undefined;
  /** The gateway doesn't answer pings (some providers block them): left out of the score. */
  gatewaySilent: boolean;
}

function quantile(sorted: readonly number[], q: number): number | undefined {
  if (sorted.length === 0) return undefined;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function summarizeProbe(samples: readonly Sample[], probe: Probe): ProbeSummary {
  return summarizeValues(samples.map((s) => s[probe]));
}

/** A DNS server over the rounds that asked it; the score uses the main one's (Sample.dns). */
export function summarizeDnsServer(samples: readonly Sample[], key: string): ProbeSummary {
  return summarizeValues(samples.flatMap((s) => (s.dns_servers === undefined || !(key in s.dns_servers) ? [] : [s.dns_servers[key] ?? null])));
}

/** A route's server over the rounds that pinged it; not part of the score. */
export function summarizeRoute(samples: readonly Sample[], key: string): ProbeSummary {
  return summarizeValues(samples.flatMap((s) => (s.routes === undefined ? [] : [s.routes[key] ?? null])));
}

function summarizeValues(values: readonly (number | null)[]): ProbeSummary {
  const answered = values.filter((v): v is number => v !== null).sort((a, b) => a - b);
  return {
    current: values[values.length - 1] ?? null,
    typical: quantile(answered, 0.5),
    worst: quantile(answered, 0.95),
    loss: values.length === 0 ? 0 : 1 - answered.length / values.length,
    answered: answered.length,
  };
}

/** 100 at or below `good`, 0 at or above `bad`, linear in between. */
function scale(value: number, good: number, bad: number): number {
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return 100 * (1 - (value - good) / (bad - good));
}

/**
 * `gatewayAnswers`: the probe's word on whether the gateway has ever
 * answered a ping (Status.gateway_answers). Without it (an older probe, or
 * no gateway), a gateway that answered nothing in the window while the
 * internet did counts as silent.
 */
export function summarize(samples: readonly Sample[], gatewayAnswers?: boolean | null): Summary {
  const probes = {
    gateway: summarizeProbe(samples, 'gateway'),
    internet: summarizeProbe(samples, 'internet'),
    dns: summarizeProbe(samples, 'dns'),
  };

  let jitterSum = 0;
  let jitterCount = 0;
  let previous: number | null = null;
  for (const s of samples) {
    if (s.internet !== null && previous !== null) {
      jitterSum += Math.abs(s.internet - previous);
      jitterCount++;
    }
    previous = s.internet;
  }
  const jitter = jitterCount === 0 ? undefined : jitterSum / jitterCount;

  const gatewaySilent =
    gatewayAnswers === false ||
    ((gatewayAnswers === null || gatewayAnswers === undefined) && samples.length >= 3 && probes.gateway.answered === 0 && probes.internet.answered > 0);
  const parts: [weight: number, score: number][] = [];
  const net = probes.internet;
  parts.push([0.25, scale(net.loss, 0, 0.1)]);
  if (net.typical !== undefined) parts.push([0.3, scale(net.typical, 20, 200)]);
  else parts.push([0.3, 0]);
  if (jitter !== undefined) parts.push([0.15, scale(jitter, 3, 50)]);
  parts.push([0.15, probes.dns.typical === undefined ? 0 : scale(probes.dns.typical, 30, 400) * (1 - probes.dns.loss)]);
  if (!gatewaySilent) {
    parts.push([0.15, probes.gateway.typical === undefined ? 0 : scale(probes.gateway.typical, 3, 50) * (1 - probes.gateway.loss)]);
  }
  const weight = parts.reduce((w, [x]) => w + x, 0);
  const score = samples.length === 0 ? undefined : Math.round(parts.reduce((s, [w, v]) => s + w * v, 0) / weight);

  return { probes, jitter, score, gatewaySilent };
}

export function rating(score: number): { label: string; tone: 'success' | 'warning' | 'destructive' } {
  if (score >= 85) return { label: 'Excellent', tone: 'success' };
  if (score >= 70) return { label: 'Good', tone: 'success' };
  if (score >= 50) return { label: 'Fair', tone: 'warning' };
  return { label: 'Poor', tone: 'destructive' };
}
