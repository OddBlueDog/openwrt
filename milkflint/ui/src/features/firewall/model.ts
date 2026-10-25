// The firewall's configuration (fw4, /etc/config/firewall) as the Firewall
// page shows it: zones and what may go between them, port forwards, traffic
// rules and NAT, each read from its UCI section. Edits set or unset only the
// options the page shows, so anything else in a section (set in LuCI or by
// hand) stays as it was, and sections the page doesn't show (IP sets,
// includes, helpers) are never touched. fw4's own defaults are mirrored
// here: a zone's policies fall back to the global ones, which fall back to
// drop; rules and port forwards are TCP and UDP unless they say otherwise.
import { bool, type Change, list, type Section, str } from '@/lib/api/uci';
import { INTERCEPT_SECTIONS } from '../dns/intercept';
import type { FeatureId } from '../ids';
import { SERVER, SERVER_FIREWALL } from '../remote-access/sections';
import { CLIENT, CLIENT_FIREWALL } from '../vpn-client/sections';
import { defaultGuestLabel, GUEST_IDS, guestFirewallSections, guestLabels, isGuestNetwork } from '../wifi-guest/guest';

export type Policy = 'ACCEPT' | 'REJECT' | 'DROP';
export type Family = 'any' | 'ipv4' | 'ipv6';

export function toPolicy(value: string | undefined, fallback: Policy): Policy {
  const v = value?.toUpperCase();
  return v === 'ACCEPT' || v === 'REJECT' || v === 'DROP' ? v : fallback;
}

function toFamily(value: string | undefined): Family {
  return value === 'ipv4' || value === 'ipv6' ? value : 'any';
}

export interface Defaults {
  section: string | undefined;
  input: Policy;
  output: Policy;
  forward: Policy;
  synFlood: boolean;
  /** which option holds it: fw4 reads both, OpenWrt's own config has syn_flood */
  synFloodOption: 'syn_flood' | 'synflood_protect';
  dropInvalid: boolean;
  offload: boolean;
  offloadHw: boolean;
}

export interface Zone {
  section: string;
  name: string;
  enabled: boolean;
  networks: string[];
  devices: string[];
  subnets: string[];
  input: Policy;
  output: Policy;
  forward: Policy;
  masq: boolean;
  mtuFix: boolean;
  family: Family;
}

export interface Forwarding {
  section: string;
  src: string;
  dest: string;
  enabled: boolean;
  family: Family;
}

export interface Schedule {
  start: string | undefined;
  stop: string | undefined;
  /** Mon … Sun; empty: every day */
  weekdays: string[];
}

export interface Rule {
  section: string;
  /** What fw4 calls it in the ruleset (its counters): the name, or @rule[n]. */
  label: string;
  name: string | undefined;
  enabled: boolean;
  /** ACCEPT, REJECT, DROP, or another of fw4's (NOTRACK, MARK, DSCP, HELPER) */
  target: string;
  /** undefined: the router itself (traffic it sends); '*': any zone */
  src: string | undefined;
  /** undefined: the router itself (traffic to it); '*': any zone */
  dest: string | undefined;
  srcIp: string[];
  srcMac: string[];
  srcPort: string[];
  destIp: string[];
  destPort: string[];
  /** lower case; ['all'] for any protocol */
  proto: string[];
  icmpTypes: string[];
  family: Family;
  /** a rate limit, e.g. 1000/sec */
  limit: string | undefined;
  schedule: Schedule | undefined;
  /** options this page doesn't edit (kept as they are) */
  extra: string[];
}

export interface Redirect {
  section: string;
  label: string;
  name: string | undefined;
  enabled: boolean;
  /** DNAT (a port forward) or SNAT */
  target: string;
  src: string | undefined;
  dest: string | undefined;
  srcIp: string[];
  srcDport: string | undefined;
  /** undefined: the router itself */
  destIp: string | undefined;
  destPort: string | undefined;
  proto: string[];
  reflection: boolean;
  family: Family;
  extra: string[];
}

export interface NatRule {
  section: string;
  label: string;
  name: string | undefined;
  enabled: boolean;
  /** SNAT, MASQUERADE or ACCEPT (no NAT) */
  target: string;
  /** the zone the traffic leaves through */
  src: string | undefined;
  srcIp: string[];
  destIp: string[];
  destPort: string | undefined;
  proto: string[];
  snatIp: string | undefined;
  snatPort: string | undefined;
  family: Family;
  extra: string[];
}

export interface FirewallConfig {
  /** every section, in file order */
  order: string[];
  defaults: Defaults;
  zones: Zone[];
  forwardings: Forwarding[];
  rules: Rule[];
  redirects: Redirect[];
  nats: NatRule[];
  /** sections this page leaves to LuCI */
  ipsets: number;
  includes: number;
  /** what MilkFlint's other pages call some zones: a guest network's label */
  labels: Partial<Record<string, string>>;
}

const RULE_OPTIONS = [
  'name',
  'enabled',
  'target',
  'src',
  'dest',
  'src_ip',
  'src_mac',
  'src_port',
  'dest_ip',
  'dest_port',
  'proto',
  'icmp_type',
  'family',
  'limit',
  'limit_burst',
  'log',
  'start_time',
  'stop_time',
  'weekdays',
];
const REDIRECT_OPTIONS = ['name', 'enabled', 'target', 'src', 'dest', 'src_ip', 'src_dport', 'dest_ip', 'dest_port', 'proto', 'reflection', 'family'];
const NAT_OPTIONS = ['name', 'enabled', 'target', 'src', 'src_ip', 'dest_ip', 'dest_port', 'proto', 'snat_ip', 'snat_port', 'family'];

function extraOptions(s: Section, known: readonly string[]): string[] {
  return Object.keys(s).filter((k) => !k.startsWith('.') && !known.includes(k));
}

function protocols(s: Section, fallback: string[]): string[] {
  const p = list(s, 'proto').map((x) => x.toLowerCase());
  if (p.length === 0) return fallback;
  return p.some((x) => x === 'all' || x === 'any' || x === '*') ? ['all'] : p;
}

/** fw4's name for a section without one: @rule[2] for the third anonymous-or-not rule. */
function labelOf(s: Section, index: number): string {
  return str(s, 'name') ?? (s['.anonymous'] === true ? `@${s['.type']}[${String(index)}]` : s['.name']);
}

/** `milkflint` (/etc/config/milkflint) has the guest networks' labels, for their zones' titles. */
export function parseFirewall(sections: readonly Section[], milkflint: readonly Section[] = []): FirewallConfig {
  const d = sections.find((s) => s['.type'] === 'defaults');
  const defaults: Defaults = {
    section: d?.['.name'],
    input: toPolicy(str(d, 'input'), 'DROP'),
    output: toPolicy(str(d, 'output'), 'DROP'),
    forward: toPolicy(str(d, 'forward'), 'DROP'),
    synFlood: bool(d, 'synflood_protect', bool(d, 'syn_flood')),
    synFloodOption: str(d, 'synflood_protect') !== undefined ? 'synflood_protect' : 'syn_flood',
    dropInvalid: bool(d, 'drop_invalid'),
    offload: bool(d, 'flow_offloading'),
    offloadHw: bool(d, 'flow_offloading_hw'),
  };
  const count = new Map<string, number>();
  const next = (type: string): number => {
    const n = count.get(type) ?? 0;
    count.set(type, n + 1);
    return n;
  };
  const cfg: FirewallConfig = {
    order: sections.map((s) => s['.name']),
    defaults,
    zones: [],
    forwardings: [],
    rules: [],
    redirects: [],
    nats: [],
    ipsets: 0,
    includes: 0,
    labels: guestLabels(milkflint),
  };
  for (const s of sections) {
    const index = next(s['.type']);
    const section = s['.name'];
    const enabled = bool(s, 'enabled', true);
    const family = toFamily(str(s, 'family'));
    switch (s['.type']) {
      case 'zone': {
        const name = str(s, 'name');
        if (name === undefined) break;
        cfg.zones.push({
          section,
          name,
          enabled,
          networks: list(s, 'network'),
          devices: list(s, 'device'),
          subnets: list(s, 'subnet'),
          input: toPolicy(str(s, 'input'), defaults.input),
          output: toPolicy(str(s, 'output'), defaults.output),
          forward: toPolicy(str(s, 'forward'), defaults.forward),
          masq: bool(s, 'masq'),
          mtuFix: bool(s, 'mtu_fix'),
          family,
        });
        break;
      }
      case 'forwarding': {
        const src = str(s, 'src');
        const dest = str(s, 'dest');
        if (src !== undefined && dest !== undefined) cfg.forwardings.push({ section, src, dest, enabled, family });
        break;
      }
      case 'rule': {
        const start = str(s, 'start_time');
        const stop = str(s, 'stop_time');
        const weekdays = list(s, 'weekdays');
        cfg.rules.push({
          section,
          label: labelOf(s, index),
          name: str(s, 'name'),
          enabled,
          target: (str(s, 'target') ?? 'DROP').toUpperCase(),
          src: str(s, 'src'),
          dest: str(s, 'dest'),
          srcIp: list(s, 'src_ip'),
          srcMac: list(s, 'src_mac').map((m) => m.toLowerCase()),
          srcPort: list(s, 'src_port'),
          destIp: list(s, 'dest_ip'),
          destPort: list(s, 'dest_port'),
          proto: protocols(s, ['tcp', 'udp']),
          icmpTypes: list(s, 'icmp_type'),
          family,
          limit: str(s, 'limit'),
          schedule: start === undefined && stop === undefined && weekdays.length === 0 ? undefined : { start, stop, weekdays },
          extra: extraOptions(s, RULE_OPTIONS),
        });
        break;
      }
      case 'redirect':
        cfg.redirects.push({
          section,
          label: labelOf(s, index),
          name: str(s, 'name'),
          enabled,
          target: (str(s, 'target') ?? 'DNAT').toUpperCase(),
          src: str(s, 'src'),
          dest: str(s, 'dest'),
          srcIp: list(s, 'src_ip'),
          srcDport: str(s, 'src_dport'),
          destIp: str(s, 'dest_ip'),
          destPort: str(s, 'dest_port'),
          proto: protocols(s, ['tcp', 'udp']),
          reflection: bool(s, 'reflection', true),
          family,
          extra: extraOptions(s, REDIRECT_OPTIONS),
        });
        break;
      case 'nat':
        cfg.nats.push({
          section,
          label: labelOf(s, index),
          name: str(s, 'name'),
          enabled,
          target: (str(s, 'target') ?? 'MASQUERADE').toUpperCase(),
          src: str(s, 'src'),
          srcIp: list(s, 'src_ip'),
          destIp: list(s, 'dest_ip'),
          destPort: str(s, 'dest_port'),
          proto: protocols(s, ['all']),
          snatIp: str(s, 'snat_ip'),
          snatPort: str(s, 'snat_port'),
          family,
          extra: extraOptions(s, NAT_OPTIONS),
        });
        break;
      case 'ipset':
        cfg.ipsets++;
        break;
      case 'include':
        cfg.includes++;
        break;
      default:
        break;
    }
  }
  return cfg;
}

// ---- Zones in plain words ----

/** Whether a zone is the internet side: OpenWrt's wan zone, or one covering wan/wan6. */
export function isInternetZone(z: Zone): boolean {
  return z.name === 'wan' || z.networks.includes('wan') || z.networks.includes('wan6');
}

/** The internet zone the page's simple settings work on. */
export function wanZone(cfg: FirewallConfig): Zone | undefined {
  return cfg.zones.find((z) => z.name === 'wan') ?? cfg.zones.find(isInternetZone);
}

export function lanZone(cfg: FirewallConfig): Zone | undefined {
  return cfg.zones.find((z) => z.name === 'lan') ?? cfg.zones.find((z) => z.networks.includes('lan'));
}

const zoneTitles: Record<string, string> = { wan: 'Internet', lan: 'Home network', [SERVER]: 'Remote access', [CLIENT]: 'VPN' };

/** "Internet", "Home network", a guest network's label ("Guests", "Smart home"), or the zone's own name. */
export function zoneTitle(name: string, cfg: FirewallConfig): string {
  return isGuestNetwork(name) ? (cfg.labels[name] ?? defaultGuestLabel(name)) : (zoneTitles[name] ?? name);
}

/** The zone as part of a sentence: "the internet", "your home network". */
export function zonePhrase(name: string | undefined, end: 'src' | 'dest', cfg: FirewallConfig): string {
  if (name === undefined) return 'the router';
  if (name === '*') return end === 'src' ? 'anywhere' : 'any network';
  if (name === 'wan') return 'the internet';
  if (name === 'lan') return 'your home network';
  if (isGuestNetwork(name)) return zoneTitle(name, cfg);
  if (name === SERVER) return 'devices on remote access';
  if (name === CLIENT) return 'the VPN';
  return `zone “${name}”`;
}

// ---- Rules in plain words ----

/** OpenWrt's own rules, what each is for. */
export const builtInRules: Record<string, string> = {
  'Allow-DHCP-Renew': 'Lets your internet provider give the router its IPv4 address (DHCP).',
  'Allow-Ping': 'Answers pings from the internet (IPv4). MilkFlint turns it off, so the router stays quiet.',
  'Allow-IGMP': 'Lets the router join multicast streams on the internet side, which some providers use for TV.',
  'Allow-DHCPv6': 'Lets your provider give the router its IPv6 address and your network’s IPv6 prefix (DHCPv6).',
  'Allow-MLD': 'IPv6 multicast listening on the internet side (MLD), from the provider’s link only.',
  'Allow-ICMPv6-Input': 'The control messages IPv6 needs to work (neighbour discovery, “packet too big”, errors), rate-limited. Pings only with echo-request listed: MilkFlint takes it out.',
  'Allow-ICMPv6-Forward': 'The same IPv6 control messages on to your devices, rate-limited. Pings only with echo-request listed: MilkFlint takes it out.',
  'Allow-IPSec-ESP': 'Lets IPsec VPN traffic from the internet reach a VPN server on your home network.',
  'Allow-ISAKMP': 'Lets IPsec VPNs from the internet set up their connection to your home network (UDP 500).',
};

export function isBuiltIn(r: Rule): boolean {
  return r.name !== undefined && r.name in builtInRules;
}

/** Sections another MilkFlint page made and keeps up. */
export const managedBy: Record<string, { page: FeatureId; title: string }> = {
  // every guest network's zone, forwarding and rules
  ...Object.fromEntries(GUEST_IDS.flatMap(guestFirewallSections).map((section) => [section, { page: 'wifi-guest', title: 'Guest Wi-Fi' }])),
  // the DNS page's intercept, one per zone
  ...Object.fromEntries(INTERCEPT_SECTIONS.map((section) => [section, { page: 'dns', title: 'DNS' }])),
  // the VPN pages' zones, open port, forwardings, marks and kill switch
  ...Object.fromEntries(SERVER_FIREWALL.map((section) => [section, { page: 'remote-access', title: 'Remote access' }])),
  ...Object.fromEntries(CLIENT_FIREWALL.map((section) => [section, { page: 'vpn-client', title: 'Send through a VPN' }])),
};

/** Names for devices: by MAC (lower case) and by IP. */
export interface Names {
  byMac: ReadonlyMap<string, string>;
  byIp: ReadonlyMap<string, string>;
}

export function ruleVerb(target: string): { verb: string; tone: 'allow' | 'block' | 'other' } {
  switch (target) {
    case 'ACCEPT':
      return { verb: 'Allow', tone: 'allow' };
    case 'REJECT':
      return { verb: 'Block', tone: 'block' };
    case 'DROP':
      return { verb: 'Silently block', tone: 'block' };
    case 'NOTRACK':
      return { verb: 'Don’t track', tone: 'other' };
    case 'MARK':
      return { verb: 'Mark', tone: 'other' };
    case 'DSCP':
      return { verb: 'Set DSCP on', tone: 'other' };
    case 'HELPER':
      return { verb: 'Use a helper on', tone: 'other' };
    default:
      return { verb: target, tone: 'other' };
  }
}

const protoNames: Record<string, string> = { tcp: 'TCP', udp: 'UDP', icmp: 'ICMP', icmpv6: 'ICMPv6', esp: 'ESP', ah: 'AH', gre: 'GRE', igmp: 'IGMP' };

export function protoText(proto: readonly string[]): string {
  if (proto.includes('all')) return 'all traffic';
  return proto.map((p) => protoNames[p] ?? p.toUpperCase()).join(' and ');
}

/** "port 80", "ports 80, 443 and 8000–8010" */
export function portsText(ports: readonly string[]): string {
  const shown = ports.map((p) => p.replace(/[-:]/, '–'));
  const plural = shown.length > 1 || shown.some((p) => p.includes('–'));
  const joined = shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1) ?? ''}` : (shown[0] ?? '');
  return `${plural ? 'ports' : 'port'} ${joined}`;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** fw4 takes any prefix of a day's name ("mon", "Monday"): back to Mon … Sun. */
export function normalizeDay(day: string): string | undefined {
  const d = day.toLowerCase();
  return WEEKDAYS.find((w) => d.startsWith(w.toLowerCase()));
}

function hhmm(t: string): string {
  return t.split(':').slice(0, 2).join(':');
}

export function scheduleText(s: Schedule | undefined): string | undefined {
  if (s === undefined) return undefined;
  const days = s.weekdays.map((d) => (d.startsWith('!') ? undefined : normalizeDay(d))).filter((d) => d !== undefined);
  const dayText =
    days.length === 0 || days.length === 7
      ? 'every day'
      : days.join(' ') === 'Mon Tue Wed Thu Fri'
        ? 'Mon–Fri'
        : days.join(' ') === 'Sat Sun'
          ? 'weekends'
          : days.join(', ');
  const time =
    s.start !== undefined && s.stop !== undefined
      ? `${hhmm(s.start)}–${hhmm(s.stop)}`
      : s.start !== undefined
        ? `from ${hhmm(s.start)}`
        : s.stop !== undefined
          ? `until ${hhmm(s.stop)}`
          : 'all day';
  return `${time}, ${dayText}`;
}

// ---- Rules with a meaning of their own ----

/** A rule that keeps one device off the internet (what "Block a device" makes). */
export function isDeviceBlock(r: Rule, cfg: FirewallConfig): boolean {
  const wan = cfg.zones.filter(isInternetZone).map((z) => z.name);
  return (
    (r.target === 'REJECT' || r.target === 'DROP') &&
    r.srcMac.length === 1 &&
    r.srcIp.length === 0 &&
    r.destIp.length === 0 &&
    r.destPort.length === 0 &&
    r.dest !== undefined &&
    wan.includes(r.dest) &&
    r.proto.includes('all')
  );
}

/** A port forward from the internet (DNAT from an internet zone). */
export function isInternetForward(r: Redirect, cfg: FirewallConfig): boolean {
  const wan = cfg.zones.filter(isInternetZone).map((z) => z.name);
  return r.target === 'DNAT' && r.src !== undefined && wan.includes(r.src);
}

/** Forwards every port: a DMZ host. */
export function isDmz(r: Redirect): boolean {
  return r.srcDport === undefined && r.destPort === undefined && r.proto.includes('all');
}

// ---- Writing ----

export type Values = Record<string, string | string[] | undefined>;

// One value given as a one-item list is the same (fw4 reads both); a list
// where a single value is written is not, so a list fw4 refuses is rewritten.
function same(a: string | string[] | undefined, b: string | string[]): boolean {
  if (a === undefined) return false;
  if (typeof a === 'string') return typeof b === 'string' ? a === b : b.length === 1 && b[0] === a;
  if (typeof b === 'string') return false;
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/**
 * The changes that make `section` hold `values`: options that differ are
 * set, options given as undefined (or an empty list) are unset, and every
 * other option is left alone. No section yet: one is added.
 */
export function editSection(type: string, section: Section | undefined, values: Values): Change[] {
  const set: Record<string, string | string[]> = {};
  const unset: string[] = [];
  for (const [option, value] of Object.entries(values)) {
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      if (section?.[option] !== undefined) unset.push(option);
    } else if (!same(section?.[option], value)) {
      set[option] = value;
    }
  }
  if (section === undefined) return [{ op: 'add', config: 'firewall', type, values: set }];
  const changes: Change[] = [];
  if (Object.keys(set).length > 0) changes.push({ op: 'set', config: 'firewall', section: section['.name'], values: set });
  if (unset.length > 0) changes.push({ op: 'unset', config: 'firewall', section: section['.name'], options: unset });
  return changes;
}

/** Enabled is fw4's default: unset rather than "1", as LuCI does. */
export function enabledChange(section: string, on: boolean): Change {
  return on ? { op: 'unset', config: 'firewall', section, options: ['enabled'] } : { op: 'set', config: 'firewall', section, values: { enabled: '0' } };
}

/** What still names a zone, which fw4 skips once the zone is gone (the user is told before deleting). */
export function zoneUsers(cfg: FirewallConfig, name: string): string[] {
  return [
    ...cfg.rules.filter((r) => r.src === name || r.dest === name).map((r) => r.label),
    ...cfg.redirects.filter((r) => r.src === name || r.dest === name).map((r) => r.label),
    ...cfg.nats.filter((r) => r.src === name).map((r) => r.label),
  ];
}

// ---- Checking what's typed ----

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function isIpv4(v: string): boolean {
  return IPV4.test(v);
}

/** An IPv4 or IPv6 address, optionally with /prefix (what fw4 takes for src_ip and dest_ip). */
export function isAddress(v: string): boolean {
  const [ip = '', prefix, more] = v.split('/');
  if (more !== undefined) return false;
  const v4 = isIpv4(ip);
  const v6 = !v4 && /^[0-9a-f:.]+$/i.test(ip) && ip.includes(':') && ip.split('::').length <= 2;
  if (!v4 && !v6) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (v4 ? 32 : 128);
}

export function isMac(v: string): boolean {
  return /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(v);
}

/** A port or range (8000-8010, as fw4 also takes 8000:8010); undefined when fine. */
export function portError(value: string): string | undefined {
  const m = /^(\d{1,5})(?:[-:](\d{1,5}))?$/.exec(value);
  const message = 'A port (1–65535) or a range like 8000-8010.';
  if (m === null) return message;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a < 1 || b > 65535 || b < a ? message : undefined;
}

/** Two port ranges ("25565", "8000-8010") overlap. */
export function portsOverlap(a: string, b: string): boolean {
  const range = (p: string): [number, number] => {
    const [x = '0', y] = p.split(/[-:]/);
    return [Number(x), Number(y ?? x)];
  };
  const [a1, a2] = range(a);
  const [b1, b2] = range(b);
  return a1 <= b2 && b1 <= a2;
}

export function protosOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.includes('all') || b.includes('all') || a.some((p) => b.includes(p));
}

// ---- What nftables can load ----
// fw4 renders the config and nft loads it in one go: one value nft refuses
// and none of it loads.

const bytes = (s: string): number => new TextEncoder().encode(s).length;

/**
 * A name fw4 can write into its nft comment, "!fw4: <name>": nftables takes
 * up to 128 bytes there (accents and symbols take two or more), and no
 * control characters.
 */
export function isShortName(name: string): boolean {
  const n = name.trim();
  return n !== '' && n.length <= 50 && !/\p{Cc}/u.test(n) && bytes(`!fw4: ${n}`) <= 128;
}

/** A name dnsmasq can give a device, as the Clients page allows. */
export function isLocalName(name: string): boolean {
  return /^[A-Za-z0-9-]{1,63}$/.test(name);
}

/**
 * What's wrong with a rule's log option as fw4 writes it out: "1" (on, true,
 * yes) logs with the rule's name as the prefix, "0" (off, false, no) doesn't
 * log, anything else is the prefix itself. nftables takes up to 127 bytes
 * and no "$", which it reads as a variable.
 */
export function logPrefixError(log: string, name: string): string | undefined {
  const v = log.trim();
  const prefix = ['1', 'on', 'true', 'yes'].includes(v) ? `${name.trim()}: ` : ['', '0', 'off', 'false', 'no'].includes(v) ? '' : v;
  if (prefix.includes('$')) return prefix === v ? 'No “$”: nftables can’t log with one.' : 'The name has a “$”, which nftables can’t log with: type a prefix instead.';
  if (/\p{Cc}/u.test(prefix) || bytes(prefix) > 127) return 'Up to 127 characters (accents and symbols count as two or more).';
  return undefined;
}
