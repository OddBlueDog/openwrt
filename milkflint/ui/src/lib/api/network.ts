import { z } from 'zod';
import { call } from '@/lib/ubus';

const address = z.object({ address: z.string(), mask: z.number() });

const interfaceSchema = z.object({
  interface: z.string(),
  up: z.boolean(),
  pending: z.boolean().optional(),
  available: z.boolean().optional(),
  uptime: z.number().optional(),
  l3_device: z.string().optional(),
  device: z.string().optional(),
  proto: z.string(),
  'ipv4-address': z.array(address).optional(),
  'ipv6-address': z.array(address).optional(),
  'ipv6-prefix': z.array(address.loose()).optional(),
  'ipv6-prefix-assignment': z.array(address.loose()).optional(),
  route: z.array(z.object({ target: z.string(), mask: z.number(), nexthop: z.string() }).loose()).optional(),
  'dns-server': z.array(z.string()).optional(),
  errors: z.array(z.object({ code: z.string() }).loose()).optional(),
});
export type NetworkInterface = z.output<typeof interfaceSchema>;

export function getInterfaces(): Promise<NetworkInterface[]> {
  return call('network.interface', 'dump', {}, z.object({ interface: z.array(interfaceSchema) })).then((r) => r.interface);
}

const deviceSchema = z.object({
  type: z.string().optional(),
  /** "dsa" for a switch port */
  devtype: z.string().optional(),
  up: z.boolean().optional(),
  carrier: z.boolean().optional(),
  /** the link's speed and duplex, e.g. "1000F" (only while it has a link) */
  speed: z.string().optional(),
  /** the speeds the port can do, e.g. "2500baseT-F" */
  'link-supported': z.array(z.string()).optional(),
  /** the speeds the device at the other end of the cable offered */
  'link-partner-advertising': z.array(z.string()).optional(),
  macaddr: z.string().optional(),
  'bridge-members': z.array(z.string()).optional(),
  statistics: z
    .object({
      rx_bytes: z.number(),
      tx_bytes: z.number(),
      rx_packets: z.number().optional(),
      tx_packets: z.number().optional(),
      rx_errors: z.number().optional(),
      tx_errors: z.number().optional(),
      rx_dropped: z.number().optional(),
      tx_dropped: z.number().optional(),
    })
    .loose()
    .optional(),
});
export type NetworkDevice = z.output<typeof deviceSchema>;

export function getDevices(): Promise<Record<string, NetworkDevice>> {
  return call('network.device', 'status', {}, z.record(z.string(), deviceSchema));
}

const portSchema = z.object({ role: z.string(), device: z.string() });
export type BuiltinPort = z.output<typeof portSchema>;

/** The router's own Ethernet ports (its board's list, as LuCI's port status reads it): "lan1"…, and the WAN port. */
export function getBuiltinPorts(): Promise<BuiltinPort[]> {
  return call('luci', 'getBuiltinEthernetPorts', {}, z.object({ result: z.array(portSchema) })).then((r) => r.result);
}

// luci-rpc's lease times: seconds left (0 or less: expired), or false for a lease that never ends.
const expiresSchema = z.union([z.number(), z.literal(false)]).optional();
const leaseSchema = z.object({
  hostname: z.string().optional(),
  macaddr: z.string(),
  ipaddr: z.string().optional(),
  expires: expiresSchema,
});
const lease6Schema = z.object({
  hostname: z.string().optional(),
  macaddr: z.string().optional(),
  duid: z.string().optional(),
  ip6addr: z.string().optional(),
  ip6addrs: z.array(z.string()).optional(),
  expires: expiresSchema,
});
const leasesSchema = z
  .object({ dhcp_leases: z.array(leaseSchema.loose()).optional(), dhcp6_leases: z.array(lease6Schema.loose()).optional() })
  .loose();

export interface Lease {
  hostname?: string;
  macaddr: string;
  ipaddr?: string;
  expires?: number | false;
}
/** A DHCPv6 lease; its addresses come without the "/128" luci-rpc adds. */
export interface Lease6 {
  hostname?: string;
  macaddr?: string;
  duid?: string;
  ip6addrs: string[];
  expires?: number | false;
}

function without128(a: string): string {
  return a.endsWith('/128') ? a.slice(0, -4) : a;
}

/** luci-rpc's getDHCPLeases answer as the UI uses it: IPv4 and DHCPv6 leases. */
export function leasesFrom(raw: unknown): { v4: Lease[]; v6: Lease6[] } {
  const r = leasesSchema.parse(raw);
  const v4 = (r.dhcp_leases ?? []).map((l): Lease => {
    const out: Lease = { macaddr: l.macaddr };
    if (l.hostname !== undefined) out.hostname = l.hostname;
    if (l.ipaddr !== undefined) out.ipaddr = l.ipaddr;
    if (l.expires !== undefined) out.expires = l.expires;
    return out;
  });
  const v6 = (r.dhcp6_leases ?? []).map((l): Lease6 => {
    const raws = l.ip6addrs ?? (l.ip6addr === undefined ? [] : [l.ip6addr]);
    const out: Lease6 = { ip6addrs: raws.map(without128) };
    if (l.hostname !== undefined) out.hostname = l.hostname;
    if (l.macaddr !== undefined) out.macaddr = l.macaddr;
    if (l.duid !== undefined) out.duid = l.duid;
    if (l.expires !== undefined) out.expires = l.expires;
    return out;
  });
  return { v4, v6 };
}

/** DHCP leases (dnsmasq and odhcpd), with the hostnames devices sent. */
export function getDhcpLeases(): Promise<{ v4: Lease[]; v6: Lease6[] }> {
  return call('luci-rpc', 'getDHCPLeases', {}, z.unknown()).then(leasesFrom);
}

/** DHCPv4 leases (dnsmasq), with the hostnames devices sent. */
export function getLeases(): Promise<Lease[]> {
  return getDhcpLeases().then((l) => l.v4);
}

/** Interface name -> its IPv4 address with prefix, e.g. "192.168.1.1/24". */
export function ipv4(iface: NetworkInterface | undefined): string | undefined {
  const a = iface?.['ipv4-address']?.[0];
  return a === undefined ? undefined : `${a.address}/${String(a.mask)}`;
}

const neighborSchema = z.object({ ip: z.string(), mac: z.string(), dev: z.string(), state: z.number() });
export type Neighbor = z.output<typeof neighborSchema>;

/** IPv4 neighbours from the kernel, with their reachability state. */
export function getNeighbors(): Promise<Neighbor[]> {
  return call('milkflint', 'neighbors', {}, z.object({ neighbors: z.array(neighborSchema) })).then((r) => r.neighbors);
}

// Linux NUD_* states: answered recently (or being checked right now).
const NUD_REACHABLE = 0x02;
const NUD_DELAY = 0x08;
const NUD_PROBE = 0x10;

export function isReachable(n: Neighbor): boolean {
  return (n.state & (NUD_REACHABLE | NUD_DELAY | NUD_PROBE)) !== 0;
}

const hintSchema = z.object({
  name: z.string().optional(),
  ipaddrs: z.array(z.string()).optional(),
  ip6addrs: z.array(z.string()).optional(),
});
export type HostHint = z.output<typeof hintSchema>;
export type HostHints = Record<string, HostHint>;

/** MAC -> names and addresses the router knows (neighbours, leases, /etc/ethers). */
export function getHostHints(): Promise<HostHints> {
  return call('luci-rpc', 'getHostHints', {}, z.record(z.string(), hintSchema));
}

/** A hint's name without the local domain: "iPhone.lan" -> "iPhone". */
export function hintName(h: HostHint | undefined): string | undefined {
  const name = h?.name?.split('.')[0];
  return name === '' ? undefined : name;
}

/**
 * A MAC the device made up rather than its maker's (the locally administered
 * bit): phones' and laptops' private Wi-Fi addresses, which say nothing about
 * who made the device.
 */
export function isPrivateMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return !Number.isNaN(first) && (first & 0x02) !== 0;
}

/** Global IPv6 addresses: not link-local (fe80::/10) or unique local (fc00::/7). */
export function globalIpv6(addrs: readonly string[] | undefined): string[] {
  return (addrs ?? []).filter((a) => !/^f[cde]/i.test(a));
}

/**
 * The router's IPv6 on the internet side, from its interfaces (wan6, PPPoE's
 * wan_6, and wan itself): the global address it was given, if any, and the
 * range (prefix) delegated to it for the devices behind it. Many providers
 * give only the range; each is "address/length".
 */
export function wanIpv6(interfaces: readonly (NetworkInterface | undefined)[]): {
  address: string | undefined;
  range: string | undefined;
} {
  const v6 = interfaces.filter((i) => i !== undefined);
  const address = v6.flatMap((i) => i['ipv6-address'] ?? []).find((a) => globalIpv6([a.address]).length > 0);
  const range = v6.flatMap((i) => i['ipv6-prefix'] ?? [])[0];
  return {
    address: address === undefined ? undefined : `${address.address}/${String(address.mask)}`,
    range: range === undefined ? undefined : `${range.address}/${String(range.mask)}`,
  };
}

/** The interfaces wanIpv6 reads, out of netifd's list. */
export function wanInterfaces(interfaces: readonly NetworkInterface[]): NetworkInterface[] {
  return ['wan6', 'wan_6', 'wan'].flatMap((name) => interfaces.filter((i) => i.interface === name));
}

/** "192.168.1.1" + "255.255.255.0" or "24" -> prefix length. */
export function prefixLength(netmask: string | undefined): number {
  if (netmask === undefined) return 24;
  if (/^\d+$/.test(netmask)) return Number(netmask);
  return netmask
    .split('.')
    .map(
      (o) =>
        Number(o)
          .toString(2)
          .split('')
          .filter((b) => b === '1').length,
    )
    .reduce((a, b) => a + b, 0);
}

export function ipToInt(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

export function intToIp(n: number): string {
  return [24, 16, 8, 0].map((s) => String(Math.floor(n / 2 ** s) % 256)).join('.');
}

/** Whether `ip` is a usable host address in the subnet of `routerIp`/`prefix`. */
export function inSubnet(ip: string, routerIp: string, prefix: number): boolean {
  const a = ipToInt(ip);
  const r = ipToInt(routerIp);
  if (a === undefined || r === undefined) return false;
  const size = 2 ** (32 - prefix);
  const base = Math.floor(r / size) * size;
  return a > base && a < base + size - 1;
}
