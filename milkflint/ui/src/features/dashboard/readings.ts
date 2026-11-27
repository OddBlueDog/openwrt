// What Home shows, worked out from the router's readings: one set every
// POLL_MS (two batched requests), plus the wired devices (the neighbour
// table) every NEIGHBORS_MS and the board's ports once. Rates and CPU use
// come from the difference between two readings, and the charts from a
// rolling history: nextDashboard() takes each new reading once, with what
// it carried from the last (see use-dashboard.ts).
import {
  type BuiltinPort,
  getDevices,
  getHostHints,
  getInterfaces,
  getLeases,
  globalIpv6,
  isPrivateMac,
  type getNeighbors,
  type NetworkInterface,
} from '@/lib/api/network';
import { getSqmStatus, getStats, type Stats } from '@/lib/api/stats';
import { rate } from '@/lib/rates';
import { getBoard, getInfo, memoryInUse, type Board, type SystemInfo } from '@/lib/api/system';
import { getConfig, list, str } from '@/lib/api/uci';
import { bandOf, describeRate, generationOf, getAccessPoints, getWirelessStatus, stationSnr } from '@/lib/api/wireless';
import { deviceName } from '../clients/model';
import { directionsOf, type DirectionSummary, summarize } from '../sqm/cake';
import { wiredDevices } from './model';
import { type Port, portList, portsOf } from './ports';

export const POLL_MS = 2000;
export const HISTORY = 60; // samples: 2 minutes

/** How often Home asks for the wired devices (the neighbour table): they change slowly. */
export const NEIGHBORS_MS = 30_000;

export type Neighbors = Awaited<ReturnType<typeof getNeighbors>>;

export interface Sample {
  /** When it was taken, epoch seconds (this browser's clock). */
  t: number;
  cpu: number | undefined;
  memory: number;
  wanDown: number | undefined;
  wanUp: number | undefined;
  wifiDown: number | undefined;
  wifiUp: number | undefined;
  /** Devices online: on Wi-Fi, and wired when that's known. */
  devices: number;
}

export interface Radio {
  name: string;
  /** phy0, …: what its temperature sensor is under */
  phy: string | undefined;
  up: boolean;
  /** No network switched on: off by choice (Networks & radios), not down. */
  off: boolean;
  band: string | undefined;
  channel: number | undefined;
  htmode: string | undefined;
  txpower: number | undefined;
  noise: number | undefined;
  ssids: string[];
  clients: number;
  /** Traffic through its networks since the last sample, bit/s: to devices, and from them. */
  rateDown: number | undefined;
  rateUp: number | undefined;
}

export interface Client {
  mac: string;
  /** The name you gave it (All devices), else the one it sent, else one the router learned another way. */
  name: string | undefined;
  nameFrom: 'you' | 'device' | 'router' | undefined;
  /** It uses a private (made-up) MAC address. */
  privateMac: boolean;
  /** The newest Wi-Fi generation it's been seen using (7, 6, 5, 4; 0 for older). */
  generation: number | undefined;
  ip: string | undefined;
  /** The address reserved for it (it always gets this one). */
  reservedIp: string | undefined;
  ipv6: string[];
  band: string | undefined;
  ssid: string | undefined;
  signal: number | undefined;
  /** Signal-to-noise ratio, dB. */
  snr: number | undefined;
  /** Link rates in bit/s, as negotiated (not traffic). */
  rxRate: number | undefined;
  txRate: number | undefined;
  rxDescription: string | undefined;
  txDescription: string | undefined;
  /** Bytes since it joined: to it and from it. */
  txBytes: number | undefined;
  rxBytes: number | undefined;
  connectedSeconds: number | undefined;
  /** Its traffic since the last sample, bit/s: what it downloads (the router sends), and uploads. */
  down: number | undefined;
  up: number | undefined;
}

/** One direction of Smart Queue's shaping, with its rate since the last sample. */
export interface CakeDirection extends DirectionSummary {
  dev: string;
  download: boolean;
  /** bit/s */
  rate: number | undefined;
}

export interface Dashboard {
  board: Board;
  info: SystemInfo;
  stats: Stats;
  cpu: number | undefined;
  cores: number[];
  wan: NetworkInterface | undefined;
  wan6: NetworkInterface | undefined;
  lan: NetworkInterface | undefined;
  radios: Radio[];
  clients: Client[];
  /** Devices online on the LAN's cables (answering, and not on the Wi-Fi); undefined when the router can't say. */
  wired: number | undefined;
  /** The router's Ethernet ports: the WAN port first. */
  ports: Port[];
  /** Empty while Smart Queue isn't shaping. */
  cake: CakeDirection[];
  history: Sample[];
}

interface Counters {
  at: number;
  cpu: Stats['cpu'];
  bytes: Map<string, { rx: number; tx: number }>;
  /** bytes through each CAKE direction, by device */
  cake: Map<string, number>;
  /** bytes each Wi-Fi device has sent and received, by MAC */
  stations: Map<string, { tx: number | undefined; rx: number | undefined }>;
}

function cpuUse(prev: Stats['cpu'][number] | undefined, cur: Stats['cpu'][number]): number | undefined {
  if (prev === undefined) return undefined;
  const total = cur.total - prev.total;
  const idle = cur.idle - prev.idle;
  return total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : undefined;
}

function sum(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  for (const v of values) {
    if (v === undefined) return undefined;
    total += v;
  }
  return total;
}

/** One reading of the router, as asked every POLL_MS. */
export interface Readings {
  board: Board;
  info: SystemInfo;
  stats: Stats;
  devices: Awaited<ReturnType<typeof getDevices>>;
  interfaces: NetworkInterface[];
  wireless: Awaited<ReturnType<typeof getWirelessStatus>>;
  leases: Awaited<ReturnType<typeof getLeases>>;
  hints: Awaited<ReturnType<typeof getHostHints>>;
  dhcp: Awaited<ReturnType<typeof getConfig>>;
  sqm: Awaited<ReturnType<typeof getSqmStatus>> | undefined;
  /** the access points with their live details (a second batched request) */
  live: Awaited<ReturnType<typeof getAccessPoints>>;
  /** when it was read: performance.now() (for rates), and epoch seconds (this browser's clock, for the charts) */
  at: number;
  t: number;
}

export async function getReadings(): Promise<Readings> {
  const [board, info, stats, devices, interfaces, wireless, leases, hints, dhcp, sqm] = await Promise.all([
    getBoard(),
    getInfo(),
    getStats(),
    getDevices(),
    getInterfaces(),
    getWirelessStatus(),
    getLeases().catch(() => []),
    getHostHints().catch(() => ({})),
    getConfig('dhcp').catch(() => []),
    getSqmStatus().catch(() => undefined),
  ]);
  const at = performance.now();
  const t = Date.now() / 1000;
  const live = await getAccessPoints(wireless);
  // `pnpm dev` on the VM, which has no sensors: sample ones, so the Temperatures card shows (never in the built UI)
  if (import.meta.env.DEV && stats.temperatures.length === 0) {
    const { sampleTemperatures } = await import('@/dev/sample-sensors');
    const phys = Object.values(wireless).flatMap((r) =>
      r.disabled !== true && r.iwinfo?.phy !== undefined ? [r.iwinfo.phy] : [],
    );
    stats.temperatures = sampleTemperatures(phys, interfaces.find((i) => i.interface === 'wan')?.device);
  }
  return { board, info, stats, devices, interfaces, wireless, leases, hints, dhcp, sqm, live, at, t };
}

/** What one reading hands the next: the counters rates start from, the history, each client's newest Wi-Fi generation. */
export interface Carry {
  counters: Counters | undefined;
  history: Sample[];
  generations: Map<string, number>;
}

export const startCarry = (): Carry => ({ counters: undefined, history: [], generations: new Map() });

/** Home's figures from a new reading, the wired devices and the board's ports, and what to carry to the next. */
export function nextDashboard(
  r: Readings,
  neighbors: Neighbors | undefined,
  builtin: BuiltinPort[] | undefined,
  carry: Carry,
): { dashboard: Dashboard; carry: Carry } {
  const { board, info, stats, devices, interfaces, wireless, leases, hints, dhcp, sqm, live } = r;
  const now = r.at;

  // Rates since the previous sample.
  const prev = carry.counters;
  const seconds = prev === undefined ? 0 : (now - prev.at) / 1000;
  const bytes = new Map(
    Object.entries(devices).flatMap(([dev, d]) =>
      d.statistics === undefined ? [] : [[dev, { rx: d.statistics.rx_bytes, tx: d.statistics.tx_bytes }] as const],
    ),
  );
  const rateOf = (dev: string | undefined, dir: 'rx' | 'tx'): number | undefined =>
    dev === undefined ? undefined : rate(prev?.bytes.get(dev)?.[dir], bytes.get(dev)?.[dir], seconds);

  const bandName = (band: string | undefined): string | undefined =>
    band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band === '60g' ? '60 GHz' : band;
  const radios: Radio[] = Object.entries(wireless)
    .filter(([, r]) => r.disabled !== true)
    .map(([name, r]) => {
      const mine = live.filter((l) => l.radio === name);
      const iw = mine[0]?.info;
      return {
        name,
        phy: r.iwinfo?.phy,
        // on when a network broadcasts: a radio with none on (a fresh install) is up all the same,
        // and a network hostapd couldn't start has no link
        up: r.up && mine.some((l) => devices[l.ifname]?.carrier === true),
        off: (r.interfaces ?? []).length === 0,
        band: bandOf(iw?.frequency) ?? bandName(r.config?.band),
        channel: iw?.channel,
        htmode: iw?.htmode ?? r.config?.htmode,
        txpower: iw?.txpower,
        noise: iw?.noise,
        ssids: mine.flatMap((l) => (l.ssid !== undefined ? [l.ssid] : [])),
        clients: mine.reduce((n, l) => n + l.stations.length, 0),
        // an access point's tx is what its devices download
        rateDown: mine.length === 0 ? undefined : sum(mine.map((l) => rateOf(l.ifname, 'tx'))),
        rateUp: mine.length === 0 ? undefined : sum(mine.map((l) => rateOf(l.ifname, 'rx'))),
      };
    });

  // Names as All devices finds them.
  const leaseByMac = new Map(leases.map((l) => [l.macaddr.toLowerCase(), l]));
  const hintByMac = new Map(Object.entries(hints).map(([mac, h]) => [mac.toLowerCase(), h]));
  const hostByMac = new Map(
    dhcp.filter((s) => s['.type'] === 'host').flatMap((h) => list(h, 'mac').map((mac) => [mac.toLowerCase(), h] as const)),
  );
  const seen = new Map<string, number>();
  const clients: Client[] = live.flatMap((l) =>
    l.stations.map((s): Client => {
      const mac = s.mac.toLowerCase();
      const lease = leaseByMac.get(mac);
      const hint = hintByMac.get(mac);
      const host = hostByMac.get(mac);
      const name = deviceName(str(host, 'name'), lease?.hostname, hint?.name);
      const generation = [generationOf(s.rx), generationOf(s.tx), carry.generations.get(mac)].reduce<number | undefined>(
        (a, b) => (b === undefined ? a : Math.max(a ?? 0, b)),
        undefined,
      );
      if (generation !== undefined) seen.set(mac, generation);
      return {
        mac,
        name,
        nameFrom:
          name === undefined
            ? undefined
            : str(host, 'name') !== undefined
              ? 'you'
              : lease?.hostname !== undefined
                ? 'device'
                : 'router',
        privateMac: isPrivateMac(mac),
        generation,
        ip: lease?.ipaddr ?? hint?.ipaddrs?.[0] ?? str(host, 'ip'),
        reservedIp: str(host, 'ip'),
        ipv6: globalIpv6(hint?.ip6addrs),
        band: bandOf(l.info?.frequency),
        ssid: l.ssid,
        signal: s.signal_avg ?? s.signal,
        snr: stationSnr(s, l.info?.noise),
        rxRate: s.rx?.rate === undefined ? undefined : s.rx.rate * 1000,
        txRate: s.tx?.rate === undefined ? undefined : s.tx.rate * 1000,
        rxDescription: describeRate(s.rx),
        txDescription: describeRate(s.tx),
        txBytes: s.tx?.bytes,
        rxBytes: s.rx?.bytes,
        connectedSeconds: s.connected_time,
        down: rate(prev?.stations.get(mac)?.tx, s.tx?.bytes, seconds),
        up: rate(prev?.stations.get(mac)?.rx, s.rx?.bytes, seconds),
      };
    }),
  );
  clients.sort((a, b) => (b.signal ?? -200) - (a.signal ?? -200));

  const wan = interfaces.find((i) => i.interface === 'wan');
  // PPPoE's IPv6 comes up as wan_6 when it has no wan6 of its own
  const wan6 = interfaces.find((i) => i.interface === 'wan6') ?? interfaces.find((i) => i.interface === 'wan_6');
  const lan = interfaces.find((i) => i.interface === 'lan');
  // in access point mode the main router answers on the LAN too: it isn't one of the devices
  const gateway = lan?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop;
  const wired = wiredDevices(
    neighbors,
    lan?.['ipv4-address']?.[0],
    new Set(clients.map((c) => c.mac)),
    new Set(gateway === undefined ? [] : [gateway]),
  );

  const ports = portsOf(portList(builtin, devices, wan), devices, interfaces, rateOf);

  const cpuPrev = new Map(prev?.cpu.map((c) => [c.name, c]));
  const overall = stats.cpu.find((c) => c.name === 'cpu');
  const cpu = overall === undefined ? undefined : cpuUse(cpuPrev.get('cpu'), overall);
  const cores = stats.cpu.filter((c) => c.name !== 'cpu').map((c) => cpuUse(cpuPrev.get(c.name), c) ?? 0);
  const cake = directionsOf(sqm?.qdiscs ?? []).map((d): CakeDirection => {
    const summary = summarize(d);
    return { ...summary, dev: d.dev, download: d.download, rate: rate(prev?.cake.get(d.dev), summary.bytes, seconds) };
  });
  const counters: Counters = {
    at: now,
    cpu: stats.cpu,
    bytes,
    cake: new Map(cake.map((c) => [c.dev, c.bytes])),
    stations: new Map(clients.map((c) => [c.mac, { tx: c.txBytes, rx: c.rxBytes }])),
  };

  const wanDev = wan?.l3_device ?? wan?.device;
  const memory = memoryInUse(info.memory) / info.memory.total;
  const sample: Sample = {
    t: r.t,
    cpu,
    memory,
    // The router's WAN rx is the household's download.
    wanDown: rateOf(wanDev, 'rx'),
    wanUp: rateOf(wanDev, 'tx'),
    // An access point's tx is what clients download.
    wifiDown: sum(live.map((ap) => rateOf(ap.ifname, 'tx'))),
    wifiUp: sum(live.map((ap) => rateOf(ap.ifname, 'rx'))),
    devices: clients.length + (wired ?? 0),
  };
  const history = [...carry.history, sample].slice(-HISTORY);

  return {
    dashboard: { board, info, stats, cpu, cores, wan, wan6, lan, radios, clients, wired, ports, cake, history },
    carry: { counters, history, generations: seen },
  };
}
