// Encrypted DNS with a main server and, optionally, a backup from another
// provider: what dnsproxy gets (its upstreams, fallback, bootstrap and mode)
// and what to warn about when the two don't filter the same sites or one
// doesn't check DNSSEC; and how long instant answers (dnsproxy's optimistic
// cache) keep old answers.
// No imports from the app, so the tests (ui/tests) load it as it is.

import { type Block, blockLabels, type DnsServer, type Proto, protoLabels, protoOf, type ProviderId, providers, urlFor } from './providers.ts';

/** A provider's server (by name), or a custom address. */
export interface ServerPick {
  provider: ProviderId | 'custom';
  server: string;
  custom: string;
}

/**
 * How the backup is used: `parallel` asks both and takes the first answer,
 * `fallback` asks the backup only when the main server fails or times out.
 */
export type BackupUse = 'parallel' | 'fallback';

/** How long dnsproxy waits for an answer before it gives up on a server, in seconds. */
export const TIMEOUT_S = 3;

export function serversOf(provider: ProviderId | 'custom'): readonly DnsServer[] {
  return provider === 'custom' ? [] : providers[provider].servers;
}

/** The chosen server of a provider (the first if the saved one is gone). */
export function serverOf(pick: ServerPick): DnsServer | undefined {
  const servers = serversOf(pick.provider);
  return servers.find((s) => s.name === pick.server) ?? servers[0];
}

/** The server of a provider that filters the same as `blocks`, else its first. */
export function matchingServer(provider: ProviderId, blocks: readonly Block[] | undefined): string {
  const servers = providers[provider].servers;
  const same = blocks === undefined ? undefined : servers.find((s) => sameBlocks(s.blocks, blocks));
  return (same ?? servers[0]).name;
}

function sameBlocks(a: readonly Block[], b: readonly Block[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x));
}

/** The encrypted address to use: the provider's for `proto`, or DoH where it has none. */
export function encryptedUrl(pick: ServerPick, proto: Proto): string | undefined {
  if (pick.provider === 'custom') return pick.custom.trim() === '' ? undefined : pick.custom.trim();
  const server = serverOf(pick);
  return server === undefined ? undefined : (urlFor(server, proto) ?? server.doh);
}

/** The backup's encryption type: the main server's, from its address when that's custom. */
export function backupProto(main: ServerPick, proto: Proto): Proto {
  if (main.provider !== 'custom') return proto;
  const p = protoOf(main.custom.trim());
  return p === 'dot' || p === 'doq' ? p : 'doh';
}

export interface ProxyServers {
  upstream: string[];
  fallback: string[];
  /** Plain DNS servers dnsproxy asks for the encrypted servers' own addresses. */
  bootstrap: string[];
  /** dnsproxy's upstream_mode; undefined leaves its default (one server at a time). */
  mode: 'parallel' | undefined;
}

/** What dnsproxy is set to for a main server and an optional backup. */
export function proxyServers(main: ServerPick, proto: Proto, backup: ServerPick | undefined, use: BackupUse): ProxyServers {
  const mainUrl = encryptedUrl(main, proto);
  const backupUrl = backup === undefined ? undefined : encryptedUrl(backup, backupProto(main, proto));
  const plain = (pick: ServerPick): readonly string[] => (pick.provider === 'custom' ? ['1.1.1.1', '9.9.9.9'] : (serverOf(pick)?.v4 ?? []));
  const bootstrap = [...new Set([...plain(main), ...(backup === undefined ? [] : plain(backup))])].map((ip) => `${ip}:53`);
  if (mainUrl === undefined) return { upstream: [], fallback: [], bootstrap, mode: undefined };
  if (backupUrl === undefined || backupUrl === mainUrl) return { upstream: [mainUrl], fallback: [], bootstrap, mode: undefined };
  return use === 'parallel'
    ? { upstream: [mainUrl, backupUrl], fallback: [], bootstrap, mode: 'parallel' }
    : { upstream: [mainUrl], fallback: [backupUrl], bootstrap, mode: undefined };
}

/** A server's name for a sentence: "Cloudflare Family", or "the custom server". */
export function serverLabel(pick: ServerPick): string {
  if (pick.provider === 'custom') return 'the custom server';
  const server = serverOf(pick);
  return server === undefined ? providers[pick.provider].label : `${providers[pick.provider].label} ${server.name}`;
}

function blockList(blocks: readonly Block[]): string {
  const names = blocks.map((b) => blockLabels[b]);
  const last = names.pop();
  return last === undefined ? 'nothing' : names.length === 0 ? last : `${names.join(', ')} and ${last}`;
}

/**
 * Why the pair may let blocked sites through, if it can: with both asked at
 * once whichever answers first wins, so any difference shows; as a fallback
 * only what the main server blocks and the backup doesn't.
 */
export function filterWarning(main: ServerPick, backup: ServerPick, use: BackupUse): string | undefined {
  const a = main.provider === 'custom' ? undefined : serverOf(main)?.blocks;
  const b = backup.provider === 'custom' ? undefined : serverOf(backup)?.blocks;
  if (a === undefined || b === undefined) {
    if (use === 'fallback' && a?.length === 0) return undefined;
    return use === 'parallel'
      ? 'Check that both servers block the same sites: with both asked at once, the first answer is used.'
      : `Check that ${serverLabel(backup)} blocks what ${serverLabel(main)} blocks: its answers are used while the main server isn't answering.`;
  }
  if (use === 'parallel') {
    if (sameBlocks(a, b)) return undefined;
    return `${serverLabel(main)} blocks ${blockList(a)}, ${serverLabel(backup)} blocks ${blockList(b)}. With both asked at once, whether those sites load depends on which answers first.`;
  }
  const missing = a.filter((x) => !b.includes(x));
  if (missing.length === 0) return undefined;
  return `While ${serverLabel(main)} isn't answering, ${blockList(missing)} can get through ${serverLabel(backup)}, which doesn't block ${missing.length === 1 ? 'it' : 'them'}.`;
}

/** One server, or two: both asked at once ('parallel'), or the second only when the first fails ('fallback'). */
export type Pair = 'one' | BackupUse;

const splitList = (v: string): string[] => v.split(/[\s,]+/).filter((x) => x !== '');

/**
 * Plain DNS: the addresses dnsmasq forwards to. One server: all its
 * provider's addresses (or the custom list); two: each's first IPv4 and
 * IPv6 address, the main one's first (dnsmasq's strictorder asks them in
 * that order, allservers all at once).
 */
export function plainServers(main: ServerPick, backup: ServerPick | undefined): string[] {
  const all = (p: ServerPick): string[] => {
    if (p.provider === 'custom') return splitList(p.custom);
    const s = serverOf(p);
    return [...(s?.v4 ?? []), ...(s?.v6 ?? [])];
  };
  const firsts = (p: ServerPick): string[] => {
    if (p.provider === 'custom') return splitList(p.custom);
    const s = serverOf(p);
    return [s?.v4[0], s?.v6[0]].filter((x): x is string => x !== undefined);
  };
  return backup === undefined ? all(main) : [...new Set([...firsts(main), ...firsts(backup)])];
}

/** A server's name in a sentence: its provider, with the server's name unless it's the provider's first ("Cloudflare", "Cloudflare Family"). */
export function shortName(pick: ServerPick): string {
  if (pick.provider === 'custom') return 'your custom server';
  const s = serverOf(pick);
  const p = providers[pick.provider];
  return s === undefined || s.name === p.servers[0].name ? p.label : `${p.label} ${s.name}`;
}

/**
 * A good second server for `main`: another provider's that filters the same
 * and checks DNSSEC, in the DNS page's order; else the first other
 * provider's closest server.
 */
export function suggestBackup(main: ServerPick): { provider: ProviderId; server: string } {
  const blocks = main.provider === 'custom' ? [] : (serverOf(main)?.blocks ?? []);
  const others = (Object.keys(providers) as ProviderId[]).filter((id) => id !== main.provider);
  for (const id of others) {
    const same = providers[id].servers.find((s: DnsServer) => s.dnssec && sameBlocks(s.blocks, blocks));
    if (same !== undefined) return { provider: id, server: same.name };
  }
  const first = others[0] ?? 'cloudflare';
  return { provider: first, server: matchingServer(first, blocks) };
}

/** What happens to a lookup, in a sentence: the DNS page's summary. */
export function describe(mode: 'auto' | 'static' | 'encrypted', main: ServerPick, backup: ServerPick | undefined, pair: Pair): string {
  if (mode === 'auto') return 'Lookups go to your internet provider’s DNS servers.';
  const how = mode === 'encrypted' ? 'encrypted' : 'unencrypted';
  const a = shortName(main);
  if (backup === undefined || pair === 'one') return `Lookups go ${how} to ${a}.`;
  const b = shortName(backup);
  return pair === 'parallel'
    ? `Each lookup goes ${how} to ${a} and ${b} at once; the first answer is used.`
    : `Lookups go ${how} to ${a}, and to ${b} only when ${a} ${mode === 'encrypted' ? 'fails or is slow' : 'doesn’t answer'}.`;
}

/**
 * When the second server can't use the chosen encryption type: which server
 * falls back to DNS over HTTPS ("Google doesn't offer DNS over QUIC, so it
 * uses DNS over HTTPS"). Undefined when it can, or when either is custom (a
 * custom address says its own type, and the type is then the custom main
 * server's).
 */
export function protoNote(main: ServerPick, backup: ServerPick | undefined, proto: Proto): string | undefined {
  if (backup === undefined || main.provider === 'custom' || backup.provider === 'custom') return undefined;
  const server = serverOf(backup);
  if (server === undefined || urlFor(server, proto) !== undefined) return undefined;
  const name = (p: Proto): string => protoLabels[p].replace(/ \(.*\)$/, '');
  return `${shortName(backup)} doesn’t offer ${name(proto)}, so it uses ${name('doh')}.`;
}

/** A server's description and whether it checks DNSSEC, for its field's hint. */
export function serverHint(server: DnsServer): string {
  return `${server.description} ${server.dnssec ? 'Checks DNSSEC.' : 'Doesn’t check DNSSEC.'}`;
}

/** When the main server doesn't check DNSSEC (the router doesn't either): what that means. */
export function dnssecWarning(main: ServerPick): string | undefined {
  if (main.provider === 'custom' || serverOf(main)?.dnssec !== false) return undefined;
  return `${serverLabel(main)} doesn’t check DNSSEC, the signatures that prove an answer came from the site’s owner, so a forged answer wouldn’t be caught. The router doesn’t check them itself; every other provider here does.`;
}

/** When the backup doesn't check DNSSEC: when its answers are used unchecked. */
export function backupDnssecWarning(backup: ServerPick, use: BackupUse): string | undefined {
  if (backup.provider === 'custom' || serverOf(backup)?.dnssec !== false) return undefined;
  return use === 'parallel'
    ? `${serverLabel(backup)} doesn’t check DNSSEC: with both asked at once, a forged answer it passes on could be the one used.`
    : `${serverLabel(backup)} doesn’t check DNSSEC: while the main server isn’t answering, a forged answer wouldn’t be caught.`;
}

/** How long instant answers may give out an answer after it expires, in hours: the choices, and dnsproxy's default. */
export const KEEP_HOURS = ['1', '6', '12', '24', '48'] as const;
export const DEFAULT_KEEP_HOURS = '12';

/** dnsproxy's optimistic_max_age ("12h", "720m") in whole hours; its default when unset or not whole hours. */
export function keepHoursOf(duration: string | undefined): string {
  const m = /^([0-9]+)(h|m)$/.exec(duration?.trim() ?? '');
  if (m === null) return DEFAULT_KEEP_HOURS;
  const n = Number(m[1]);
  const hours = m[2] === 'h' ? n : n % 60 === 0 ? n / 60 : 0;
  return hours > 0 ? String(hours) : DEFAULT_KEEP_HOURS;
}
