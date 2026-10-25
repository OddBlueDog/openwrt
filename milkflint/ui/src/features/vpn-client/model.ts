// The VPN client as the page edits it, and the sections that make it. The
// tunnel is OpenWrt's own WireGuard interface (wg_out) with one peer, the
// provider's server, whose routes go in a table of their own (2100), so
// nothing uses it by itself. fw4 MARK rules mark the chosen devices'
// traffic as it arrives, and netifd's routing rules send marked traffic:
// first to the main table's own routes but not its default (the home and
// guest networks, remote access, stay reachable), then into the tunnel's
// table, and with the kill switch to nowhere, when the tunnel has no route.
// The router's own traffic isn't marked, so it goes out as before. The
// zone masquerades, as the internet's does. Everything is read back from
// those sections, so a change made in LuCI shows here.
import { intToIp, ipToInt } from '@/lib/api/network';
import { type Owned, reconcile, type Wanted } from '@/lib/api/owned';
import type { Section } from '@/lib/api/uci';
import { isKey, joinEndpoint, type WgConf } from '@/lib/api/wireguard';
import { isMac } from '../firewall/model';
import type { GuestId } from '../wifi-guest/guest';
import { overlaps } from '../wifi-guest/model';
import {
  CLIENT,
  CLIENT_FIREWALL,
  CLIENT_MARK,
  CLIENT_PEER_TYPE,
  CLIENT_QUEUE,
  CLIENT_RULES,
  CLIENT_RULES6,
  CLIENT_SKIP,
  CLIENT_TABLE,
  forwardSection,
  leakSection,
  markSection,
  type SourceZone,
} from './sections';

export const DEFAULT_PORT = '51820';
export const DEFAULT_KEEPALIVE = '25';
/** The tunnel's rates start this far under the internet port's: its own headers (60–80 bytes a packet) have to fit. */
export const TUNNEL_SHARE = 0.92;

/** Which home-network devices use it; guest networks are all or nothing. */
export type Who = 'all' | 'only' | 'except' | 'none';

export interface ClientForm {
  enabled: boolean;
  privateKey: string;
  /** its addresses in the provider's network, e.g. 10.64.12.7/32 and an IPv6 one */
  addresses: string[];
  mtu: string;
  /** the provider's server */
  publicKey: string;
  presharedKey: string;
  endpointHost: string;
  endpointPort: string;
  keepalive: string;
  who: Who;
  /** the devices "only" or "except" means, by MAC (lower case) */
  macs: string[];
  guests: GuestId[];
  killSwitch: boolean;
  /** a Smart Queue inside the tunnel */
  shaper: boolean;
  downMbit: string;
  upMbit: string;
}

export interface Device {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
}

export interface ClientData {
  installed: boolean;
  /** network.wg_out exists */
  exists: boolean;
  form: ClientForm;
  /** the peer's section: wg_out_server, or one LuCI made */
  peerSection: string;
  present: { network: Section[]; firewall: Section[]; sqm: Section[] | undefined };
  wanZone: string;
  lanZone: string;
  guestZones: { id: GuestId; label: string }[];
  devices: Device[];
  /** SQM is installed */
  sqm: boolean;
  /** the internet port's queue, Mbit/s: what the tunnel's rates start from */
  wanRates: { down: number; up: number } | undefined;
  lan: { ip: number; prefix: number } | undefined;
  taken: { ip: number; prefix: number; name: string }[];
}

export type Errors = Partial<Record<string, string>>;

/** A blank tunnel: everything on, as it's meant to be used. */
export function blankForm(d: Pick<ClientData, 'wanRates' | 'sqm'>): ClientForm {
  return {
    enabled: false,
    privateKey: '',
    addresses: [],
    mtu: '',
    publicKey: '',
    presharedKey: '',
    endpointHost: '',
    endpointPort: DEFAULT_PORT,
    keepalive: DEFAULT_KEEPALIVE,
    who: 'all',
    macs: [],
    guests: [],
    killSwitch: true,
    shaper: d.sqm && d.wanRates !== undefined,
    downMbit: d.wanRates === undefined ? '' : String(Math.floor(d.wanRates.down * TUNNEL_SHARE)),
    upMbit: d.wanRates === undefined ? '' : String(Math.floor(d.wanRates.up * TUNNEL_SHARE)),
  };
}

/** A provider's .conf into the form: its keys, addresses and server. */
export function fromConf(f: ClientForm, c: WgConf): ClientForm {
  return {
    ...f,
    privateKey: c.privateKey,
    addresses: c.addresses,
    mtu: c.mtu,
    publicKey: c.peer.publicKey,
    presharedKey: c.peer.presharedKey,
    endpointHost: c.peer.endpointHost,
    endpointPort: c.peer.endpointPort === '' ? DEFAULT_PORT : c.peer.endpointPort,
    keepalive: c.peer.keepalive === '' ? DEFAULT_KEEPALIVE : c.peer.keepalive,
  };
}

/** Its addresses as typed (the field keeps a trailing comma while typing), without the blanks. */
export function addressesOf(f: ClientForm): string[] {
  return f.addresses.map((a) => a.trim()).filter((a) => a !== '');
}

/** The tunnel has an IPv6 address: IPv6 goes through it too. */
export function hasIpv6(f: ClientForm): boolean {
  return addressesOf(f).some((a) => a.includes(':'));
}

function v4Of(address: string): { ip: number; prefix: number } | undefined {
  const [ip = '', bits = '32'] = address.split('/');
  const n = ipToInt(ip);
  return n === undefined || !/^\d+$/.test(bits) ? undefined : { ip: n, prefix: Number(bits) };
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function portOk(v: string, lo: number): boolean {
  return /^\d+$/.test(v) && Number(v) >= lo && Number(v) <= 65535;
}

export function validate(f: ClientForm, d: ClientData): Errors {
  const e: Errors = {};
  // a tunnel that was never filled in can stay empty while it's off
  const blank = f.privateKey === '' && f.publicKey === '' && f.endpointHost === '' && addressesOf(f).length === 0;
  if (f.enabled || !blank) {
    if (!isKey(f.privateKey)) e['private'] = 'The private key from the provider’s config ([Interface] PrivateKey).';
    if (!isKey(f.publicKey)) e['public'] = 'The server’s public key ([Peer] PublicKey).';
    if (f.presharedKey !== '' && !isKey(f.presharedKey)) e['psk'] = 'A WireGuard key, or empty.';
    const host = f.endpointHost.trim();
    if (host === '') e['host'] = 'The server’s address ([Peer] Endpoint).';
    else if (ipToInt(host) === undefined && !host.includes(':') && !HOSTNAME.test(host)) e['host'] = 'A hostname or an address.';
    if (!portOk(f.endpointPort, 1)) e['port'] = 'A port from 1 to 65535.';
    const v4 = addressesOf(f).map(v4Of).filter((a) => a !== undefined);
    if (v4.length === 0) e['addresses'] = 'At least one IPv4 address ([Interface] Address), like 10.64.12.7/32.';
    else {
      const clash = v4.find((a) => (d.lan !== undefined && overlaps(a.ip, a.prefix, d.lan.ip, d.lan.prefix)) || d.taken.some((t) => overlaps(a.ip, a.prefix, t.ip, t.prefix)));
      if (clash !== undefined) e['addresses'] = `${intToIp(clash.ip)} is inside one of this router’s own networks.`;
    }
    if (f.mtu !== '' && (!/^\d+$/.test(f.mtu) || Number(f.mtu) < 1280 || Number(f.mtu) > 1500)) e['mtu'] = 'From 1280 to 1500, or empty for 1420.';
    if (f.keepalive !== '' && !portOk(f.keepalive, 0)) e['keepalive'] = 'Seconds, or empty.';
  }
  if ((f.who === 'only' || f.who === 'except') && f.macs.length === 0) e['macs'] = 'Add at least one device.';
  if (f.macs.some((m) => !isMac(m))) e['macs'] = 'One of these isn’t a MAC address.';
  if (f.who === 'none' && f.guests.length === 0) e['who'] = 'Pick who uses it: home-network devices, a guest network, or both.';
  if (f.shaper) {
    const rate = (v: string): boolean => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0;
    if (!rate(f.downMbit) || !rate(f.upMbit)) e['shaper'] = 'Both rates, in Mbit/s.';
  }
  return e;
}

// ---- the sections ----

function owned(d: ClientData): Owned[] {
  return [
    { config: 'network', name: CLIENT },
    ...d.present.network.filter((s) => s['.type'] === CLIENT_PEER_TYPE).map((s) => ({ config: 'network', name: s['.name'] })),
    ...[...CLIENT_RULES, ...CLIENT_RULES6].map((name) => ({ config: 'network', name })),
    ...CLIENT_FIREWALL.map((name) => ({ config: 'firewall', name })),
    ...(d.present.sqm === undefined ? [] : [{ config: 'sqm', name: CLIENT_QUEUE }]),
  ];
}

/** The zones whose devices use it, home network first. */
export function sources(f: ClientForm): SourceZone[] {
  return [...(f.who === 'none' ? [] : (['lan'] as const)), ...f.guests];
}

/** Every section the settings need, as they need it. */
export function wanted(f: ClientForm, d: ClientData): Wanted[] {
  const on = f.enabled;
  // fw4's default is on: unset rather than '1', as LuCI does
  const enabled = on ? undefined : '0';
  const disabled = on ? undefined : '1';
  const v6 = hasIpv6(f);
  const zoneOf = (z: SourceZone): string => (z === 'lan' ? d.lanZone : z);
  const label = (z: SourceZone): string => (z === 'lan' ? 'Home' : (d.guestZones.find((g) => g.id === z)?.label ?? z).replace(/[^A-Za-z0-9]+/g, '-'));
  const rule = (name: string, type: 'rule' | 'rule6', values: Record<string, string>): Wanted => ({
    config: 'network',
    type,
    name,
    values: { mark: CLIENT_MARK, ...values, disabled },
  });
  const w: Wanted[] = [
    {
      config: 'network',
      type: 'interface',
      name: CLIENT,
      values: {
        proto: 'wireguard',
        private_key: f.privateKey,
        addresses: addressesOf(f),
        mtu: f.mtu === '' ? undefined : f.mtu,
        ip4table: CLIENT_TABLE,
        ip6table: CLIENT_TABLE,
        disabled,
      },
    },
    {
      config: 'network',
      type: CLIENT_PEER_TYPE,
      name: d.peerSection,
      values: {
        description: f.endpointHost.trim(),
        public_key: f.publicKey,
        preshared_key: f.presharedKey === '' ? undefined : f.presharedKey,
        endpoint_host: f.endpointHost.trim(),
        endpoint_port: f.endpointPort,
        allowed_ips: ['0.0.0.0/0', '::/0'],
        route_allowed_ips: '1',
        persistent_keepalive: f.keepalive === '' ? undefined : f.keepalive,
      },
    },
    // past the main table's own routes, but not its default route
    rule(`${CLIENT}_main`, 'rule', { lookup: 'main', suppress_prefixlength: '0', priority: '1000' }),
    rule(`${CLIENT}_via`, 'rule', { lookup: CLIENT_TABLE, priority: '1001' }),
  ];
  if (f.killSwitch) w.push(rule(`${CLIENT}_kill`, 'rule', { action: 'unreachable', priority: '1002' }));
  if (v6) {
    w.push(rule(`${CLIENT}_main6`, 'rule6', { lookup: 'main', suppress_prefixlength: '0', priority: '1000' }));
    w.push(rule(`${CLIENT}_via6`, 'rule6', { lookup: CLIENT_TABLE, priority: '1001' }));
    if (f.killSwitch) w.push(rule(`${CLIENT}_kill6`, 'rule6', { action: 'unreachable', priority: '1002' }));
  } else {
    // a VPN without IPv6: those devices' IPv6 has nowhere to go, rather than going out unprotected
    w.push(rule(`${CLIENT}_main6`, 'rule6', { lookup: 'main', suppress_prefixlength: '0', priority: '1000' }));
    w.push(rule(`${CLIENT}_kill6`, 'rule6', { action: 'unreachable', priority: '1002' }));
  }

  w.push({
    config: 'firewall',
    type: 'zone',
    name: CLIENT,
    values: {
      name: CLIENT,
      network: [CLIENT],
      input: 'REJECT',
      output: 'ACCEPT',
      forward: 'REJECT',
      masq: '1',
      masq6: v6 ? '1' : undefined,
      mtu_fix: '1',
      enabled,
    },
  });
  for (const z of sources(f)) {
    const src = zoneOf(z);
    w.push({ config: 'firewall', type: 'forwarding', name: forwardSection(z), values: { src, dest: CLIENT, enabled } });
    w.push({
      config: 'firewall',
      type: 'rule',
      name: markSection(z),
      values: {
        name: `Mark-VPN-${label(z)}`,
        src,
        dest: '*',
        proto: 'all',
        family: 'any',
        src_mac: z === 'lan' && f.who === 'only' ? f.macs : undefined,
        target: 'MARK',
        set_xmark: CLIENT_MARK,
        enabled,
      },
    });
    if (z === 'lan' && f.who === 'except') {
      // after the mark: the listed devices get theirs taken off again
      w.push({
        config: 'firewall',
        type: 'rule',
        name: CLIENT_SKIP,
        values: { name: 'Skip-VPN-Home', src, dest: '*', proto: 'all', family: 'any', src_mac: f.macs, target: 'MARK', set_xmark: `0x0/${CLIENT_MARK.split('/')[1] ?? ''}`, enabled },
      });
    }
    if (f.killSwitch) {
      w.push({
        config: 'firewall',
        type: 'rule',
        name: leakSection(z),
        values: { name: `Block-VPN-Leak-${label(z)}`, src, dest: d.wanZone, proto: 'all', family: 'any', mark: CLIENT_MARK, target: 'DROP', enabled },
      });
    }
  }

  if (f.shaper && d.present.sqm !== undefined) {
    const kbit = (v: string): string => String(Math.round(Number(v) * 1000));
    w.push({
      config: 'sqm',
      type: 'queue',
      name: CLIENT_QUEUE,
      values: {
        enabled: on ? '1' : '0',
        interface: CLIENT,
        // on the tunnel, what arrives is the download
        download: kbit(f.downMbit),
        upload: kbit(f.upMbit),
        qdisc: 'cake',
        script: 'piece_of_cake.qos',
        linklayer: 'none',
        qdisc_advanced: '1',
        qdisc_really_really_advanced: '1',
        // fair per device: by the address behind the masquerade (nat), each way
        iqdisc_opts: 'dual-dsthost nat',
        eqdisc_opts: 'dual-srchost nat',
      },
    });
  }
  return w;
}

export function toChanges(f: ClientForm, d: ClientData): ReturnType<typeof reconcile> {
  return reconcile(wanted(f, d), owned(d), d.present);
}

/** Everything the VPN client is made of, for Remove. */
export function removal(d: ClientData): ReturnType<typeof reconcile> {
  return reconcile([], owned(d), d.present);
}

/** What saving now would change although the settings didn't: someone edited its sections elsewhere. */
export function drift(d: ClientData): ReturnType<typeof reconcile> {
  return d.exists ? toChanges(d.form, d) : [];
}

// ---- in words ----

export interface Line {
  ok: boolean;
  text: string;
}

function whoText(f: ClientForm, d: ClientData): string {
  const n = f.macs.length;
  const devices = `${String(n)} device${n === 1 ? '' : 's'}`;
  const home = { all: 'every device on your home network', only: `${devices} on your home network`, except: `every home-network device but ${devices}`, none: '' }[f.who];
  const guests = f.guests.map((g) => `everything on ${d.guestZones.find((z) => z.id === g)?.label ?? g}`);
  const parts = [home, ...guests].filter((x) => x !== '');
  return parts.length <= 1 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

export function serverText(f: ClientForm): string {
  return f.endpointHost.trim() === '' ? 'the VPN server' : joinEndpoint(f.endpointHost.trim(), f.endpointPort);
}

/** What the settings set up, one line per part, for "What this sets up". */
export function describe(f: ClientForm, d: ClientData): Line[] {
  if (!f.enabled) return [{ ok: false, text: 'Off: every device goes out to the internet directly.' }];
  const lines: Line[] = [
    { ok: true, text: `Connects to ${serverText(f)} and sends ${whoText(f, d)} through it.` },
    { ok: true, text: 'Other devices, and the router’s own traffic (updates, the time, remote access), go out directly as before.' },
    f.killSwitch
      ? {
          ok: true,
          text: 'Kill switch: if the tunnel drops, those devices get no internet rather than going out unprotected. Nothing of theirs leaves by the internet port, so they don’t reach its own network directly either (an upstream router’s page, say).',
        }
      : { ok: false, text: 'No kill switch: if the tunnel drops, those devices go out directly until it’s back.' },
    hasIpv6(f)
      ? { ok: true, text: 'Their IPv6 goes through the tunnel too.' }
      : { ok: true, text: 'The VPN has no IPv6, so their IPv6 is blocked rather than going out directly: their apps use IPv4.' },
    {
      ok: false,
      text: 'Their DNS lookups don’t go through the VPN: the router answers them with the DNS page’s servers, which see your home address (your provider doesn’t, with encrypted DNS).',
    },
  ];
  if (d.sqm) {
    lines.push(
      f.shaper
        ? { ok: true, text: `A Smart Queue inside the tunnel (${f.downMbit} down, ${f.upMbit} up, Mbit/s) keeps latency low when one of them downloads.` }
        : { ok: false, text: 'No Smart Queue inside the tunnel: the internet port’s queue sees it as one connection, so one big download slows everything in it.' },
    );
  }
  return lines;
}

/** What a save did, compared with before, in the past tense. */
export function summary(before: ClientForm | undefined, after: ClientForm, d: ClientData): string[] {
  const out: string[] = [];
  if (after.enabled && before?.enabled !== true) out.push(`Turned the VPN on: ${serverText(after)} now carries ${whoText(after, d)}.`);
  else if (!after.enabled && before?.enabled === true) out.push('Turned the VPN off: every device goes out directly again.');
  else if (after.enabled && before !== undefined) {
    if (whoText(before, d) !== whoText(after, d) || JSON.stringify(before.macs) !== JSON.stringify(after.macs)) out.push(`It now carries ${whoText(after, d)}.`);
    if (serverText(before) !== serverText(after) || before.publicKey !== after.publicKey || before.privateKey !== after.privateKey) out.push(`Connected to ${serverText(after)} with the new settings.`);
  }
  if (before !== undefined && before.killSwitch !== after.killSwitch) out.push(after.killSwitch ? 'Turned the kill switch on.' : 'Turned the kill switch off.');
  if (before !== undefined && (before.shaper !== after.shaper || before.downMbit !== after.downMbit || before.upMbit !== after.upMbit)) {
    out.push(after.shaper ? `Set the Smart Queue inside the tunnel to ${after.downMbit} down, ${after.upMbit} up (Mbit/s).` : 'Took the Smart Queue out of the tunnel.');
  }
  if (out.length === 0) out.push('Saved.');
  return out;
}
