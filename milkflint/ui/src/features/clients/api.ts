// Every device the router knows of, from what it already keeps: DHCP leases,
// the neighbour table, the host hints, the Wi-Fi stations and the DHCP host
// sections (names and reserved addresses).
import { getHostHints, getLeases, getNeighbors, hintName, inSubnet, ipToInt, isReachable, prefixLength } from '@/lib/api/network';
import { getConfig, list, type Section, str } from '@/lib/api/uci';
import { bandOf, getAccessPoints, stationSnr } from '@/lib/api/wireless';

export interface Device {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  wifi:
    | {
        band: string | undefined;
        ssid: string | undefined;
        signal: number | undefined;
        snr: number | undefined;
        rate: number | undefined;
        connected: number | undefined;
      }
    | undefined;
  online: boolean;
  /** seconds left on its DHCP lease */
  leaseExpires: number | undefined;
  reservation: Section | undefined;
}

export interface ClientsData {
  devices: Device[];
  routerIp: string;
  prefix: number;
}

export async function loadClients(): Promise<ClientsData> {
  const [leases, hints, neighbors, aps, dhcp, network] = await Promise.all([
    getLeases().catch(() => []),
    getHostHints().catch(() => ({})),
    getNeighbors().catch(() => []),
    getAccessPoints().catch(() => []),
    getConfig('dhcp'),
    getConfig('network'),
  ]);
  const lan = network.find((s) => s['.name'] === 'lan');
  const routerIp = str(lan, 'ipaddr')?.split('/')[0] ?? '192.168.1.1';
  const prefix =
    str(lan, 'ipaddr')?.includes('/') === true ? Number(str(lan, 'ipaddr')?.split('/')[1]) : prefixLength(str(lan, 'netmask'));

  const devices = new Map<string, Device>();
  const get = (mac: string): Device => {
    const key = mac.toLowerCase();
    let d = devices.get(key);
    if (d === undefined) {
      d = {
        mac: key,
        name: undefined,
        ip: undefined,
        wifi: undefined,
        online: false,
        leaseExpires: undefined,
        reservation: undefined,
      };
      devices.set(key, d);
    }
    return d;
  };

  // Devices that answered recently on the LAN. (The router's own addresses
  // and anything outside the LAN, like the WAN gateway, aren't clients.)
  for (const n of neighbors) {
    if (!inSubnet(n.ip, routerIp, prefix) || n.ip === routerIp) continue;
    const d = get(n.mac);
    d.ip = n.ip;
    if (isReachable(n)) d.online = true;
  }
  for (const [mac, h] of Object.entries(hints)) {
    const d = devices.get(mac.toLowerCase());
    if (d !== undefined) d.name = hintName(h) ?? d.name;
  }
  for (const l of leases) {
    const d = get(l.macaddr);
    d.name = l.hostname ?? d.name;
    d.ip = l.ipaddr ?? d.ip;
    d.leaseExpires = l.expires;
  }
  for (const ap of aps) {
    for (const s of ap.stations) {
      const d = get(s.mac);
      d.online = true;
      d.wifi = {
        band: bandOf(ap.info?.frequency),
        ssid: ap.ssid,
        signal: s.signal_avg ?? s.signal,
        snr: stationSnr(s, ap.info?.noise),
        rate: s.tx?.rate === undefined ? undefined : s.tx.rate * 1000,
        connected: s.connected_time,
      };
    }
  }
  for (const host of dhcp.filter((s) => s['.type'] === 'host')) {
    for (const mac of list(host, 'mac')) {
      const d = get(mac);
      d.reservation = host;
      d.name = str(host, 'name') ?? d.name;
      d.ip = str(host, 'ip') ?? d.ip;
    }
  }

  const sorted = [...devices.values()].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return (ipToInt(a.ip ?? '') ?? 1e10) - (ipToInt(b.ip ?? '') ?? 1e10);
  });
  return { devices: sorted, routerIp, prefix };
}
