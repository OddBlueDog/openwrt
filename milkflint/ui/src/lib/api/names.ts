import { deviceName } from '@/features/clients/model';
import { getConfig, list, type Section, str } from '@/lib/api/uci';
import {
  getDhcpLeases,
  getHostHints,
  getNeighbors,
  type HostHints,
  type Lease,
  type Lease6,
  type Neighbor,
} from '@/lib/api/network';

/** Device names by MAC (lower case): its dhcp host entry's, else its lease's, else the hint's (clients/model.ts, deviceName). */
export function namesFrom(
  given: Map<string, string | undefined>,
  leased: Map<string, string | undefined>,
  hinted: Map<string, string | undefined>,
): Map<string, string> {
  const lower = (m: Map<string, string | undefined>) => new Map([...m].map(([k, v]) => [k.toLowerCase(), v] as const));
  const g = lower(given);
  const l = lower(leased);
  const h = lower(hinted);
  const names = new Map<string, string>();
  for (const mac of new Set([...g.keys(), ...l.keys(), ...h.keys()])) {
    const name = deviceName(g.get(mac), l.get(mac), h.get(mac));
    if (name !== undefined) names.set(mac, name);
  }
  return names;
}

/** Lease hostnames by MAC: IPv6 first, so an IPv4 name wins, and a lease with no name never erases one. */
export function leasedNames(v4: Lease[], v6: Lease6[]): Map<string, string | undefined> {
  const leased = new Map<string, string | undefined>();
  for (const l of [...v6, ...v4]) {
    if (l.hostname !== undefined && l.hostname !== '') leased.set(l.macaddr ?? '', l.hostname);
  }
  return leased;
}

/** The names from what the router said: its leases, host hints and dhcp config. */
export function namesFromRouter(leases: { v4: Lease[]; v6: Lease6[] }, hints: HostHints, dhcp: Section[]): Map<string, string> {
  const given = new Map(
    dhcp
      .filter((s) => s['.type'] === 'host')
      .flatMap((h) => list(h, 'mac').map((mac) => [mac.toLowerCase(), str(h, 'name')] as const)),
  );
  const hinted = new Map(Object.entries(hints).map(([mac, h]) => [mac, h.name] as const));
  return namesFrom(given, leasedNames(leases.v4, leases.v6), hinted);
}

/** Device names by MAC (lower case), as All devices finds them. */
export async function loadNames(): Promise<Map<string, string>> {
  const [leases, hints, dhcp] = await Promise.all([
    getDhcpLeases().catch(() => ({ v4: [] as Lease[], v6: [] as Lease6[] })),
    getHostHints().catch((): HostHints => ({})),
    getConfig('dhcp').catch(() => []),
  ]);
  return namesFromRouter(leases, hints, dhcp);
}

/** Who an address belongs to: the device's MAC and its name, where known. */
export interface AddressName {
  mac?: string;
  name?: string;
}

/** Canonical address (IPv6 lower case, compressed) -> its device, from hints first, then leases, then neighbours. */
export function addressNamesFrom(
  hints: HostHints,
  v4: Lease[],
  v6: Lease6[],
  neighbors: Neighbor[],
  names: Map<string, string>,
): Map<string, AddressName> {
  const out = new Map<string, AddressName>();
  const add = (addr: string | undefined, rawMac: string | undefined) => {
    if (addr === undefined || addr === '' || rawMac === undefined || rawMac === '' || out.has(addr)) return;
    const mac = rawMac.toLowerCase();
    const name = names.get(mac);
    out.set(addr, name === undefined ? { mac } : { mac, name });
  };
  for (const [mac, h] of Object.entries(hints)) {
    for (const a of [...(h.ipaddrs ?? []), ...(h.ip6addrs ?? [])]) add(a, mac);
  }
  for (const l of v4) add(l.ipaddr, l.macaddr);
  for (const l of v6) for (const a of l.ip6addrs) add(a, l.macaddr);
  for (const n of neighbors) add(n.ip, n.mac);
  return out;
}

export async function loadAddressNames(): Promise<Map<string, AddressName>> {
  const [leases, hints, neighbors, dhcp] = await Promise.all([
    getDhcpLeases().catch(() => ({ v4: [] as Lease[], v6: [] as Lease6[] })),
    getHostHints().catch((): HostHints => ({})),
    getNeighbors().catch((): Neighbor[] => []),
    getConfig('dhcp').catch(() => []),
  ]);
  return addressNamesFrom(hints, leases.v4, leases.v6, neighbors, namesFromRouter(leases, hints, dhcp));
}
