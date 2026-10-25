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
  return call('network.interface', 'dump', {}, z.object({ interface: z.array(interfaceSchema) })).then(
    (r) => r.interface,
  );
}

const deviceSchema = z.object({
  type: z.string().optional(),
  up: z.boolean().optional(),
  carrier: z.boolean().optional(),
  speed: z.string().optional(),
  macaddr: z.string().optional(),
  'bridge-members': z.array(z.string()).optional(),
  statistics: z
    .object({
      rx_bytes: z.number(),
      tx_bytes: z.number(),
      rx_packets: z.number().optional(),
      tx_packets: z.number().optional(),
    })
    .loose()
    .optional(),
});
export type NetworkDevice = z.output<typeof deviceSchema>;

export function getDevices(): Promise<Record<string, NetworkDevice>> {
  return call('network.device', 'status', {}, z.record(z.string(), deviceSchema));
}

const leaseSchema = z.object({
  hostname: z.string().optional(),
  macaddr: z.string(),
  ipaddr: z.string().optional(),
  expires: z.number().optional(),
});
export type Lease = z.output<typeof leaseSchema>;

/** DHCPv4 leases (dnsmasq), with the hostnames devices sent. */
export function getLeases(): Promise<Lease[]> {
  return call(
    'luci-rpc',
    'getDHCPLeases',
    {},
    z.object({ dhcp_leases: z.array(leaseSchema).optional() }).loose(),
  ).then((r) => r.dhcp_leases ?? []);
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

/** MAC -> names and addresses the router knows (neighbours, leases, /etc/ethers). */
export function getHostHints(): Promise<Record<string, HostHint>> {
  return call('luci-rpc', 'getHostHints', {}, z.record(z.string(), hintSchema));
}

/** "192.168.1.1" + "255.255.255.0" or "24" -> prefix length. */
export function prefixLength(netmask: string | undefined): number {
  if (netmask === undefined) return 24;
  if (/^\d+$/.test(netmask)) return Number(netmask);
  return netmask
    .split('.')
    .map((o) => Number(o).toString(2).split('').filter((b) => b === '1').length)
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
