// DNS and page loads from a member's browser, in the DNS and
// busy-household phases: a round every ROUND_MS through a fixed list of
// popular sites (and the plan's own). For each site:
// - a made-up name under it (mfb-<random>.<site>): nothing has it cached,
//   so the fetch fails once the router's DNS says there's no such name. Its
//   time is that lookup, with the browser's own error handling.
// - the site's favicon twice, cache-busted, without cookies: "first" is the
//   run's first fetch of the site from this device, normally a new
//   connection (DNS, TCP, TLS, request, response); "repeat" reuses it.
// These sites send no Timing-Allow-Origin, so a fetch's Resource Timing is
// one lumped duration: nothing finer can be told apart. The router looks up
// the same names itself (bin/bench-dns, the same list).
import type { Clock } from './clock';
import type { RunRecord } from './member';
import { sleep } from './probes';
import { aborted } from './wan';

export interface Site {
  /** the registrable name, under which made-up names go */
  site: string;
  /** the host a browser loads */
  host: string;
}

/** The fixed list, as the router's (bin/bench-dns). */
export const SITES: readonly Site[] = [
  'google.com',
  'youtube.com',
  'facebook.com',
  'instagram.com',
  'reddit.com',
  'bbc.co.uk',
  'wikipedia.org',
  'amazon.co.uk',
  'netflix.com',
  'apple.com',
].map((site) => ({ site, host: `www.${site}` }));

/** A plan's own sites, at most this many, as the router takes them. */
export const MAX_CUSTOM_SITES = 8;

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function validHost(s: string): boolean {
  return s.length <= 253 && HOST.test(s);
}

/** Host names typed into a list (commas, spaces or new lines between them): the good ones, once each, and the rest. */
export function parseSites(text: string): { sites: string[]; bad: string[] } {
  const sites: string[] = [];
  const bad: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const name = raw
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '')
      .replace(/\.$/, '');
    if (name === '') continue;
    if (!validHost(name)) bad.push(raw.trim());
    else if (!sites.includes(name) && !SITES.some((s) => s.site === name || s.host === name)) sites.push(name);
  }
  return { sites, bad };
}

/** The fixed list and a plan's own sites (loaded as they're named). */
export function siteList(custom: readonly string[] = []): Site[] {
  return [...SITES, ...custom.slice(0, MAX_CUSTOM_SITES).filter(validHost).map((name) => ({ site: name, host: name }))];
}

/** A round at most this often; a made-up name's lookup and a page fetch are given up after these. */
const ROUND_MS = 5000;
const COLD_TIMEOUT_MS = 5000;
const PAGE_TIMEOUT_MS = 10_000;

function randomLabel(): string {
  const b = new Uint8Array(5);
  crypto.getRandomValues(b);
  return `mfb-${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

/** The Resource Timing entry for a URL: an opaque response's lands when it's complete, which can be after fetch() resolves. */
async function entryFor(url: string, signal: AbortSignal): Promise<PerformanceResourceTiming | undefined> {
  const href = new URL(url).href;
  for (let i = 0; i < 20 && !signal.aborted; i++) {
    const list = performance.getEntriesByName(href, 'resource');
    const e = list[list.length - 1] as PerformanceResourceTiming | undefined;
    if (e !== undefined && e.responseEnd > 0) return e;
    await sleep(50, signal);
  }
  return undefined;
}

const round2 = (ms: number): number => Math.round(ms * 100) / 100;

/** A made-up name's fetch: how long until it failed (the lookup said no such name), or that it got an answer (the site answers any name). */
async function cold(s: Site, clock: Clock, signal: AbortSignal, record: (r: RunRecord) => void): Promise<number | undefined> {
  const t0 = performance.now();
  const t = clock.router(t0);
  let ms: number | null = null;
  let outcome: 'failed' | 'answered' | 'timeout' = 'failed';
  try {
    await fetch(`https://${randomLabel()}.${s.site}/favicon.ico`, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(COLD_TIMEOUT_MS)]),
    });
    outcome = 'answered';
  } catch {
    if (aborted(signal)) return undefined;
    if (performance.now() - t0 >= COLD_TIMEOUT_MS - 50) outcome = 'timeout';
  }
  if (outcome !== 'timeout') ms = round2(performance.now() - t0);
  if (t !== undefined) record(['cold', s.site, Math.round(t), ms, outcome]);
  return outcome === 'failed' && ms !== null ? ms : undefined;
}

/** A page's favicon, cache-busted: its whole time, or null if it failed. */
async function page(s: Site, kind: 'first' | 'repeat', clock: Clock, signal: AbortSignal, record: (r: RunRecord) => void): Promise<number | undefined> {
  const url = `https://${s.host}/favicon.ico?mfb=${randomLabel()}`;
  const t0 = performance.now();
  const t = clock.router(t0);
  let ms: number | null = null;
  try {
    const res = await fetch(url, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)]),
    });
    const t1 = performance.now();
    await res.arrayBuffer();
    const e = await entryFor(url, signal);
    ms = round2(e !== undefined && e.duration > 0 ? e.duration : t1 - t0);
  } catch {
    if (aborted(signal)) return undefined;
  }
  if (t !== undefined) record(['page', s.site, Math.round(t), ms, kind]);
  return ms ?? undefined;
}

/**
 * Rounds through the sites until `signal` aborts, at most one every
 * ROUND_MS. `loaded` holds the sites this member has fetched in the run (a
 * site's first fetch is "first"); `last` gets each time, for the live figures.
 */
export async function pageRounds(
  sites: readonly Site[],
  clock: Clock,
  signal: AbortSignal,
  record: (r: RunRecord) => void,
  loaded: Set<string>,
  last: (kind: 'page' | 'lookup', ms: number) => void,
): Promise<void> {
  while (!signal.aborted) {
    const began = performance.now();
    for (const s of sites) {
      if (aborted(signal)) return;
      const c = await cold(s, clock, signal, record);
      if (c !== undefined) last('lookup', c);
      for (let i = 0; i < 2 && !aborted(signal); i++) {
        const kind = loaded.has(s.site) ? 'repeat' : 'first';
        loaded.add(s.site);
        const ms = await page(s, kind, clock, signal, record);
        if (ms !== undefined) last('page', ms);
      }
    }
    await sleep(Math.max(0, ROUND_MS - (performance.now() - began)), signal);
  }
}
