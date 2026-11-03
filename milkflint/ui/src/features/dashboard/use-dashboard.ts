// Everything the dashboard shows, fetched every POLL_MS in two batched
// requests, with a rolling history for the charts. Rates and CPU use come
// from the difference between two samples.
import { useRef } from 'react';
import { usePoll } from '@/hooks/use-poll';
import {
  getDevices,
  getHostHints,
  getInterfaces,
  getLeases,
  globalIpv6,
  hintName,
  isPrivateMac,
  type NetworkInterface,
} from '@/lib/api/network';
import { getSqmStatus, getStats, type Stats } from '@/lib/api/stats';
import { getBoard, getInfo, type Board, type SystemInfo } from '@/lib/api/system';
import { getConfig, list, str } from '@/lib/api/uci';
import { bandOf, describeRate, generationOf, getAccessPoints, getWirelessStatus } from '@/lib/api/wireless';
import { directionsOf, type DirectionSummary, summarize } from '../sqm/cake';

export const POLL_MS = 2000;
export const HISTORY = 60; // samples: 2 minutes

export interface Sample {
  /** When it was taken, epoch seconds (this browser's clock). */
  t: number;
  cpu: number | undefined;
  memory: number;
  wanDown: number | undefined;
  wanUp: number | undefined;
  wifiDown: number | undefined;
  wifiUp: number | undefined;
}

export interface Radio {
  name: string;
  /** phy0, …: what its temperature sensor is under */
  phy: string | undefined;
  up: boolean;
  band: string | undefined;
  channel: number | undefined;
  htmode: string | undefined;
  txpower: number | undefined;
  noise: number | undefined;
  ssids: string[];
  clients: number;
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
  /** Link rates in bit/s, as negotiated (not traffic). */
  rxRate: number | undefined;
  txRate: number | undefined;
  rxDescription: string | undefined;
  txDescription: string | undefined;
  /** Bytes since it joined: to it and from it. */
  txBytes: number | undefined;
  rxBytes: number | undefined;
  connectedSeconds: number | undefined;
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
}

function cpuUse(prev: Stats['cpu'][number] | undefined, cur: Stats['cpu'][number]): number | undefined {
  if (prev === undefined) return undefined;
  const total = cur.total - prev.total;
  const idle = cur.idle - prev.idle;
  return total > 0 ? Math.max(0, Math.min(1, 1 - idle / total)) : undefined;
}

function rate(prev: number | undefined, cur: number | undefined, seconds: number): number | undefined {
  if (prev === undefined || cur === undefined || seconds <= 0 || cur < prev) return undefined;
  return ((cur - prev) * 8) / seconds;
}

function sum(values: readonly (number | undefined)[]): number | undefined {
  let total = 0;
  for (const v of values) {
    if (v === undefined) return undefined;
    total += v;
  }
  return total;
}

export function useDashboard(): ReturnType<typeof usePoll<Dashboard>> {
  const counters = useRef<Counters | undefined>(undefined);
  const history = useRef<Sample[]>([]);
  // The newest generation each client has used: a quiet one's rates fall back to older ones.
  const generations = useRef(new Map<string, number>());

  return usePoll(async (): Promise<Dashboard> => {
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
    const now = performance.now();

    // Access points with their live details (a second batched request).
    const live = await getAccessPoints(wireless);

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
        band: bandOf(iw?.frequency) ?? bandName(r.config?.band),
        channel: iw?.channel,
        htmode: iw?.htmode ?? r.config?.htmode,
        txpower: iw?.txpower,
        noise: iw?.noise,
        ssids: mine.flatMap((l) => (l.ssid !== undefined ? [l.ssid] : [])),
        clients: mine.reduce((n, l) => n + l.stations.length, 0),
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
        const name = str(host, 'name') ?? lease?.hostname ?? hintName(hint);
        const generation = [generationOf(s.rx), generationOf(s.tx), generations.current.get(mac)].reduce<number | undefined>(
          (a, b) => (b === undefined ? a : Math.max(a ?? 0, b)),
          undefined,
        );
        if (generation !== undefined) seen.set(mac, generation);
        return {
          mac,
          name,
          nameFrom:
            name === undefined ? undefined : str(host, 'name') !== undefined ? 'you' : lease?.hostname !== undefined ? 'device' : 'router',
          privateMac: isPrivateMac(mac),
          generation,
          ip: lease?.ipaddr ?? hint?.ipaddrs?.[0] ?? str(host, 'ip'),
          reservedIp: str(host, 'ip'),
          ipv6: globalIpv6(hint?.ip6addrs),
          band: bandOf(l.info?.frequency),
          ssid: l.ssid,
          signal: s.signal_avg ?? s.signal,
          rxRate: s.rx?.rate === undefined ? undefined : s.rx.rate * 1000,
          txRate: s.tx?.rate === undefined ? undefined : s.tx.rate * 1000,
          rxDescription: describeRate(s.rx),
          txDescription: describeRate(s.tx),
          txBytes: s.tx?.bytes,
          rxBytes: s.rx?.bytes,
          connectedSeconds: s.connected_time,
        };
      }),
    );
    generations.current = seen;
    clients.sort((a, b) => (b.signal ?? -200) - (a.signal ?? -200));

    const wan = interfaces.find((i) => i.interface === 'wan');
    const wan6 = interfaces.find((i) => i.interface === 'wan6');
    const lan = interfaces.find((i) => i.interface === 'lan');

    // Rates since the previous sample.
    const prev = counters.current;
    const seconds = prev === undefined ? 0 : (now - prev.at) / 1000;
    const bytes = new Map(
      Object.entries(devices).flatMap(([dev, d]) =>
        d.statistics === undefined ? [] : [[dev, { rx: d.statistics.rx_bytes, tx: d.statistics.tx_bytes }] as const],
      ),
    );
    const rateOf = (dev: string | undefined, dir: 'rx' | 'tx'): number | undefined =>
      dev === undefined ? undefined : rate(prev?.bytes.get(dev)?.[dir], bytes.get(dev)?.[dir], seconds);

    const cpuPrev = new Map(prev?.cpu.map((c) => [c.name, c]));
    const overall = stats.cpu.find((c) => c.name === 'cpu');
    const cpu = overall === undefined ? undefined : cpuUse(cpuPrev.get('cpu'), overall);
    const cores = stats.cpu
      .filter((c) => c.name !== 'cpu')
      .map((c) => cpuUse(cpuPrev.get(c.name), c) ?? 0);
    const cake = directionsOf(sqm?.qdiscs ?? []).map((d): CakeDirection => {
      const summary = summarize(d);
      return { ...summary, dev: d.dev, download: d.download, rate: rate(prev?.cake.get(d.dev), summary.bytes, seconds) };
    });
    counters.current = { at: now, cpu: stats.cpu, bytes, cake: new Map(cake.map((c) => [c.dev, c.bytes])) };

    const wanDev = wan?.l3_device ?? wan?.device;
    const memory = 1 - (info.memory.available ?? info.memory.free + info.memory.buffered) / info.memory.total;
    const sample: Sample = {
      t: Date.now() / 1000,
      cpu,
      memory,
      // The router's WAN rx is the household's download.
      wanDown: rateOf(wanDev, 'rx'),
      wanUp: rateOf(wanDev, 'tx'),
      // An access point's tx is what clients download.
      wifiDown: sum(live.map((ap) => rateOf(ap.ifname, 'tx'))),
      wifiUp: sum(live.map((ap) => rateOf(ap.ifname, 'rx'))),
    };
    history.current = [...history.current, sample].slice(-HISTORY);

    return { board, info, stats, cpu, cores, wan, wan6, lan, radios, clients, cake, history: history.current };
  }, POLL_MS);
}
