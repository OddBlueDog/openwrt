// A member's latency probes, through every phase of a run: small HTTP
// requests, one at a time, to the router's own web server (a 1-byte file)
// and to an internet host on another address than the loads (so a probe
// never waits behind a load's own data). A browser can't ping: these run
// over TCP, so a lost packet shows as a late answer, not as loss (the
// router's pings and the WebRTC probes count loss). Each probe's time
// comes from Resource Timing where the server allows it (the router's
// answers: request sent to first byte back), else the browser's whole
// fetch.
import type { Clock } from './clock';
import type { RunRecord } from './member';
import { aborted } from './wan';

/** The internet hosts the plan may name (Vultr's latency hosts, as Network Quality's routes). */
export const latencyTargets = {
  uk: { label: 'London', host: 'lon-gb-ping.vultr.com' },
  eu: { label: 'Frankfurt', host: 'fra-de-ping.vultr.com' },
  us: { label: 'New Jersey', host: 'nj-us-ping.vultr.com' },
} as const;
export type LatencyTarget = keyof typeof latencyTargets;

/** A probe that takes longer is given up: recorded with no time (late, not lost). */
const TIMEOUT_MS = 2000;

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/** How long a request took on the wire: Resource Timing's request-to-first-byte where it's allowed, else its whole duration. */
export function wireMs(e: PerformanceResourceTiming | undefined): number | undefined {
  if (e === undefined) return undefined;
  if (e.requestStart > 0 && e.responseStart >= e.requestStart) return e.responseStart - e.requestStart;
  return e.duration > 0 ? e.duration : undefined;
}

async function entryFor(url: string): Promise<PerformanceResourceTiming | undefined> {
  // the entry lands once the response is complete: a task later at most
  await new Promise((r) => setTimeout(r, 0));
  const list = performance.getEntriesByName(new URL(url, window.location.href).href, 'resource');
  return list[list.length - 1] as PerformanceResourceTiming | undefined;
}

export interface ProbeLine {
  /** 'r': the router, 'w': the internet */
  target: 'r' | 'w';
  url: (n: number) => string;
  method: 'GET' | 'HEAD';
  everyMs: number;
}

export function routerProbe(): ProbeLine {
  return { target: 'r', url: (n) => `${import.meta.env.BASE_URL}bench-ping?n=${String(n)}`, method: 'GET', everyMs: 250 };
}

export function internetProbe(target: LatencyTarget): ProbeLine {
  const host = latencyTargets[target].host;
  return { target: 'w', url: (n) => `https://${host}/vultr.com.100MB.bin?mfb=${String(n)}`, method: 'HEAD', everyMs: 500 };
}

/**
 * Probes `line` every `everyMs` until `signal` aborts, one at a time (a
 * tick while one is out is skipped: the late one shows the delay). The
 * first two (DNS, connection setup) aren't recorded. `last` gets each
 * time, for the live figures.
 */
export async function probe(line: ProbeLine, clock: Clock, signal: AbortSignal, record: (r: RunRecord) => void, last: (ms: number) => void): Promise<void> {
  let n = 0;
  let next = performance.now();
  while (!signal.aborted) {
    const url = line.url(n);
    const t0 = performance.now();
    const sent = clock.router(t0);
    let ms: number | null = null;
    try {
      const res = await fetch(url, {
        method: line.method,
        cache: 'no-store',
        credentials: 'omit',
        mode: line.target === 'r' ? 'same-origin' : 'cors',
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      });
      await res.arrayBuffer();
      const t1 = performance.now();
      // an error page is no answer: the probe's target is missing or broken
      if (res.ok) ms = wireMs(await entryFor(url)) ?? t1 - t0;
    } catch {
      if (aborted(signal)) return;
    }
    if (n >= 2 && sent !== undefined) {
      record(['rtt', line.target, n, Math.round(sent * 10) / 10, ms === null ? null : Math.round(ms * 100) / 100]);
      if (ms !== null) last(ms);
    }
    n++;
    next += line.everyMs;
    const now = performance.now();
    if (next < now) next = now;
    await sleep(next - now, signal);
  }
}
