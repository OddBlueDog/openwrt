// The Network Quality page's DNS servers: a name for each (the DNS page's
// provider when it's one of them) and a chart line for each, from the
// probe's samples or history.
// No imports from the app, so the tests (ui/tests) load it as it is.

import { parseLocalKey, programCaches, programName } from '../dns/programs.ts';
import { type DnsProvider, providers } from '../dns/providers.ts';

/** The host of an encrypted DNS address: "tls://one.one.one.one" → "one.one.one.one". */
function hostOf(url: string): string | undefined {
  return /^[a-z]+:\/\/([^/:]+)/.exec(url)?.[1];
}

/**
 * A DNS server's name from its key (host name or address): the provider,
 * with the server's name unless it's the provider's first ("Cloudflare",
 * "Cloudflare Family"); undefined when it's none of the DNS page's.
 */
export function providerName(key: string): string | undefined {
  // the probe's line for AdGuard Home on the router, in front of the servers
  if (key === 'adguardhome') return 'AdGuard Home (this router)';
  // a DNS program on the router set up outside MilkFlint (ctrld, ...): timed through it
  const local = parseLocalKey(key);
  if (local !== undefined)
    return `${local.program === undefined ? `Port ${String(local.port)}` : programName(local.program)} (this router)`;
  const all: readonly DnsProvider[] = Object.values(providers);
  for (const p of all) {
    for (const [i, s] of p.servers.entries()) {
      const hosts = [s.doh, s.dot, s.doq ?? ''].map(hostOf);
      if (hosts.includes(key) || s.v4.includes(key) || s.v6.includes(key)) return i === 0 ? p.label : `${p.label} ${s.name}`;
    }
  }
  return undefined;
}

/**
 * The notes under the DNS rows, from the servers' keys (the main one first):
 * the encrypted servers' are asked over plain DNS; which one the score uses;
 * a program on the router answering repeat lookups from its own cache.
 */
export function dnsNotes(keys: readonly string[]): string[] {
  const local = keys.map(parseLocalKey);
  // an encrypted server: keyed by its host name
  const encrypted = keys.some((k, i) => local[i] === undefined && k !== 'adguardhome' && !/^[0-9.:#]+$/.test(k));
  const notes: string[] = [];
  if (keys.length > 1)
    notes.push(
      encrypted
        ? 'Each DNS server is asked over plain DNS at its address, the same server your encrypted lookups reach; the score uses the first.'
        : 'The score uses the first.',
    );
  const caching = new Set(
    local.flatMap((l) => (l?.program !== undefined && programCaches(l.program) ? [programName(l.program)] : [])),
  );
  for (const name of caching) notes.push(`${name} answers repeat lookups from its own cache, so its times are mostly near zero.`);
  return notes;
}

export interface DnsLine {
  /** The DNS server's key, or '' for the line from before the probe asked each server. */
  key: string;
  label: string;
  /** One of the servers asked now. */
  current: boolean;
  values: (number | undefined)[];
}

/**
 * A line per DNS server over `points` (samples or history buckets, oldest
 * first): the servers asked now (`order`), then ones asked earlier in the
 * span; points from before the probe asked each server (no per-server
 * values) make a last line of their own, "DNS (earlier)".
 */
export function dnsLines<P>(
  points: readonly P[],
  servers: (p: P) => Record<string, number | null | undefined> | undefined,
  single: (p: P) => number | null | undefined,
  order: readonly string[],
): DnsLine[] {
  const keys = [...order];
  for (const p of points) for (const k of Object.keys(servers(p) ?? {})) if (!keys.includes(k)) keys.push(k);
  const seen = (k: string): boolean => points.some((p) => servers(p)?.[k] !== undefined);
  const lines: DnsLine[] = keys
    .filter((k) => order.includes(k) || seen(k))
    .map((k) => ({
      key: k,
      label: providerName(k) ?? k,
      current: order.includes(k),
      values: points.map((p) => servers(p)?.[k] ?? undefined),
    }));
  if (points.some((p) => servers(p) === undefined && single(p) !== null && single(p) !== undefined)) {
    lines.push({
      key: '',
      label: 'DNS (earlier)',
      current: false,
      values: points.map((p) => (servers(p) === undefined ? (single(p) ?? undefined) : undefined)),
    });
  }
  return lines;
}
