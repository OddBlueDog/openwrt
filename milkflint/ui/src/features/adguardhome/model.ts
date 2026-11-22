// The AdGuard Home page's model: what its state means in words, the sign-in
// form's checks, the updates' choices and the networks it can tell apart.
// AdGuard Home does the filtering, set in its own web interface; MilkFlint
// turns it on and off and keeps the DNS chain around it (the router's
// adguardhome feature).
import { intToIp, ipToInt } from '@/lib/api/network';
import type { AdGuardStatus, Network, Setting, State, UpdateInfo } from './api';

/** MilkFlint's own account in AdGuard Home (for its figures); not for people. */
export const API_USER = 'milkflint';
const USER = /^[A-Za-z0-9._@-]{1,64}$/;

export interface Credentials {
  user: string;
  password: string;
  again: string;
}

export function validateCredentials(c: Credentials): Partial<Record<keyof Credentials, string>> {
  const e: Partial<Record<keyof Credentials, string>> = {};
  if (!USER.test(c.user)) e.user = 'Letters, digits and . _ @ -, up to 64.';
  else if (c.user === API_USER) e.user = 'That one is MilkFlint’s own: choose another.';
  // bcrypt uses 72 bytes of a password; golang's refuses longer ones
  const bytes = new TextEncoder().encode(c.password).length;
  if (c.password.length < 8) e.password = 'At least 8 characters.';
  else if (bytes > 72) e.password = 'At most 72 bytes (fewer characters with accents or emoji).';
  else if (/[\r\n]/.test(c.password)) e.password = 'On one line.';
  if (c.again !== c.password) e.again = 'The two don’t match.';
  return e;
}

export type Tone = 'success' | 'warning' | 'muted' | 'info';

/** Its state as a badge and a sentence. */
export function describeState(s: AdGuardStatus): { tone: Tone; label: string; text: string } {
  const state: State = s.enabled === true ? (s.state ?? 'starting') : 'off';
  if (s.mode === 'ap')
    return { tone: 'muted', label: 'Not used', text: 'In access point mode the main router answers your devices’ DNS lookups.' };
  switch (state) {
    case 'active':
      return {
        tone: 'success',
        label: 'Filtering',
        text: 'Your devices’ lookups go through AdGuard Home, then to the DNS page’s servers.',
      };
    case 'starting':
      return {
        tone: 'info',
        label: 'Starting',
        text: 'It’s loading its lists. Until it answers, the router answers your devices’ lookups itself, unfiltered.',
      };
    case 'fallback':
      return {
        tone: 'warning',
        label: s.reason === 'stopped' ? 'Stopped' : 'Not answering',
        text:
          s.reason === 'stopped'
            ? 'AdGuard Home stopped. Your devices still get answers, unfiltered, from the router itself; it’s started again every few minutes.'
            : 'AdGuard Home isn’t answering. Your devices still get answers, unfiltered, from the router itself, until it does again.',
      };
    case 'blocking':
      return {
        tone: 'warning',
        label: s.reason === 'stopped' ? 'Stopped' : 'Not answering',
        text:
          s.reason === 'stopped'
            ? 'AdGuard Home stopped. Your devices’ lookups fail until it’s back, so nothing gets through unfiltered; it’s started again every 30 seconds.'
            : 'AdGuard Home isn’t answering. Your devices’ lookups fail until it does again, so nothing gets through unfiltered.',
      };
    case 'off':
      return { tone: 'muted', label: 'Off', text: 'Your devices’ lookups go straight to the DNS page’s servers, unfiltered.' };
  }
}

/**
 * Whether to warn: on, and lookups are going round it (fallback) or failing
 * until it's back (blocking), or a setting breaks the chain.
 */
export function needsAttention(s: AdGuardStatus | undefined): { fallback: boolean; blocking: boolean; broken: Setting[] } {
  if (s?.installed !== true || s.enabled !== true || s.mode === 'ap') return { fallback: false, blocking: false, broken: [] };
  return {
    fallback: s.state === 'fallback',
    blocking: s.state === 'blocking',
    broken: (s.settings ?? []).filter((x) => x.breaks),
  };
}

/** "v0.107.80" from the package's 0.107.80-r1 (its release number is MilkFlint's). */
export function versionLabel(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return 'unknown';
  const m = /^([0-9][0-9a-z.]*)-r([0-9]+)$/.exec(v);
  if (m === null) return v;
  return m[2] === '1' ? `v${m[1] ?? ''}` : `v${m[1] ?? ''} (build ${m[2] ?? ''})`;
}

/** The share of lookups it blocked, e.g. "12.4%"; undefined before any. */
export function blockedShare(stats: AdGuardStatus['stats']): string | undefined {
  return stats === null || stats === undefined ? undefined : shareOf(stats.blocked, stats.queries);
}

/** What share of the lookups were blocked, as its dashboard says it: "4.2%", "12%". */
export function shareOf(blocked: number, queries: number): string | undefined {
  if (queries <= 0) return undefined;
  const p = (blocked / queries) * 100;
  return `${p < 10 ? p.toFixed(1) : p.toFixed(0)}%`;
}

/** apk's order of two versions (0.107.80-r1 after 0.107.79-r3), numbers as numbers. */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/-r/, '.').split('.');
  const pb = b.replace(/-r/, '.').split('.');
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = Number(pa[i] ?? 0);
    const y = Number(pb[i] ?? 0);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export interface UpdateChoice {
  installed: string | undefined;
  latest: string | undefined;
  /** The feed has a newer one than the installed one. */
  newer: boolean;
  /** Earlier versions to go back to, newest first. */
  earlier: string[];
  /** Installed as an earlier version on purpose (pinned until the next update). */
  pinned: boolean;
}

export function updateChoice(installed: string | null | undefined, u: UpdateInfo | null | undefined): UpdateChoice {
  const have = installed ?? undefined;
  const versions = [...(u?.versions ?? [])].sort((a, b) => compareVersions(b, a));
  const latest = u?.latest ?? versions[0] ?? undefined;
  return {
    installed: have,
    latest,
    newer: have !== undefined && latest !== undefined && compareVersions(latest, have) > 0,
    earlier: have === undefined ? [] : versions.filter((v) => compareVersions(v, have) < 0),
    pinned: (u?.pinned ?? undefined) !== undefined && u?.pinned === have,
  };
}

export interface NetworkRow {
  label: string;
  subnets: string[];
}

/** The networks it can tell apart, each with the subnets to give AdGuard Home's clients (it knows devices by address, not MAC). */
export function networkRows(
  networks: readonly Network[] | undefined,
  guestLabel: (zone: string) => string | undefined,
): NetworkRow[] {
  const order = (n: Network): number => (n.zone === 'lan' ? 0 : n.zone === 'wg_in' ? 2 : 1);
  return [...(networks ?? [])]
    .sort((a, b) => (order(a) !== order(b) ? order(a) - order(b) : a.interface.localeCompare(b.interface)))
    .map((n) => ({
      label: n.zone === 'lan' ? 'Home network' : n.zone === 'wg_in' ? 'Remote access' : (guestLabel(n.zone) ?? n.interface),
      subnets: [...n.ipv4.map(networkOf), ...n.ipv6],
    }))
    .filter((r) => r.subnets.length > 0);
}

/** 192.168.1.1/24 → 192.168.1.0/24: the subnet, not the router's address. */
export function networkOf(cidr: string): string {
  const [ip, len] = cidr.split('/');
  const n = ipToInt(ip ?? '');
  const bits = Number(len);
  if (n === undefined || !Number.isInteger(bits) || bits < 0 || bits > 32) return cidr;
  const size = 2 ** (32 - bits);
  return `${intToIp(n - (n % size))}/${String(bits)}`;
}

const IPV4 = /^[0-9]+(?:\.[0-9]+){3}$/;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/**
 * Where to open AdGuard Home so the session cookie set on `pageHostname`
 * reaches it (cookies are shared across ports on one host, not across
 * different IP addresses). A router name like `milkflint.lan` resolves to
 * the router's home address, so it swaps in cleanly; a different IP (e.g. a
 * WireGuard tunnel address or IPv6) can't carry the cookie to `url`'s IP.
 */
export function adGuardOpenTarget(url: string, pageHostname: string): { url: string; sameHost: boolean; host: string } {
  try {
    const u = new URL(url);
    const host = pageHostname.trim().toLowerCase();
    if (host === u.hostname.toLowerCase()) return { url: u.toString(), sameHost: true, host: u.hostname };
    // A DNS name (not localhost, not an IPv4/IPv6 literal): e.g. milkflint.lan
    if (host !== '' && host !== 'localhost' && !host.includes(':') && !IPV4.test(host) && HOSTNAME.test(host)) {
      u.hostname = host;
      return { url: u.toString(), sameHost: true, host };
    }
    return { url: u.toString(), sameHost: false, host: u.hostname };
  } catch {
    return { url, sameHost: false, host: '' };
  }
}

// ---- what it's seeing (its statistics) ----

/** One slot of its series: an hour, or a day. */
export function slotSeconds(unit: 'hours' | 'days' | undefined): number {
  return unit === 'days' ? 86_400 : 3_600;
}

/** Its window in words: "24 hours", "7 days". */
export function windowText(slots: number, unit: 'hours' | 'days' | undefined): string {
  const word = unit === 'days' ? 'day' : 'hour';
  return `${String(slots)} ${word}${slots === 1 ? '' : 's'}`;
}

/**
 * When each slot of a series ends, oldest first: the last one is the slot going
 * on now, which ends at `at`, so the line reaches "now". Slots are whole hours
 * (or days) of the router's clock, as AdGuard Home counts them.
 */
export function slotTimes(count: number, unit: 'hours' | 'days' | undefined, at: number): number[] {
  const step = slotSeconds(unit);
  const current = Math.floor(at / step) * step;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? at : current - (count - 2 - i) * step));
}

/** Address → the name the router knows a device by (host hints: leases, neighbours, /etc/ethers). */
export function namesByAddress(
  hints: Readonly<Record<string, { name?: string | undefined; ipaddrs?: string[] | undefined; ip6addrs?: string[] | undefined }>>,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const h of Object.values(hints)) {
    const name = h.name?.split('.')[0];
    if (name === undefined || name === '') continue;
    for (const ip of [...(h.ipaddrs ?? []), ...(h.ip6addrs ?? [])]) out.set(ip.toLowerCase(), name);
  }
  return out;
}
