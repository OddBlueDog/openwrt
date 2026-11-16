// The banIP page's model: what banIP's state means in words, a feed's
// direction and port limit as banIP works them out, the presets, the memory
// a selection needs (the router's own estimate, bin/banip.uc, done here too
// so the meter moves as you choose), the lists' lines as banIP reads them,
// address arithmetic for the self-lockout checks, and the drops and log
// lines in words. Pure functions: tests/banip-model.test.ts.
import type { BanipStatus, Drop, Feed, Meta } from './api';
import { PRESETS, type PresetId, SPECIAL_FEEDS } from './feeds';
import { effective, type OptionName, type Options } from './options';

// ---- the state -----------------------------------------------------------------------

export type Tone = 'success' | 'warning' | 'muted' | 'info' | 'destructive';

const STAGES: Record<string, string> = {
  setup: 'setting up its table',
  lists: 'fetching and loading the lists',
  domains: 'looking up the domain names in your lists',
};

const ERRORS: Record<string, string> = {
  table_missing: 'Its rules aren’t loaded: something removed them.',
  'no wan interfaces': 'It didn’t find the internet connection. Is the internet up?',
  'no wan devices': 'It didn’t find the internet port. Is the internet up?',
};

/** banIP's error line in words (they're its own log lines) */
export function errorWords(reason: string | null | undefined): string {
  if (reason === null || reason === undefined || reason === '') return 'It stopped with an error.';
  const known = ERRORS[reason] ?? Object.entries(ERRORS).find(([k]) => reason.includes(k))?.[1];
  if (known !== undefined) return known;
  if (reason.includes('download utility')) return 'It found nothing to download with.';
  if (reason.includes('terminated unexpectedly')) return 'Its service stopped unexpectedly.';
  return `It stopped: “${reason}”.`;
}

export interface StateWords {
  tone: Tone;
  label: string;
  text: string;
}

export function describeState(s: BanipStatus): StateWords {
  switch (s.state ?? 'off') {
    case 'off':
      return { tone: 'muted', label: 'Off', text: 'Nothing is blocked. Choose how much to block below, then turn it on.' };
    case 'ap':
      return {
        tone: 'muted',
        label: 'Not used',
        text: 'In access point mode the main router faces the internet, so banIP stays off here.',
      };
    case 'updating': {
      const r = s.run;
      const stage = STAGES[r?.stage ?? ''] ?? 'starting';
      const n =
        r?.expected !== null && r?.expected !== undefined && r.expected > 0
          ? ` (${String(r.done ?? 0)} of ${String(r.expected)})`
          : '';
      return { tone: 'info', label: 'Updating lists', text: `banIP is ${stage}${r?.stage === 'lists' ? n : ''}.` };
    }
    case 'protecting':
      return {
        tone: 'success',
        label: 'Protecting',
        text: 'Connections from the listed addresses, and to them where a list says so, are blocked.',
      };
    case 'error':
      return { tone: 'destructive', label: 'Error', text: errorWords(s.reason) };
    case 'stopped':
      return {
        tone: 'warning',
        label: 'Stopped',
        text: 'It’s on, but its service isn’t running: nothing is blocked until it starts.',
      };
  }
}

/**
 * What turning banIP on does and costs, said while it's off: with nothing
 * chosen yet the switch starts the Recommended lists (the page's toggle).
 */
export function turnOnText(nothingChosen: boolean): string {
  return nothingChosen
    ? 'Turning it on downloads the Recommended lists and loads them into the router’s firewall. They use some of the router’s memory (Protection shows how much) and are downloaded again on a schedule, early in the morning by default.'
    : 'Turning it on downloads the lists chosen under Protection and loads them into the router’s firewall. They use some of the router’s memory (shown there) and are downloaded again on the schedule under Updates.';
}

// ---- a feed's direction and port limit ---------------------------------------------------

export type Direction = 'in' | 'out' | 'inout';

const DIR_LISTS: Record<Direction, OptionName> = { in: 'ban_feedin', out: 'ban_feedout', inout: 'ban_feedinout' };

const listOf = (o: Options, name: OptionName): readonly string[] => {
  const v = effective(o, name);
  return typeof v === 'string' ? (v === '' ? [] : v.split(/\s+/)) : v;
};

export function ownChain(feed: Pick<Feed, 'chain'> | undefined): Direction {
  const c = feed?.chain;
  return c === 'out' || c === 'inout' ? c : 'in';
}

/** The direction banIP blocks a feed in: a chosen one (ban_feedin, …out, …inout), else the feed's own. */
export function feedDirection(name: string, feed: Pick<Feed, 'chain'> | undefined, o: Options): Direction {
  if (listOf(o, 'ban_feedin').includes(name)) return 'in';
  if (listOf(o, 'ban_feedout').includes(name)) return 'out';
  if (listOf(o, 'ban_feedinout').includes(name)) return 'inout';
  return ownChain(feed);
}

/** Options with a feed's direction chosen: in a list only where it differs from the feed's own. */
export function withDirection(o: Options, name: string, dir: Direction, feed: Pick<Feed, 'chain'> | undefined): Options {
  const out: Options = { ...o };
  for (const [d, opt] of Object.entries(DIR_LISTS) as [Direction, OptionName][]) {
    const l = listOf(out, opt).filter((x) => x !== name);
    if (d === dir && dir !== ownChain(feed)) l.push(name);
    out[opt] = l;
  }
  return out;
}

export interface PortLimit {
  protocols: string[];
  ports: string[];
}

/** A feed's protocol/port limit (its flag), or null for every port. */
export function portLimit(flag: string | null | undefined): PortLimit | null {
  const words = (flag ?? '').split(/\s+/).filter((w) => w !== '');
  const protocols = words.filter((w) => w === 'tcp' || w === 'udp');
  const ports = words.filter((w) => /^\d+(-\d+)?$/.test(w));
  return protocols.length > 0 && ports.length > 0 ? { protocols, ports } : null;
}

export function limitText(l: PortLimit): string {
  const names: Record<string, string> = { '53': 'DNS', '80': 'web', '443': 'web', '853': 'DNS over TLS' };
  const known = [...new Set(l.ports.map((p) => names[p]).filter((x) => x !== undefined))];
  return `${l.protocols.map((p) => p.toUpperCase()).join(' and ')} ports ${l.ports.join(', ')}${known.length > 0 ? ` (${known.join(', ')})` : ''}`;
}

// ---- presets --------------------------------------------------------------------------

const sameSet = (a: readonly string[], z: readonly string[]): boolean => a.length === z.length && a.every((x) => z.includes(x));

/** The plain feeds of a selection: without the country and ASN feeds. */
export function plainFeeds(o: Options): string[] {
  return listOf(o, 'ban_feed').filter((f) => !(SPECIAL_FEEDS as readonly string[]).includes(f));
}

/** Which preset a selection is: the feeds exactly, at their own directions and ports, no countries or networks. */
export function presetOf(o: Options, enabled: boolean): PresetId {
  if (!enabled) return 'off';
  const feeds = plainFeeds(o);
  const special = listOf(o, 'ban_feed').some((f) => (SPECIAL_FEEDS as readonly string[]).includes(f));
  const overrides = ['ban_feedin', 'ban_feedout', 'ban_feedinout', 'ban_feedreset'].some(
    (k) => listOf(o, k as OptionName).length > 0,
  );
  if (!special && !overrides) {
    for (const p of PRESETS) if (p.feeds.length > 0 && sameSet(p.feeds, feeds)) return p.id;
  }
  return 'custom';
}

/** Options with a preset's feeds: countries and networks stay, the feeds' own directions and ports again. */
export function withPreset(o: Options, id: PresetId): Options {
  const p = PRESETS.find((x) => x.id === id);
  if (p === undefined || id === 'off' || id === 'custom') return o;
  const special = listOf(o, 'ban_feed').filter((f) => (SPECIAL_FEEDS as readonly string[]).includes(f));
  const out: Options = { ...o, ban_feed: [...p.feeds, ...special] };
  for (const k of ['ban_feedin', 'ban_feedout', 'ban_feedinout', 'ban_feedreset'] as const) {
    out[k] = listOf(o, k).filter((f) => (SPECIAL_FEEDS as readonly string[]).includes(f));
  }
  return out;
}

// ---- memory -----------------------------------------------------------------------------

export interface Selection {
  feeds: readonly string[];
  countries: readonly string[];
  asns: readonly string[];
  counters: boolean;
  split: number;
  cores: number | null;
  v4: boolean;
  v6: boolean;
}

export function selectionOf(o: Options, regions: ReadonlyMap<string, string>): Selection {
  const countries = [...listOf(o, 'ban_country')];
  const chosen = listOf(o, 'ban_region');
  for (const [code, region] of regions) if (chosen.includes(region) && !countries.includes(code)) countries.push(code);
  const auto = effective(o, 'ban_autodetect') !== '0';
  const cores = effective(o, 'ban_cores');
  return {
    feeds: listOf(o, 'ban_feed'),
    countries,
    asns: listOf(o, 'ban_asn'),
    counters: effective(o, 'ban_nftcount') === '1',
    split: Number.isNaN(Number(effective(o, 'ban_splitsize'))) ? 0 : Number(effective(o, 'ban_splitsize')),
    cores: typeof cores === 'string' && cores !== '' ? Number(cores) : null,
    v4: auto || effective(o, 'ban_protov4') === '1',
    v6: auto || effective(o, 'ban_protov6') === '1',
  };
}

export interface Estimate {
  entries: number;
  perEntry: number;
  keptKb: number;
  loadKb: number;
  /** each list's entries, for the catalogue */
  sizes: Record<string, number>;
  downloadKb: number;
}

/** What a selection costs, as the router works it out (bin/banip.uc estimate). */
export function estimate(sel: Selection, meta: Meta, known: Readonly<Record<string, number>>, cpus: number): Estimate {
  const bytes = meta.bytes;
  const per = bytes.kept + (bytes.copy ?? 0) + (sel.counters ? bytes.counter_base + bytes.counter_per_cpu * cpus : 0);
  const fams = [...(sel.v4 ? ['v4' as const] : []), ...(sel.v6 ? ['v6' as const] : [])];
  const sizes: number[] = [];
  const byFeed: Record<string, number> = {};
  let downloadKb = 0;
  for (const f of sel.feeds) {
    if (f === 'country' || f === 'asn') continue;
    const m = meta.feeds[f];
    downloadKb += m?.kb ?? 0;
    for (const v of fams) {
      const n = known[`${f}.${v}`] ?? m?.[v] ?? (v === 'v4' && m === undefined ? meta.unknown_entries : 0);
      if (n > 0) {
        sizes.push(n);
        byFeed[f] = (byFeed[f] ?? 0) + n;
      }
    }
  }
  if (sel.feeds.includes('country')) {
    let c4 = 0;
    let c6 = 0;
    for (const c of sel.countries) {
      c4 += meta.countries[c]?.v4 ?? 0;
      c6 += meta.countries[c]?.v6 ?? 0;
    }
    if (fams.includes('v4') && c4 > 0) sizes.push(c4);
    if (fams.includes('v6') && c6 > 0) sizes.push(c6);
    byFeed['country'] = (fams.includes('v4') ? c4 : 0) + (fams.includes('v6') ? c6 : 0);
    // ipdeny's zone files: about 16 bytes an IPv4 entry, 43 an IPv6
    downloadKb += Math.round((c4 * 16 + c6 * 43) / 1024);
  }
  if (sel.feeds.includes('asn') && sel.asns.length > 0) {
    const n = sel.asns.length * meta.asn_entries * fams.length;
    sizes.push(n);
    byFeed['asn'] = n;
  }
  const entries = sizes.reduce((a, x) => a + x, 0);
  sizes.sort((a, z) => z - a);
  const cores = Math.max(1, sel.cores ?? cpus);
  const chunk = sel.split >= 512 ? sel.split : 0;
  let load = 0;
  for (let i = 0; i < Math.min(cores, sizes.length); i++)
    load += (chunk > 0 ? Math.min(sizes[i] ?? 0, chunk) : (sizes[i] ?? 0)) * bytes.load + bytes.load_base;
  load += bytes.run;
  return {
    entries,
    perEntry: per,
    keptKb: Math.floor((entries * per) / 1024),
    loadKb: Math.floor(load / 1024),
    sizes: byFeed,
    downloadKb,
  };
}

export interface MemoryCheck {
  totalKb: number;
  availableKb: number;
  reserveKb: number;
  freedKb: number;
  leftKb: number;
  ok: boolean;
}

/** What stays free while banIP loads a selection (its lists now are dropped first), against the reserve: 15 % of memory, 96 MB at least. */
export function memoryCheck(
  est: Estimate,
  mem: { total_kb: number; available_kb: number },
  nowEntries: number,
  nowPerEntry: number,
): MemoryCheck {
  const reserveKb = Math.max(98304, Math.floor(mem.total_kb * 0.15));
  const freedKb = Math.floor((nowEntries * nowPerEntry) / 1024);
  const leftKb = mem.available_kb + freedKb - est.keptKb - est.loadKb;
  return { totalKb: mem.total_kb, availableKb: mem.available_kb, reserveKb, freedKb, leftKb, ok: leftKb >= reserveKb };
}

// ---- the lists' lines, as banIP reads them ------------------------------------------------
// (bin/banip.uc parse_entry: the first word of a line; "#" starts a comment)

export type EntryKind = 'blank' | 'comment' | 'v4' | 'v6' | 'mac' | 'domain' | 'invalid';

export interface Entry {
  kind: EntryKind;
  value?: string;
  comment?: string | null;
  mac?: string;
  ip4?: string | null;
  ip6?: string | null;
  reason?: string;
}

const V4 =
  /^(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])(\.(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9]?[0-9])){3}(\/([0-9]|[12][0-9]|3[0-2]))?$/;
const MAC = /^([0-9a-f]{2}(:[0-9a-f]{2}){5})(\/([0-9]|[1-3][0-9]|4[0-8]))?$/;
const DOMAIN = /^([a-z0-9_-]{1,63}\.)+[a-z]+$/;

function v4Ok(s: string): boolean {
  if (!V4.test(s)) return false;
  const base = s.split('/')[0] ?? '';
  return !base.startsWith('127.') && base !== '0.0.0.0';
}

function v6Ok(s: string): boolean {
  const m = /^([0-9a-f:]+)(\/(\d{1,3}))?$/.exec(s);
  if (m === null || !(m[1] ?? '').includes(':') || (m[3] !== undefined && Number(m[3]) > 128)) return false;
  const a = m[1] ?? '';
  if (ipBytes(a) === null) return false;
  return a !== '::' && a !== '::1' && !a.startsWith('::ffff:') && !a.startsWith('fe80:');
}

export function parseEntry(raw: string): Entry {
  const line = raw.replace(/\r$/, '');
  if (/^[ \t]*$/.test(line)) return { kind: 'blank' };
  if (/^[ \t]*#/.test(line)) return { kind: 'comment', comment: line.trimStart().slice(1).trimStart() };
  if (/^[ \t]/.test(line)) return { kind: 'invalid', reason: 'indent' };
  const hash = line.indexOf('#');
  const comment = hash >= 0 ? line.slice(hash + 1).trim() : null;
  const body = (hash >= 0 ? line.slice(0, hash) : line).trim();
  const words = body.split(/[ \t]+/);
  const first = (words[0] ?? '').toLowerCase();
  if (v4Ok(first)) return words.length === 1 ? { kind: 'v4', value: first, comment } : { kind: 'invalid', reason: 'extra' };
  const mac = MAC.exec(first);
  if (first.includes(':') && mac === null) {
    if (v6Ok(first)) return words.length === 1 ? { kind: 'v6', value: first, comment } : { kind: 'invalid', reason: 'extra' };
    return { kind: 'invalid', reason: 'address' };
  }
  if (mac !== null) {
    if (words.length > 2) return { kind: 'invalid', reason: 'extra' };
    const ip = (words[1] ?? '').toLowerCase();
    const m = mac[1] ?? '';
    if (ip === '') return { kind: 'mac', value: first, mac: m, ip4: null, ip6: null, comment };
    if (v4Ok(ip)) return { kind: 'mac', value: `${first} ${ip}`, mac: m, ip4: ip, ip6: null, comment };
    if (v6Ok(ip)) return { kind: 'mac', value: `${first} ${ip}`, mac: m, ip4: null, ip6: ip, comment };
    return { kind: 'invalid', reason: 'address' };
  }
  if (DOMAIN.test(first) && first.length <= 253)
    return words.length === 1 ? { kind: 'domain', value: first, comment } : { kind: 'invalid', reason: 'extra' };
  if (/^[0-9./]+$/.test(first)) return { kind: 'invalid', reason: 'address' };
  return { kind: 'invalid', reason: 'unknown' };
}

export const ENTRY_PROBLEMS: Record<string, string> = {
  indent: 'Starts with a space: banIP reads the entry from the first column.',
  extra: 'More than one entry on the line (a comment starts with #).',
  address: 'Not an address banIP takes (no leading zeros, /32 or /128 at most; not loopback, link-local or 0.0.0.0).',
  unknown: 'Not an address, network, MAC address or domain name.',
};

export interface ListSummary {
  addresses: number;
  networks: number;
  devices: number;
  names: number;
  problems: number;
  managed: number;
}

export function summarize(entries: readonly Entry[]): ListSummary {
  const s: ListSummary = { addresses: 0, networks: 0, devices: 0, names: 0, problems: 0, managed: 0 };
  for (const e of entries) {
    if (e.kind === 'v4' || e.kind === 'v6') {
      if ((e.value ?? '').includes('/')) s.networks++;
      else s.addresses++;
      if ((e.comment ?? '').startsWith('milkflint: ') || (e.comment ?? '').startsWith('uplink added on ')) s.managed++;
    } else if (e.kind === 'mac') s.devices++;
    else if (e.kind === 'domain') s.names++;
    else if (e.kind === 'invalid') s.problems++;
  }
  return s;
}

/** A list line as banIP writes them: the entry, padded, then its comment. */
export function formatEntry(value: string, comment?: string | null): string {
  return comment !== undefined && comment !== null && comment !== '' ? `${value.padEnd(45)}# ${comment}` : value;
}

/** Who keeps a line up: MilkFlint (the inside networks), banIP (the uplink, looked-up names, the log monitor) or you. */
export function lineOwner(comment: string | null | undefined): 'milkflint' | 'uplink' | 'lookup' | 'monitor' | 'you' {
  const c = comment ?? '';
  if (c.startsWith('milkflint: ')) return 'milkflint';
  if (c.startsWith('uplink added on ')) return 'uplink';
  if (/^'[^']+' added on /.test(c)) return 'lookup';
  if (c.startsWith('added on ')) return 'monitor';
  return 'you';
}

// ---- addresses ---------------------------------------------------------------------------

/** An IPv4 or IPv6 address's bytes, or null. */
export function ipBytes(a: string): number[] | null {
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(a)) {
    const b = a.split('.').map(Number);
    return b.every((x) => x <= 255) ? b : null;
  }
  if (!/^[0-9a-f:]+$/i.test(a) || !a.includes(':')) return null;
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const words = (s: string | undefined): string[] => (s === undefined || s === '' ? [] : s.split(':'));
  const head = words(halves[0]);
  const tail = words(halves[1]);
  if ([...head, ...tail].some((w) => !/^[0-9a-f]{1,4}$/i.test(w))) return null;
  const fill = 8 - head.length - tail.length;
  if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
  const all = [...head, ...Array<string>(halves.length === 1 ? 0 : fill).fill('0'), ...tail];
  return all.flatMap((w) => {
    const v = parseInt(w, 16);
    return [v >> 8, v & 0xff];
  });
}

export interface Net {
  bytes: number[];
  bits: number;
}

export function parseNet(s: string): Net | null {
  const m = /^([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?$/.exec(s);
  if (m === null) return null;
  const bytes = ipBytes(m[1] ?? '');
  if (bytes === null) return null;
  const bits = m[2] === undefined ? bytes.length * 8 : Number(m[2]);
  return bits <= bytes.length * 8 ? { bytes, bits } : null;
}

/** Whether two networks (or addresses) share an address. */
export function overlaps(a: Net | null, z: Net | null): boolean {
  if (a === null || z === null) return false;
  if (a.bytes.length !== z.bytes.length) return false;
  let bits = Math.min(a.bits, z.bits);
  for (let i = 0; bits > 0; i++, bits -= 8) {
    const mask = bits >= 8 ? 0xff : (0xff << (8 - bits)) & 0xff;
    if (((a.bytes[i] ?? 0) & mask) !== ((z.bytes[i] ?? 0) & mask)) return false;
  }
  return true;
}

/** Blocklist entries that would reach one of the router's inside networks (the router refuses them; said as you type). */
export function insideConflicts(
  entries: readonly Entry[],
  inside: readonly { iface: string; net: string }[],
): { value: string; iface: string }[] {
  const out: { value: string; iface: string }[] = [];
  const nets = inside.map((n) => ({ ...n, parsed: parseNet(n.net) }));
  for (const e of entries) {
    if (e.kind !== 'v4' && e.kind !== 'v6') continue;
    const n = parseNet(e.value ?? '');
    const hit = nets.find((x) => overlaps(n, x.parsed));
    if (hit !== undefined) out.push({ value: e.value ?? '', iface: hit.iface });
  }
  return out;
}

// ---- drops and log lines -------------------------------------------------------------------

const SERVICES: Record<string, string> = {
  '21': 'FTP',
  '22': 'SSH',
  '23': 'Telnet',
  '25': 'mail (SMTP)',
  '53': 'DNS',
  '80': 'web',
  '123': 'time (NTP)',
  '443': 'web (HTTPS)',
  '445': 'Windows sharing',
  '853': 'DNS over TLS',
  '1433': 'SQL Server',
  '1900': 'UPnP',
  '3306': 'MySQL',
  '3389': 'Remote Desktop',
  '5060': 'internet phone (SIP)',
  '5900': 'VNC',
  '8080': 'web',
  '51820': 'WireGuard',
};

/** What a drop was for: "SSH (TCP 22)", "ping", … */
export function serviceOf(d: Pick<Drop, 'proto' | 'sport' | 'dport'>): string {
  if (d.proto === 'icmp' || d.proto === 'icmpv6') {
    const t = d.sport;
    if ((d.proto === 'icmp' && t === '8') || (d.proto === 'icmpv6' && t === '128')) return 'ping';
    return d.proto === 'icmp' ? 'ICMP' : 'ICMPv6';
  }
  const name = SERVICES[d.dport];
  const port = d.dport === '' ? d.proto.toUpperCase() : `${d.proto.toUpperCase()} ${d.dport}`;
  return name === undefined ? port : `${name} (${port})`;
}

export interface DropWords {
  direction: string;
  /** the address outside: who knocked (inbound), or where a device tried to go (outbound) */
  outside: string;
  /** the address inside, for outbound: the device */
  inside: string | null;
  service: string;
}

export function describeDrop(d: Drop): DropWords {
  if (d.dir === 'out') return { direction: 'From your network', outside: d.dst, inside: d.src, service: serviceOf(d) };
  if (d.dir === 'pre') {
    const kinds: Record<string, string> = {
      icmp: 'ICMP flood',
      syn: 'SYN flood',
      udp: 'UDP flood',
      tcp: 'odd TCP flags',
      ct: 'out-of-state',
    };
    return { direction: kinds[d.kind] ?? 'Before the lists', outside: d.src, inside: null, service: serviceOf(d) };
  }
  return {
    direction: d.out === '' ? 'To the router' : 'To a device',
    outside: d.src,
    inside: d.out === '' ? null : d.dst,
    service: serviceOf(d),
  };
}

export interface LogLine {
  time: string;
  level: string;
  kind: 'banip' | 'drop' | 'other';
  message: string;
  /** a drop line's prefix: banIP/<direction>/<policy>/<set> */
  drop?: { dir: string; policy: string; set: string | null; fields: Record<string, string> };
}

/**
 * A system log line (logread): "<ctime> <facility.level> <tag>: <message>".
 * banIP's own lines (tag banIP-<version>[pid]) and its drops (the kernel's
 * lines with banIP/<direction>/<policy>/<set>: KEY=VALUE …).
 */
export function parseLogLine(line: string): LogLine | null {
  const m = /^(\w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4})(?: \[\d+\.\d+\])? ([a-z0-9]+)\.([a-z]+) ([^:]+): (.*)$/.exec(line);
  if (m === null) return null;
  const time = m[1] ?? '';
  const level = m[3] ?? '';
  const tag = m[4] ?? '';
  const msg = m[5] ?? '';
  if (tag === 'kernel') {
    const d = /banIP\/([a-z-]+)\/([a-z]+)(?:\/([A-Za-z0-9_.]+))?: (.*)$/.exec(msg);
    if (d !== null) {
      const fields: Record<string, string> = {};
      for (const w of (d[4] ?? '').split(' ')) {
        const i = w.indexOf('=');
        if (i > 0 && !(w.slice(0, i) in fields)) fields[w.slice(0, i)] = w.slice(i + 1);
      }
      return {
        time,
        level,
        kind: 'drop',
        message: msg.replace(/^\[\s*\d+\.\d+\] /, ''),
        drop: { dir: d[1] ?? '', policy: d[2] ?? '', set: d[3] ?? null, fields },
      };
    }
  }
  if (/^banIP-[^ ]*\[\d+\]$/.test(tag)) return { time, level, kind: 'banip', message: msg };
  return { time, level, kind: 'other', message: msg };
}

/** a run's result for a set, in words */
export const RESULTS: Record<string, string> = {
  download: 'its download failed (the backup was used, if there is one)',
  failed: 'couldn’t be processed',
  empty: 'was empty',
  load: 'couldn’t be loaded into the firewall',
  incomplete: 'has no address or rule',
  unknown: 'isn’t in the catalogue any more',
  skipped: 'not needed in allowlist-only mode',
};

// ---- countries ------------------------------------------------------------------------------

export const REGIONS: readonly { id: string; title: string }[] = [
  { id: 'RIPE', title: 'Europe, the Middle East and Central Asia' },
  { id: 'ARIN', title: 'North America' },
  { id: 'LACNIC', title: 'Latin America and the Caribbean' },
  { id: 'APNIC', title: 'Asia and the Pacific' },
  { id: 'AFRINIC', title: 'Africa' },
];

/** The chosen countries that are where the router is (its Wi-Fi country): blocking them blocks your own internet provider's customers and services. */
export function countryWarnings(selected: readonly string[], home: string | null | undefined): string[] {
  const h = (home ?? '').toLowerCase();
  const out: string[] = [];
  if (h !== '' && selected.includes(h)) out.push(h);
  return out;
}

// ---- times -----------------------------------------------------------------------------------

/** The 24 hours of drops, oldest first, one per five minutes (missing slots 0). */
export function daySeries(values: readonly number[], slots = 288): number[] {
  const v = values.slice(-slots);
  return [...Array<number>(Math.max(0, slots - v.length)).fill(0), ...v];
}

export function scheduleText(schedule: string, time: string, day: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  switch (schedule) {
    case 'off':
      return 'Not updated on a schedule';
    case '6h':
      return `Every 6 hours, from ${time}`;
    case '12h':
      return `Twice a day, at ${time} and 12 hours later`;
    case 'weekly':
      return `${days[day] ?? 'Sunday'}s at ${time}`;
    default:
      return `Every day at ${time}`;
  }
}
