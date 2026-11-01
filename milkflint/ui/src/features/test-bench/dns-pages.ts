// DNS and page loads, from the router's lookups (dns.jsonl, bin/bench-dns)
// and the members' records ('cold', 'page'), per site. A site that answers
// any name under it (wildcard DNS) can't time a lookup by a made-up name
// failing: the router's own lookups show which those are, and their device
// lookups are left out.
import { z } from 'zod';
import { parseLines, percentile } from './analysis';
import type { RunRecord } from './member';

const dnsLine = z.object({
  t: z.number(),
  p: z.number(),
  s: z.string(),
  k: z.enum(['cold', 'up', 'warm', 'again']),
  ms: z.number().nullable(),
  rc: z.number().nullable(),
  n: z.number(),
  ttl: z.number().nullable(),
  fw: z.number().nullable(),
});
export type DnsLookup = z.output<typeof dnsLine>;

export interface RouterDns {
  /** what dnsmasq forwards to: dnsproxy (encrypted DNS), a plain server, or nothing known */
  upstream: 'dnsproxy' | 'server' | null;
  lookups: DnsLookup[];
}

export function parseDns(lines: readonly string[]): RouterDns {
  let upstream: RouterDns['upstream'] = null;
  for (const l of lines.slice(0, 1)) {
    try {
      const v = (JSON.parse(l) as { upstream?: unknown }).upstream;
      if (v === 'dnsproxy' || v === 'server') upstream = v;
    } catch {
      // not the first line it should be
    }
  }
  return { upstream, lookups: parseLines(lines, dnsLine) };
}

const median = (v: readonly number[]): number | undefined => percentile([...v].sort((a, b) => a - b), 0.5);

export interface Timed {
  /** median ms of the answered ones */
  median: number | undefined;
  n: number;
  /** no answer in time */
  failed: number;
}

function timed(ms: readonly (number | null)[]): Timed {
  const ok = ms.filter((x): x is number => x !== null);
  return { median: median(ok), n: ms.length, failed: ms.length - ok.length };
}

export interface RouterSite {
  site: string;
  /** a made-up name through dnsmasq, and straight to its upstream */
  cold: Timed;
  up: Timed;
  /** the site's own host through dnsmasq (each round twice, the second at once): the lookups it passed on, and those from its cache */
  passedOn: Timed;
  fromCache: Timed;
  /** each round's first lookup of the site: how many rounds, and in how many it was cached already */
  rounds: number;
  cachedFirst: number;
  /** a made-up name got addresses: the site answers any name under it */
  wildcard: boolean;
  /** lookups that came back with an error (SERVFAIL, REFUSED...), not "no such name" */
  errors: number;
}

const inWindow = (t: number, w: { from: number; to: number } | undefined): boolean => w === undefined || (t >= w.from && t < w.to);

/** The router's lookups per site, in the order first looked up. */
export function routerSites(lookups: readonly DnsLookup[], w?: { from: number; to: number }): RouterSite[] {
  const by = new Map<string, DnsLookup[]>();
  for (const l of lookups) {
    if (!inWindow(l.t, w)) continue;
    let list = by.get(l.s);
    if (list === undefined) by.set(l.s, (list = []));
    list.push(l);
  }
  return [...by].map(([site, ls]) => {
    const of = (k: DnsLookup['k']): DnsLookup[] => ls.filter((l) => l.k === k);
    // dnsmasq's counter didn't move: from its cache (null: the counter couldn't be read, so not known)
    const own = [...of('warm'), ...of('again')];
    return {
      site,
      cold: timed(of('cold').map((l) => l.ms)),
      up: timed(of('up').map((l) => l.ms)),
      passedOn: timed(own.filter((l) => l.fw !== null && l.fw > 0).map((l) => l.ms)),
      fromCache: timed(own.filter((l) => l.fw === 0).map((l) => l.ms)),
      rounds: of('warm').length,
      cachedFirst: of('warm').filter((l) => l.fw === 0).length,
      wildcard: ls.some((l) => (l.k === 'cold' || l.k === 'up') && l.rc === 0 && l.n > 0),
      // 0: no error, 3: no such name (what a made-up name should get)
      errors: ls.filter((l) => l.rc !== null && l.rc !== 0 && l.rc !== 3).length,
    };
  });
}

/** What dnsmasq adds to a lookup it forwards: the median, over sites, of through dnsmasq less straight to the upstream. */
export function dnsmasqAdds(sites: readonly RouterSite[]): number | undefined {
  const d = sites.flatMap((s) => (s.cold.median !== undefined && s.up.median !== undefined ? [s.cold.median - s.up.median] : []));
  return median(d);
}

export interface DeviceSite {
  site: string;
  /** made-up names: until each fetch failed, ms; and those that got an answer instead */
  lookups: number[];
  answered: number;
  /** the run's first fetch of the site's page from the device, and the repeats; failed fetches */
  first: number | undefined;
  repeats: number[];
  failed: number;
}

/** A member's DNS and page loads per site, in a window or the whole run. */
export function deviceSites(records: readonly RunRecord[], w?: { from: number; to: number }): Map<string, DeviceSite> {
  const out = new Map<string, DeviceSite>();
  const get = (site: string): DeviceSite => {
    let d = out.get(site);
    if (d === undefined) out.set(site, (d = { site, lookups: [], answered: 0, first: undefined, repeats: [], failed: 0 }));
    return d;
  };
  for (const r of records) {
    if (r[0] === 'cold' && inWindow(r[2], w)) {
      const d = get(r[1]);
      if (r[4] === 'answered') d.answered++;
      else if (r[4] === 'failed' && r[3] !== null) d.lookups.push(r[3]);
    } else if (r[0] === 'page' && inWindow(r[2], w)) {
      const d = get(r[1]);
      if (r[3] === null) d.failed++;
      else if (r[4] === 'first') d.first = r[3];
      else d.repeats.push(r[3]);
    }
  }
  return out;
}

export interface DeviceSummary {
  /** medians over sites of each site's median: made-up names' lookups (wildcard sites left out), first loads, repeats */
  lookup: number | undefined;
  first: number | undefined;
  repeat: number | undefined;
  /** fetches that failed, and the sites behind them */
  failed: number;
  sites: number;
}

export function deviceSummary(sites: ReadonlyMap<string, DeviceSite>, wildcards: ReadonlySet<string>): DeviceSummary {
  const lookups: number[] = [];
  const firsts: number[] = [];
  const repeats: number[] = [];
  let failed = 0;
  for (const d of sites.values()) {
    const l = median(d.lookups);
    if (l !== undefined && !wildcards.has(d.site) && d.answered === 0) lookups.push(l);
    if (d.first !== undefined) firsts.push(d.first);
    const r = median(d.repeats);
    if (r !== undefined) repeats.push(r);
    failed += d.failed;
  }
  return { lookup: median(lookups), first: median(firsts), repeat: median(repeats), failed, sites: sites.size };
}

/** The sites whose made-up names got answers, by the router's lookups or any device's. */
export function wildcardSites(router: readonly RouterSite[], devices: Iterable<ReadonlyMap<string, DeviceSite>>): Set<string> {
  const out = new Set(router.filter((s) => s.wildcard).map((s) => s.site));
  for (const m of devices) for (const d of m.values()) if (d.answered > 0) out.add(d.site);
  return out;
}

export { median as siteMedian };
