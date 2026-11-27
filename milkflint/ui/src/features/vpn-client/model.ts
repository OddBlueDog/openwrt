// The VPN client as the page edits it, and the sections that make it. The
// tunnel is OpenWrt's own WireGuard interface (wg_out) with one peer, the
// provider's server, whose routes go in a table of their own (2100), so
// nothing uses it by itself. fw4 MARK rules mark the chosen devices'
// traffic as it arrives, and netifd's routing rules send marked traffic:
// first to the main table's own routes but not its default (the home and
// guest networks, remote access, stay reachable), then into the tunnel's
// table, and with the kill switch to nowhere, when the tunnel has no route.
// The router's own traffic isn't marked, so it goes out as before. The
// zone masquerades, as the internet's does. Sites that go direct are a list
// of names in dhcp's ipset section: dnsmasq puts their addresses in two fw4
// sets as it answers, and a MARK rule per zone, after the marks, takes the
// VPN's bits off traffic to them, so it goes out by the internet port.
// Everything is read back from those sections, so a change made in LuCI
// shows here.
import { z } from 'zod';
import { type HostHint, hintName, inSubnet, intToIp, ipToInt, type Lease } from '@/lib/api/network';
import { formErrors } from '@/lib/form/errors';
import { type Owned, reconcile, type Wanted } from '@/lib/api/owned';
import { list, type Section } from '@/lib/api/uci';
import { isKey, joinEndpoint, parseConf, type Tunnel, type WgConf } from '@/lib/api/wireguard';
import { validHost } from '@/lib/hostnames';
import { isMac } from '../firewall/model';
import { GUEST_IDS, type GuestId } from '../wifi-guest/guest';
import { overlaps } from '../wifi-guest/model';
import type { Profile } from './profiles';
import {
  CLIENT,
  CLIENT_FIREWALL,
  CLIENT_MARK,
  CLIENT_META,
  CLIENT_PEER_TYPE,
  CLIENT_QUEUE,
  CLIENT_RULES,
  CLIENT_RULES6,
  CLIENT_SKIP,
  CLIENT_TABLE,
  DIRECT_DNS,
  DIRECT_SET4,
  DIRECT_SET6,
  directRuleSection,
  forwardSection,
  PROFILES_POINTER,
  leakSection,
  markSection,
  type SourceZone,
} from './sections';

export const DEFAULT_PORT = '51820';
export const DEFAULT_KEEPALIVE = '25';
/** The tunnel's rates start this far under the internet port's: its own headers (60–80 bytes a packet) have to fit. */
export const TUNNEL_SHARE = 0.92;
/** Sites that go direct, at most. */
export const MAX_DIRECT = 64;

/** Which home-network devices use it; guest networks are all or nothing. */
export type Who = 'all' | 'only' | 'except' | 'none';

const clientFields = z.object({
  enabled: z.boolean(),
  privateKey: z.string(),
  /** its addresses in the provider's network, e.g. 10.64.12.7/32 and an IPv6 one */
  addresses: z.array(z.string()),
  mtu: z.string(),
  /** the provider's server */
  publicKey: z.string(),
  presharedKey: z.string(),
  endpointHost: z.string(),
  endpointPort: z.string(),
  keepalive: z.string(),
  who: z.enum(['all', 'only', 'except', 'none']),
  /** the devices "only" or "except" means, by MAC (lower case) */
  macs: z.array(z.string()),
  guests: z.array(z.enum(GUEST_IDS)),
  killSwitch: z.boolean(),
  /** whether the tunnel's devices use the VPN provider's DNS instead of the router's */
  useVpnDns: z.boolean(),
  /** the provider's DNS servers, from [Interface] DNS (e.g. 10.64.0.1) */
  dns: z.array(z.string()),
  /** a Smart Queue inside the tunnel */
  shaper: z.boolean(),
  downMbit: z.string(),
  upMbit: z.string(),
  /** sites that go direct, by name (lower case, everything under each included): dhcp.wg_out_direct's domain list */
  direct: z.array(z.string()),
});

export type ClientForm = z.infer<typeof clientFields>;

/** The form's top-level fields, for setting several at once. */
export const clientFormKeys = clientFields.keyof().options;

export interface Device {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
}

/**
 * The home network's devices to pick from, by DHCP lease and the router's
 * host hints: those with an address on the home network that isn't the
 * router's own (the hints also hold the router's bridges and internet port,
 * the internet provider's gateway and Smart Queue's ifb interfaces).
 * `own` is every IPv4 address the router has.
 */
export function homeDevices(
  leases: readonly Lease[],
  hints: Readonly<Record<string, HostHint>>,
  lan: { ip: number; prefix: number } | undefined,
  own: readonly number[],
): Device[] {
  const atHome = (ip: string | undefined): boolean => {
    const n = ipToInt(ip ?? '');
    return n !== undefined && !own.includes(n) && (lan === undefined || overlaps(n, 32, lan.ip, lan.prefix));
  };
  const hintOf = new Map(Object.entries(hints).map(([mac, h]) => [mac.toLowerCase(), h]));
  const byMac = new Map<string, Device>();
  for (const l of leases) {
    const mac = l.macaddr.toLowerCase();
    if (atHome(l.ipaddr)) byMac.set(mac, { mac, name: l.hostname ?? hintName(hintOf.get(mac)), ip: l.ipaddr });
  }
  for (const [mac, h] of hintOf) {
    const ip = h.ipaddrs?.find(atHome);
    if (!byMac.has(mac) && ip !== undefined) byMac.set(mac, { mac, name: hintName(h), ip });
  }
  return [...byMac.values()].sort((a, b) => (a.name ?? a.ip ?? a.mac).localeCompare(b.name ?? b.ip ?? b.mac));
}

/** A device in the picker: its name, with its address when another has the same name. */
export function pickerLabel(d: Device, all: readonly Device[]): string {
  if (d.name === undefined) return d.ip ?? d.mac;
  return all.some((x) => x !== d && x.name === d.name) ? `${d.name} (${d.ip ?? d.mac})` : d.name;
}

export interface ClientData {
  installed: boolean;
  /** network.wg_out exists */
  exists: boolean;
  form: ClientForm;
  /** the peer's section: wg_out_server, or one LuCI made */
  peerSection: string;
  present: {
    network: Section[];
    firewall: Section[];
    sqm: Section[] | undefined;
    milkflint: Section[];
    /** for the sites that go direct; undefined: none of it is there */
    dhcp?: Section[] | undefined;
  };
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
  /**
   * AdGuard Home on the router (its page): 'tunnel' sends these devices'
   * lookups through the tunnel, to the DNS page's servers; 'automatic' can't
   * (the DNS page uses the internet provider's servers, which don't answer
   * through a VPN); undefined: it's off, or not in this firmware.
   */
  adguard?: 'tunnel' | 'automatic' | undefined;
  /** the IPv4 DNS servers the DNS page's device-DNS card tells the home network's devices to use (dhcp_option 6); none: the router */
  deviceDns?: string[] | undefined;
  /** the saved profiles (milkflint vpnp_*), in file order */
  profiles: Profile[];
  /** the active profile's id: undefined when none, or when the pointer names one that's gone */
  active: string | undefined;
  /**
   * The router's dnsmasq can fill nftables sets (dnsmasq-full), which sites
   * that go direct need: the basic build starts without them (OpenWrt's
   * dnsmasq init leaves out an option the binary doesn't have), so the list
   * would quietly do nothing. Not true (an older image): the list isn't
   * offered, written or checked.
   */
  nftset?: boolean | undefined;
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
    useVpnDns: true,
    dns: [],
    shaper: d.sqm && d.wanRates !== undefined,
    downMbit: d.wanRates === undefined ? '' : String(Math.floor(d.wanRates.down * TUNNEL_SHARE)),
    upMbit: d.wanRates === undefined ? '' : String(Math.floor(d.wanRates.up * TUNNEL_SHARE)),
    direct: [],
  };
}

const isIpv6Address = (s: string): boolean => /^[0-9a-f:]+$/i.test(s) && s.includes(':') && s.split('::').length <= 2;

export function isDnsAddress(s: string): boolean {
  return ipToInt(s) !== undefined || isIpv6Address(s);
}

/** The VPN's DNS servers as typed (keeps a trailing comma while typing), without blanks. */
export function dnsOf(f: ClientForm): string[] {
  return f.dns.map((a) => a.trim()).filter((a) => a !== '');
}

/** The VPN DNS servers that can actually be reached through the tunnel (IPv6 only when the tunnel has IPv6). */
export function activeDnsOf(f: ClientForm): string[] {
  return dnsOf(f).filter((a) => !a.includes(':') || hasIpv6(f));
}

/** A provider's .conf into the form: its keys, addresses, DNS and server. */
export function fromConf(f: ClientForm, c: WgConf): ClientForm {
  const dns = c.dns.filter(isDnsAddress);
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
    dns,
    useVpnDns: f.useVpnDns || (dnsOf(f).length === 0 && dns.length > 0),
  };
}

/** A provider's .conf text into the form, with what of it isn't used; or why it can't be read. */
export function readConf(f: ClientForm, text: string): { form: ClientForm; notes: string[] } | { error: string } {
  const conf = parseConf(text);
  if ('error' in conf) return { error: `That isn’t a WireGuard config this page can use: ${conf.error}` };
  const next = fromConf(f, conf);
  const notes: string[] = [];
  const skippedDns = conf.dns.filter((x) => !next.dns.includes(x));
  if (skippedDns.length > 0)
    notes.push(`Its search domain${skippedDns.length === 1 ? '' : 's'} (${skippedDns.join(', ')}) aren’t used.`);
  if (next.dns.length === 0 && next.useVpnDns)
    notes.push(
      'It didn’t list a DNS server: enter one under “Use VPN’s DNS”, or turn that switch off to keep this router’s DNS.',
    );
  else if (next.dns.length > 0 && !next.useVpnDns)
    notes.push(`Its DNS server (${next.dns.join(', ')}) was saved, ready if you turn “Use VPN’s DNS” back on.`);
  const all =
    conf.peer.allowedIps.length === 0 || (conf.peer.allowedIps.includes('0.0.0.0/0') && conf.peer.allowedIps.includes('::/0'));
  if (!all)
    notes.push(
      `Its AllowedIPs (${conf.peer.allowedIps.join(', ')}) are replaced: this page sends all of a device’s traffic through the VPN.`,
    );
  return { form: next, notes };
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

/** Where each check's message goes in the form, by the key the page shows it under. */
const FIELD_OF = {
  private: 'privateKey',
  public: 'publicKey',
  psk: 'presharedKey',
  host: 'endpointHost',
  port: 'endpointPort',
  addresses: 'addresses',
  mtu: 'mtu',
  keepalive: 'keepalive',
  dns: 'dns',
  macs: 'macs',
  who: 'who',
  shaper: 'shaper',
  direct: 'direct',
} as const satisfies Record<string, keyof ClientForm>;

const isCheckKey = (key: string): key is keyof typeof FIELD_OF => Object.hasOwn(FIELD_OF, key);

/** The form's checks against the router as loaded (its own networks, whether it has nftset for the direct sites). */
export function clientFormSchema(d: ClientData): z.ZodType<ClientForm, ClientForm> {
  return clientFields.superRefine((f, ctx) => {
    for (const [key, message] of Object.entries(checks(f, d))) {
      if (message !== undefined && isCheckKey(key)) ctx.addIssue({ code: 'custom', path: [FIELD_OF[key]], message });
    }
  });
}

/** The schema's verdict by the keys the page shows them under: private, public, host, port, addresses… */
export function clientErrors(f: ClientForm, d: ClientData): Errors {
  const found = formErrors(clientFormSchema(d), f);
  const e: Errors = {};
  for (const [key, field] of Object.entries(FIELD_OF)) {
    const message = found[field];
    if (message !== undefined) e[key] = message;
  }
  return e;
}

function checks(f: ClientForm, d: ClientData): Errors {
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
    const v4 = addressesOf(f)
      .map(v4Of)
      .filter((a) => a !== undefined);
    if (v4.length === 0) e['addresses'] = 'At least one IPv4 address ([Interface] Address), like 10.64.12.7/32.';
    else {
      const clash = v4.find(
        (a) =>
          (d.lan !== undefined && overlaps(a.ip, a.prefix, d.lan.ip, d.lan.prefix)) ||
          d.taken.some((t) => overlaps(a.ip, a.prefix, t.ip, t.prefix)),
      );
      if (clash !== undefined) e['addresses'] = `${intToIp(clash.ip)} is inside one of this router’s own networks.`;
    }
    if (f.mtu !== '' && (!/^\d+$/.test(f.mtu) || Number(f.mtu) < 1280 || Number(f.mtu) > 1500))
      e['mtu'] = 'From 1280 to 1500, or empty for 1420.';
    if (f.keepalive !== '' && !portOk(f.keepalive, 0)) e['keepalive'] = 'Seconds, or empty.';
  }
  const dns = dnsOf(f);
  if (dns.some((a) => !isDnsAddress(a))) {
    e['dns'] = 'One or more IP addresses, separated by commas (like 10.64.0.1).';
  } else if (f.useVpnDns && (f.enabled || !blank)) {
    if (dns.length === 0) e['dns'] = 'Enter the VPN’s DNS server ([Interface] DNS), or turn off “Use VPN’s DNS”.';
    else if (!hasIpv6(f) && !dns.some((a) => ipToInt(a) !== undefined))
      e['dns'] = 'Add an IPv4 DNS server: this tunnel has no IPv6 address.';
  }
  if ((f.who === 'only' || f.who === 'except') && f.macs.length === 0) e['macs'] = 'Add at least one device.';
  if (f.macs.some((m) => !isMac(m))) e['macs'] = 'One of these isn’t a MAC address.';
  if (f.who === 'none' && f.guests.length === 0) e['who'] = 'Pick who uses it: home-network devices, a guest network, or both.';
  if (f.shaper) {
    const rate = (v: string): boolean => /^\d+(\.\d+)?$/.test(v) && Number(v) > 0;
    if (!rate(f.downMbit) || !rate(f.upMbit)) e['shaper'] = 'Both rates, in Mbit/s.';
  }
  // the field cleans what's typed; this is for a list edited in LuCI
  if (d.nftset === true) {
    const bad = f.direct.filter((s) => !validHost(s));
    if (bad.length > 0) e['direct'] = `Not a site’s name as this list takes it: ${bad.join(', ')}.`;
    else if (f.direct.length > MAX_DIRECT) e['direct'] = `At most ${String(MAX_DIRECT)} sites.`;
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
    { config: 'milkflint', name: CLIENT_META },
    { config: 'dhcp', name: DIRECT_DNS },
  ];
}

/** The sites that go direct as the router has them: dhcp.wg_out_direct's domain list, LuCI's additions included. */
export function directOf(dhcp: readonly Section[]): string[] {
  return list(
    dhcp.find((s) => s['.name'] === DIRECT_DNS),
    'domain',
  );
}

/** The sites a save writes: none where dnsmasq can't fill the sets. */
function directIn(f: ClientForm, d: Pick<ClientData, 'nftset'>): string[] {
  return d.nftset === true ? f.direct : [];
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
  // the mark's bits cleared, whatever else is set
  const unmark = `0x0/${CLIENT_MARK.split('/')[1] ?? ''}`;
  const direct = directIn(f, d);
  const label = (z: SourceZone): string =>
    z === 'lan' ? 'Home' : (d.guestZones.find((g) => g.id === z)?.label ?? z).replace(/[^A-Za-z0-9]+/g, '-');
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
  if (direct.length > 0) {
    for (const [name, family] of [
      [DIRECT_SET4, 'ipv4'],
      [DIRECT_SET6, 'ipv6'],
    ] as const) {
      // no timeout: an address that ran out mid-connection would send its later packets into the tunnel
      w.push({ config: 'firewall', type: 'ipset', name, values: { name, family, match: ['dest_ip'], timeout: undefined } });
    }
    w.push({
      config: 'dhcp',
      type: 'ipset',
      name: DIRECT_DNS,
      values: { name: [DIRECT_SET4, DIRECT_SET6], domain: direct, table: 'fw4', table_family: 'inet' },
    });
  }
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
        values: {
          name: 'Skip-VPN-Home',
          src,
          dest: '*',
          proto: 'all',
          family: 'any',
          src_mac: f.macs,
          target: 'MARK',
          set_xmark: unmark,
          enabled,
        },
      });
    }
    if (direct.length > 0) {
      // after the mark and the skip: traffic to those sites has its mark taken off again
      for (const [family, set] of [
        [4, DIRECT_SET4],
        [6, DIRECT_SET6],
      ] as const) {
        w.push({
          config: 'firewall',
          type: 'rule',
          name: directRuleSection(z, family),
          values: {
            name: `Direct-VPN-${label(z)}`,
            src,
            dest: '*',
            proto: 'all',
            family: `ipv${String(family)}`,
            ipset: `${set} dest`,
            target: 'MARK',
            set_xmark: unmark,
            enabled,
          },
        });
      }
    }
    if (f.killSwitch) {
      w.push({
        config: 'firewall',
        type: 'rule',
        name: leakSection(z),
        values: {
          name: `Block-VPN-Leak-${label(z)}`,
          src,
          dest: d.wanZone,
          proto: 'all',
          family: 'any',
          mark: CLIENT_MARK,
          target: 'DROP',
          enabled,
        },
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
  const dns = dnsOf(f);
  if (f.useVpnDns || dns.length > 0) {
    w.push({
      config: 'milkflint',
      type: 'vpn_client',
      name: CLIENT_META,
      values: {
        use_vpn_dns: f.useVpnDns ? '1' : '0',
        dns,
      },
    });
  }
  return w;
}

export function toChanges(f: ClientForm, d: ClientData): ReturnType<typeof reconcile> {
  return reconcile(wanted(f, d), owned(d), d.present);
}

/** Everything the VPN client is made of, for Remove. The profiles stay; none is active any more. */
export function removal(d: ClientData): ReturnType<typeof reconcile> {
  const changes = reconcile([], owned(d), d.present);
  const pointer = d.present.milkflint.find((s) => s['.name'] === PROFILES_POINTER);
  if (pointer?.['active'] !== undefined)
    changes.push({ op: 'unset', config: 'milkflint', section: PROFILES_POINTER, options: ['active'] });
  return changes;
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
  const home = {
    all: 'every device on your home network',
    only: `${devices} on your home network`,
    except: `every home-network device but ${devices}`,
    none: '',
  }[f.who];
  const guests = f.guests.map((g) => `everything on ${d.guestZones.find((z) => z.id === g)?.label ?? g}`);
  const parts = [home, ...guests].filter((x) => x !== '');
  return parts.length <= 1 ? (parts[0] ?? 'nothing') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
}

/** Who uses it, in a few words for the page's answer: "Every home device", "Only 2 devices and Guest Wi-Fi". */
export function whoSummary(f: ClientForm, d: Pick<ClientData, 'guestZones'>): string {
  const n = f.macs.length;
  const devices = `${String(n)} device${n === 1 ? '' : 's'}`;
  const home = { all: 'Every home device', only: `Only ${devices}`, except: `Every home device but ${devices}`, none: '' }[f.who];
  const guests = f.guests.map((g) => d.guestZones.find((z) => z.id === g)?.label ?? g);
  const parts = [home, ...guests].filter((x) => x !== '');
  if (parts.length === 0) return 'No one';
  const text = parts.length === 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1) ?? ''}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "bbc.co.uk, itv.com", or the first three and how many more. */
export function directText(sites: readonly string[]): string {
  return sites.length <= 3 ? sites.join(', ') : `${sites.slice(0, 3).join(', ')} and ${String(sites.length - 3)} more`;
}

export function serverText(f: ClientForm): string {
  return f.endpointHost.trim() === '' ? 'the VPN server' : joinEndpoint(f.endpointHost.trim(), f.endpointPort);
}

function dnsLine(f: ClientForm, d: ClientData): Line {
  if (f.useVpnDns) {
    const servers = activeDnsOf(f);
    if (servers.length === 0)
      return { ok: false, text: 'Their DNS lookups: “Use VPN’s DNS” is on, but no usable VPN DNS server is entered yet.' };
    const list = servers.join(', ');
    if (d.adguard !== undefined) {
      return {
        ok: true,
        text: `Their DNS lookups go through AdGuard Home, then through the tunnel to the VPN’s DNS (${list})${f.killSwitch ? ', and nowhere else' : ' (this router’s DNS while the tunnel is down, while the rest of their traffic goes out directly)'}. Other devices keep this router’s DNS.`,
      };
    }
    return {
      ok: true,
      text: `Their DNS lookups go through the tunnel to the VPN’s DNS (${list})${f.killSwitch ? ', and nowhere else' : ' (this router’s DNS while the tunnel is down)'}. Names on your network still work, and other devices keep this router’s DNS.`,
    };
  }
  if (d.adguard === 'tunnel') {
    return {
      ok: true,
      text: `Their DNS lookups go through AdGuard Home, then through the tunnel to the DNS page’s servers${f.killSwitch ? ', and nowhere else' : ' (this router’s DNS while the tunnel is down, while the rest of their traffic goes out directly)'}.`,
    };
  }
  if (d.adguard === 'automatic') {
    return {
      ok: false,
      text: 'Their DNS lookups don’t go through the VPN: the DNS page uses your internet provider’s servers, which don’t answer through a VPN. Turn on “Use VPN’s DNS”, or choose servers on the DNS page.',
    };
  }
  return {
    ok: false,
    text: 'Their DNS lookups don’t go through the VPN: the router answers them with the DNS page’s servers, which see your home address (your provider doesn’t, with encrypted DNS).',
  };
}

/** The tunnel's state in words: when the server stopped answering and what the devices get; undefined when there's nothing to say. */
export function tunnelLine(t: Tunnel | null, killSwitch: boolean, clock: (epoch: number) => string): string | undefined {
  if (t === null) return undefined;
  if (!t.up) {
    const stopped = `The server stopped answering at ${clock(t.since)}.`;
    return killSwitch
      ? `${stopped} With the kill switch on, those devices have no internet until it’s back.`
      : `${stopped} Those devices are going out directly, with this router’s DNS, until it’s back.`;
  }
  return t.dns_ok === false ? 'The VPN’s DNS isn’t answering.' : undefined;
}

/** The device-DNS servers inside the home network: the VPN's devices ask them directly, not through the tunnel. */
export function sameLanDns(d: ClientData): string[] {
  const lan = d.lan;
  if (lan === undefined) return [];
  const router = intToIp(lan.ip);
  return (d.deviceDns ?? []).filter((ip) => inSubnet(ip, router, lan.prefix));
}

/** What the settings set up, one line per part, for "What this sets up". */
export function describe(f: ClientForm, d: ClientData): Line[] {
  if (!f.enabled) return [{ ok: false, text: 'Off: every device goes out to the internet directly.' }];
  const direct = directIn(f, d);
  const some = direct.length > 0;
  const lines: Line[] = [
    { ok: true, text: `Connects to ${serverText(f)} and sends ${whoText(f, d)} through it.` },
    {
      ok: true,
      text: 'Other devices, and the router’s own traffic (updates, the time, remote access), go out directly as before.',
    },
    f.killSwitch
      ? {
          ok: true,
          text: some
            ? 'Kill switch: if the tunnel drops, those devices get no internet but the sites that go direct, rather than going out unprotected. Nothing else of theirs leaves by the internet port, so they don’t reach its own network directly either (an upstream router’s page, say).'
            : 'Kill switch: if the tunnel drops, those devices get no internet rather than going out unprotected. Nothing of theirs leaves by the internet port, so they don’t reach its own network directly either (an upstream router’s page, say).',
        }
      : {
          ok: false,
          text: some
            ? 'No kill switch: if the tunnel drops, those devices go out directly until it’s back. Their connections are cut when it drops and again when it’s back, even those to the sites that go direct: a stream from one of them restarts twice in each outage.'
            : 'No kill switch: if the tunnel drops, those devices go out directly until it’s back.',
        },
    hasIpv6(f)
      ? { ok: true, text: 'Their IPv6 goes through the tunnel too.' }
      : {
          ok: true,
          text: some
            ? 'The VPN has no IPv6, so their IPv6 is blocked rather than going out directly, except to the sites that go direct: their apps use IPv4 for the rest.'
            : 'The VPN has no IPv6, so their IPv6 is blocked rather than going out directly: their apps use IPv4.',
        },
    dnsLine(f, d),
  ];
  if (some) {
    lines.push({
      ok: true,
      text: `Sites that go direct (${directText(direct)}), and everything under them, skip the VPN: those devices reach them over your normal line, with this router’s DNS.`,
    });
  }
  const sameLan = sameLanDns(d);
  if (sameLan.length > 0) {
    lines.push({
      ok: false,
      text: `Devices told to use ${sameLan.join(', ')} look names up there directly, not through the VPN, and the kill switch can’t stop that on your own network.`,
    });
  }
  if (d.sqm) {
    lines.push(
      f.shaper
        ? {
            ok: true,
            text: `A Smart Queue inside the tunnel (${f.downMbit} down, ${f.upMbit} up, Mbit/s) keeps latency low when one of them downloads.`,
          }
        : {
            ok: false,
            text: 'No Smart Queue inside the tunnel: the internet port’s queue sees it as one connection, so one big download slows everything in it.',
          },
    );
  }
  return lines;
}

/** What a save did, compared with before, in the past tense. */
export function summary(before: ClientForm | undefined, after: ClientForm, d: ClientData): string[] {
  const out: string[] = [];
  if (after.enabled && before?.enabled !== true)
    out.push(`Turned the VPN on: ${serverText(after)} now carries ${whoText(after, d)}.`);
  else if (!after.enabled && before?.enabled === true) out.push('Turned the VPN off: every device goes out directly again.');
  else if (after.enabled && before !== undefined) {
    if (whoText(before, d) !== whoText(after, d) || JSON.stringify(before.macs) !== JSON.stringify(after.macs))
      out.push(`It now carries ${whoText(after, d)}.`);
    if (
      serverText(before) !== serverText(after) ||
      before.publicKey !== after.publicKey ||
      before.privateKey !== after.privateKey
    )
      out.push(`Connected to ${serverText(after)} with the new settings.`);
  }
  if (before !== undefined && before.killSwitch !== after.killSwitch)
    out.push(after.killSwitch ? 'Turned the kill switch on.' : 'Turned the kill switch off.');
  if (
    before !== undefined &&
    (before.useVpnDns !== after.useVpnDns || (after.useVpnDns && JSON.stringify(dnsOf(before)) !== JSON.stringify(dnsOf(after))))
  ) {
    out.push(
      after.useVpnDns
        ? `Its devices now use the VPN’s DNS${dnsOf(after).length > 0 ? ` (${dnsOf(after).join(', ')})` : ''}.`
        : 'Its devices now use this router’s DNS.',
    );
  }
  if (
    before !== undefined &&
    (before.shaper !== after.shaper || before.downMbit !== after.downMbit || before.upMbit !== after.upMbit)
  ) {
    out.push(
      after.shaper
        ? `Set the Smart Queue inside the tunnel to ${after.downMbit} down, ${after.upMbit} up (Mbit/s).`
        : 'Took the Smart Queue out of the tunnel.',
    );
  }
  const direct = directIn(after, d);
  if (d.nftset === true && JSON.stringify(before?.direct ?? []) !== JSON.stringify(direct)) {
    out.push(direct.length === 0 ? 'No sites go direct any more.' : `Sites that go direct: ${directText(direct)}.`);
  }
  if (out.length === 0) out.push('Saved.');
  return out;
}

const SERVER_ERRORS = ['host', 'port', 'public', 'private', 'psk', 'addresses', 'mtu'];

/** True when something in the server's fields needs fixing. */
export const serverNeedsFixing = (errors: Errors): boolean => SERVER_ERRORS.some((k) => errors[k] !== undefined);
