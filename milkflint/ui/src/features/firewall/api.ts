// What the Firewall page reads. The settings are OpenWrt's own (UCI through
// rpcd, as LuCI's firewall pages use them); the live figures come from the
// running ruleset, `nft --json list ruleset`, which LuCI's status page also
// runs through rpcd's file object, and fw4's own check of the config says
// what it skips (both read-only; this feature's acl.json allows them).
import { z } from 'zod';
import { getHostHints, getInterfaces, getLeases, inSubnet, type NetworkInterface } from '@/lib/api/network';
import { bool, getConfig, list, type Section, str } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import { type FirewallConfig, isInternetZone, type Names, parseFirewall } from './model';

export interface Device {
  /** lower case */
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  /** its dhcp host section (a name, a reserved address or both) */
  host: string | undefined;
  /** whether that section reserves its address */
  reserved: boolean;
}

export interface Network {
  name: string;
  up: boolean;
  device: string | undefined;
  /** its IPv4 address and prefix, while up */
  ipv4: { address: string; prefix: number } | undefined;
}

export interface FirewallData {
  sections: Section[];
  cfg: FirewallConfig;
  networks: Network[];
  devices: Device[];
  names: Names;
  /** the router's own address on the home network */
  routerIp: string;
  /** the internet zone's IPv4 address, while it has one */
  wanAddress: string | undefined;
  upnp: boolean | undefined;
}

export async function loadFirewall(): Promise<FirewallData> {
  const [sections, milkflint, network, dhcp, upnpd, interfaces, leases, hints] = await Promise.all([
    getConfig('firewall'),
    // the guest networks' labels, for their zones' titles
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('network'),
    getConfig('dhcp').catch((): Section[] => []),
    getConfig('upnpd').catch((): Section[] => []),
    getInterfaces().catch((): NetworkInterface[] => []),
    getLeases().catch(() => []),
    getHostHints().catch(() => ({})),
  ]);
  const cfg = parseFirewall(sections, milkflint);
  const live = new Map(interfaces.map((i) => [i.interface, i]));
  const networks = network
    .filter((s) => s['.type'] === 'interface' && s['.name'] !== 'loopback')
    .map((s): Network => {
      const i = live.get(s['.name']);
      const a = i?.['ipv4-address']?.[0];
      return { name: s['.name'], up: i?.up === true, device: i?.l3_device ?? i?.device, ipv4: a === undefined ? undefined : { address: a.address, prefix: a.mask } };
    });
  const lan = networks.find((n) => n.name === 'lan');
  const lanSection = network.find((s) => s['.name'] === 'lan');
  const routerIp = lan?.ipv4?.address ?? str(lanSection, 'ipaddr')?.split('/')[0] ?? '192.168.1.1';

  const devices = new Map<string, Device>();
  const get = (mac: string): Device => {
    const key = mac.toLowerCase();
    let d = devices.get(key);
    if (d === undefined) {
      d = { mac: key, name: undefined, ip: undefined, host: undefined, reserved: false };
      devices.set(key, d);
    }
    return d;
  };
  for (const [mac, h] of Object.entries(hints)) {
    const d = get(mac);
    d.name = h.name ?? d.name;
    d.ip = h.ipaddrs?.[0] ?? d.ip;
  }
  for (const l of leases) {
    const d = get(l.macaddr);
    d.name = l.hostname ?? d.name;
    d.ip = l.ipaddr ?? d.ip;
  }
  for (const host of dhcp.filter((s) => s['.type'] === 'host')) {
    for (const mac of list(host, 'mac')) {
      const d = get(mac);
      d.name = str(host, 'name') ?? d.name;
      d.host = host['.name'];
      const ip = str(host, 'ip');
      if (ip !== undefined) {
        d.ip = ip;
        d.reserved = true;
      }
    }
  }
  const sorted = [...devices.values()].sort((a, b) => (a.name ?? a.ip ?? a.mac).localeCompare(b.name ?? b.ip ?? b.mac));
  const byMac = new Map<string, string>();
  const byIp = new Map<string, string>();
  for (const d of sorted) {
    if (d.name === undefined) continue;
    byMac.set(d.mac, d.name);
    if (d.ip !== undefined) byIp.set(d.ip, d.name);
  }
  byIp.set(routerIp, 'the router');

  const wanNets = cfg.zones.filter(isInternetZone).flatMap((z) => z.networks);
  const wanAddress = networks.find((n) => wanNets.includes(n.name) && n.ipv4 !== undefined)?.ipv4?.address;
  // the devices a forward or block can be for: on the home side, not the router itself
  const own = new Set(networks.flatMap((n) => (n.ipv4 === undefined ? [] : [n.ipv4.address])));
  const homeNets = networks.filter((n) => !wanNets.includes(n.name) && n.ipv4 !== undefined);
  const atHome = (ip: string): boolean => !own.has(ip) && homeNets.some((n) => n.ipv4 !== undefined && inSubnet(ip, n.ipv4.address, n.ipv4.prefix));
  const upnpSection = upnpd.find((s) => s['.type'] === 'upnpd');
  return {
    sections,
    cfg,
    networks,
    devices: sorted.filter((d) => (d.ip === undefined ? d.name !== undefined : atHome(d.ip))),
    names: { byMac, byIp },
    routerIp,
    wanAddress,
    upnp: upnpSection === undefined ? undefined : bool(upnpSection, 'enabled'),
  };
}

/** The zone a device's address is in, by the live subnets of the zones' networks. */
export function zoneForIp(data: FirewallData, ip: string): string | undefined {
  const net = data.networks.find((n) => n.ipv4 !== undefined && inSubnet(ip, n.ipv4.address, n.ipv4.prefix));
  if (net === undefined) return undefined;
  return data.cfg.zones.find((z) => z.networks.includes(net.name))?.name;
}

/** The device with this address, when the router knows it and hasn't reserved the address for it. */
export function unreservedDevice(data: FirewallData, ip: string): Device | undefined {
  const d = data.devices.find((x) => x.ip === ip);
  return d === undefined || d.reserved ? undefined : d;
}

/** Why port forwards can't work from the internet: the router's own internet address is private. */
export function wanBehindNat(address: string | undefined): 'private' | 'cgnat' | undefined {
  if (address === undefined) return undefined;
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168)) return 'private';
  if (a === 100 && b >= 64 && b < 128) return 'cgnat';
  return undefined;
}

// ---- Live figures ----

export interface Counters {
  /** packets each filter rule matched, by fw4's name for it */
  rules: ReadonlyMap<string, number>;
  /** connections each port forward or NAT rule handled (NAT sees a connection's first packet only) */
  nat: ReadonlyMap<string, number>;
}

const nftRule = z.object({
  rule: z
    .object({
      table: z.string(),
      chain: z.string(),
      comment: z.string().optional(),
      expr: z.array(z.unknown()).optional(),
    })
    .loose(),
});
const counterExpr = z.object({ counter: z.object({ packets: z.number(), bytes: z.number() }) });

const execResult = z.object({ code: z.number(), stdout: z.string().optional(), stderr: z.string().optional() }).loose();

function add(map: Map<string, number>, key: string, n: number): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

/** The counters since fw4 last loaded the ruleset (every firewall change reloads it). */
export async function getCounters(): Promise<Counters> {
  const res = await call('file', 'exec', { command: '/usr/sbin/nft', params: ['--terse', '--json', 'list', 'ruleset'] }, execResult);
  const rules = new Map<string, number>();
  const nat = new Map<string, number>();
  const parsed = z.object({ nftables: z.array(z.unknown()) }).safeParse(JSON.parse(res.stdout ?? '{}'));
  for (const item of parsed.success ? parsed.data.nftables : []) {
    const r = nftRule.safeParse(item);
    if (!r.success || r.data.rule.table !== 'fw4') continue;
    const { chain, comment, expr } = r.data.rule;
    let packets: number | undefined;
    for (const e of expr ?? []) {
      const c = counterExpr.safeParse(e);
      if (c.success) packets = c.data.counter.packets;
    }
    if (packets === undefined) continue;
    if (comment?.startsWith('!fw4: ') !== true) continue;
    const name = comment.slice(6);
    add(chain.startsWith('dstnat') || chain.startsWith('srcnat') ? nat : rules, name, packets);
  }
  return { rules, nat };
}

/**
 * What fw4 says about the config (`fw4 check`, which changes nothing): the
 * sections it skips and why, as "@nat[0] (Name) option 'src_ip' must not be a
 * list". Sections that are just turned off aren't news.
 */
export async function getWarnings(): Promise<string[]> {
  const res = await call('file', 'exec', { command: '/sbin/fw4', params: ['check'] }, execResult);
  const lines = `${res.stderr ?? ''}\n${res.stdout ?? ''}`.split('\n').map((l) => l.trim());
  const warnings = lines
    .filter((l) => l.startsWith('[!]') && !l.includes('Automatically including') && !l.endsWith('is disabled, ignoring section'))
    .map((l) => l.replace(/^\[!\]\s*/, ''));
  if (res.code !== 0) warnings.push(`The ruleset fails nftables’ check: ${lines.filter((l) => l !== '').at(-1) ?? 'no details'}`);
  return warnings;
}

const mappingSchema = z.object({
  proto: z.string(),
  ext_port: z.number(),
  int_addr: z.string(),
  int_port: z.number(),
  remaining: z.number().nullable(),
  description: z.string(),
});
export type UpnpMapping = z.output<typeof mappingSchema>;

/** The ports devices opened themselves (the UPnP feature's rpcd plugin). */
export async function getUpnpMappings(): Promise<UpnpMapping[]> {
  return (await call('milkflint.upnp', 'mappings', {}, z.object({ mappings: z.array(mappingSchema) }))).mappings;
}
