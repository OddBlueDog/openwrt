// What Home's widgets are drawn from, for the browser tests: Home's own poll
// (a Dashboard) and Network Quality's pings, for three routers. Made up, but
// shaped like real routers' answers, at their awkward ends:
//   busy:  every feature on, both bands up with three networks each, eight
//          devices with long names, five sensors, Smart Queue shaping;
//   quiet: the internet down, 2.4 GHz off, nothing connected, no sensors,
//          Smart Queue and Network Quality off;
//   ap:    an access point behind a main router.
// The widgets that read the router themselves get theirs from router.ts.
import type { Live } from '@/features/network-quality/live';
import type { Live as Polled } from '@/lib/query/use-live';
import type { Client, Dashboard, Radio, Sample } from '@/features/dashboard/use-dashboard';
import type { Port } from '@/features/dashboard/ports';
import { HISTORY, POLL_MS } from '@/features/dashboard/use-dashboard';

export type Scenario = 'busy' | 'quiet' | 'ap';
export const SCENARIOS: readonly Scenario[] = ['busy', 'quiet', 'ap'];

/** The fixtures' "now", epoch seconds: a Tuesday afternoon. */
export const NOW = 1_794_929_400;

/** A steady wobble for made-up figures, so the same test always draws the same thing. */
const wave = (i: number, period: number, low: number, high: number): number =>
  low + ((Math.sin((i / period) * Math.PI * 2) + 1) / 2) * (high - low);

function history(busy: boolean): Sample[] {
  return Array.from({ length: HISTORY }, (_, i) => ({
    t: NOW - (HISTORY - 1 - i) * (POLL_MS / 1000),
    cpu: busy ? wave(i, 17, 0.04, 0.38) : 0.01,
    memory: 0.31,
    wanDown: busy ? wave(i, 11, 2e6, 640e6) : 0,
    wanUp: busy ? wave(i, 13, 3e5, 62e6) : 0,
    wifiDown: busy ? wave(i, 9, 1e6, 480e6) : 0,
    wifiUp: busy ? wave(i, 7, 2e5, 40e6) : 0,
    devices: busy ? 10 : 0,
  }));
}

const radio = (r: Partial<Radio> & Pick<Radio, 'name' | 'band'>): Radio => ({
  phy: undefined,
  up: true,
  off: false,
  channel: undefined,
  htmode: undefined,
  txpower: undefined,
  noise: undefined,
  ssids: [],
  clients: 0,
  rateDown: undefined,
  rateUp: undefined,
  ...r,
});

const NAMES = [
  'lounge-apple-tv-4k',
  'Sam’s MacBook Pro (16-inch, 2024)',
  undefined,
  'DESKTOP-7Q2LX9K',
  'Samsung-Galaxy-S24-Ultra-of-Alex',
  'kitchen-echo-show-8',
  'iPad-Air-11-inch',
  'PlayStation-5-Digital-Edition',
] as const;

function clients(count: number): Client[] {
  return NAMES.slice(0, count).map((name, i) => ({
    mac: `5c:e9:1e:00:0${String(i)}:a${String(i)}`,
    name,
    nameFrom: name === undefined ? undefined : i % 2 === 0 ? 'device' : 'you',
    privateMac: name === undefined,
    generation: [6, 7, 5, 6][i % 4],
    ip: `192.168.1.${String(100 + i * 17)}`,
    reservedIp: i === 1 ? '192.168.1.117' : undefined,
    ipv6: i === 0 ? ['2001:db8:a1b2:3c00:1c4f:9e2a:77d0:4b11'] : [],
    band: i % 3 === 2 ? '2.4 GHz' : '5 GHz',
    ssid: i % 3 === 2 ? 'Brightwater' : 'Brightwater_5ghz',
    signal: -42 - i * 6,
    snr: 50 - i * 5,
    rxRate: 1_200_000_000 - i * 120_000_000,
    txRate: 2_401_000_000 - i * 260_000_000,
    rxDescription: 'HE-MCS 11, 80 MHz, 2 streams',
    txDescription: 'HE-MCS 11, 80 MHz, 2 streams',
    txBytes: 48_000_000_000 / (i + 1),
    rxBytes: 3_200_000_000 / (i + 1),
    connectedSeconds: 900_000 - i * 97_000,
    down: 412_000_000 / (i + 1) ** 2,
    up: 31_000_000 / (i + 1) ** 2,
  }));
}

const sensors = [
  { name: 'cpu-thermal', celsius: 61 },
  { name: 'mt7530-phy-eth1', celsius: 52, port: 'eth1' },
  { name: 'mt7530-phy-lan1', celsius: 50, port: 'lan1' },
  { name: 'mt7915-phy0', celsius: 96, wiphy: 'phy0' },
  { name: 'mt7915-phy1', celsius: 79, wiphy: 'phy1' },
];

const board: Dashboard['board'] = {
  hostname: 'MilkFlint',
  model: 'GL.iNet GL-MT6000',
  board_name: 'glinet,gl-mt6000',
  kernel: '6.12.115',
  system: 'ARMv8 Processor rev 4',
  release: {
    distribution: 'MilkFlint',
    version: '0.82a (OpenWrt 25.12.6)',
    revision: 'r33311-981c978eff',
    description: 'OpenWrt 25.12.6 r33311-981c978eff',
  },
};

function info(busy: boolean): Dashboard['info'] {
  return {
    localtime: NOW,
    uptime: busy ? 3_456_789 : 412,
    load: busy ? [27_525, 21_627, 17_039] : [0, 655, 1310],
    memory: {
      total: 1_003_442_176,
      free: 512_001_024,
      shared: 1_212_416,
      buffered: 21_495_808,
      available: 640_434_176,
      cached: 198_234_112,
    },
    root: { total: 7_290_548, free: 7_087_392, used: 203_156, avail: 7_087_392 },
  };
}

const lanIface: NonNullable<Dashboard['lan']> = {
  interface: 'lan',
  up: true,
  uptime: 3_456_700,
  proto: 'static',
  device: 'br-lan',
  l3_device: 'br-lan',
  'ipv4-address': [{ address: '192.168.1.1', mask: 24 }],
  route: [],
};

/** The Flint 2's six ports: the WAN port, then lan1-lan5 (lan5 and the WAN port 2.5 Gbit/s). */
function ports(s: Scenario): Port[] {
  const busy = s === 'busy';
  const port = (device: string, label: string, over: Partial<Port>): Port => ({
    device,
    label,
    wan: device === 'eth1',
    link: false,
    mbit: undefined,
    half: false,
    maxMbit: device === 'eth1' || device === 'lan5' ? 2500 : 1000,
    networks: [device === 'eth1' ? 'Internet' : 'LAN'],
    down: undefined,
    up: undefined,
    mac: undefined,
    partnerMbit: undefined,
    totalDown: undefined,
    totalUp: undefined,
    errors: undefined,
    dropped: undefined,
    ...over,
  });
  return [
    port('eth1', 'WAN', {
      link: true,
      mbit: 1000,
      networks: s === 'ap' ? ['LAN'] : ['Internet'],
      down: busy ? 312_400_000 : 0,
      up: busy ? 21_300_000 : 0,
    }),
    port('lan1', 'LAN 1', busy || s === 'ap' ? { link: true, mbit: 1000, down: busy ? 98_000_000 : 1_200, up: 4_100_000 } : {}),
    port('lan2', 'LAN 2', busy ? { link: true, mbit: 100, half: true, down: 3_000, up: 1_000 } : {}),
    port('lan3', 'LAN 3', busy ? { networks: ['guest'] } : {}),
    port('lan4', 'LAN 4', busy ? { networks: [] } : {}),
    port('lan5', 'LAN 5', busy ? { link: true, mbit: 2500, down: 1_234_000_000, up: 456_000_000 } : {}),
  ];
}

/** Home's poll, as useDashboard makes it. */
export function dashboard(s: Scenario): Dashboard {
  const busy = s === 'busy';
  const ap = s === 'ap';
  const list = busy ? clients(8) : ap ? clients(3) : [];
  return {
    board,
    info: info(busy),
    stats: {
      cpu: [{ name: 'cpu', total: 9_000_000, idle: 8_100_000 }],
      temperatures: s === 'quiet' ? [] : sensors,
      conntrack: { count: busy ? 2_695 : 12, max: 65_536 },
    },
    cpu: busy ? 0.23 : 0.01,
    cores: busy ? [0.31, 0.92, 0.12, 0.08] : [0.01, 0.01, 0.0, 0.02],
    wan: ap
      ? undefined
      : {
          interface: 'wan',
          up: busy,
          uptime: busy ? 1_234_567 : undefined,
          proto: s === 'quiet' ? 'pppoe' : 'dhcp',
          device: 'eth1',
          l3_device: 'eth1',
          'ipv4-address': busy ? [{ address: '203.0.113.47', mask: 24 }] : [],
          route: busy ? [{ target: '0.0.0.0', mask: 0, nexthop: '203.0.113.1' }] : [],
          'dns-server': busy ? ['198.51.100.53', '198.51.100.54'] : [],
        },
    wan6: busy
      ? {
          interface: 'wan6',
          up: true,
          proto: 'dhcpv6',
          'ipv6-address': [{ address: '2001:db8:a1b2:3c00:4d1e:88ff:fe21:93c0', mask: 128 }],
          'ipv6-prefix': [{ address: '2001:db8:a1b2:3c00::', mask: 56 }],
        }
      : undefined,
    lan: ap ? { ...lanIface, proto: 'dhcp', route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.0.1' }] } : lanIface,
    radios: [
      busy
        ? radio({
            name: 'radio0',
            phy: 'phy0',
            band: '2.4 GHz',
            channel: 6,
            htmode: 'HE20',
            txpower: 20,
            noise: -95,
            ssids: ['Brightwater', 'brightwater-visitors', 'kids-wifi'],
            clients: 3,
            rateDown: 4_100_000,
            rateUp: 900_000,
          })
        : radio({ name: 'radio0', phy: 'phy0', band: '2.4 GHz', off: true }),
      radio({
        name: 'radio1',
        phy: 'phy1',
        band: '5 GHz',
        channel: 100,
        htmode: 'HE80',
        txpower: 23,
        noise: -92,
        ssids: busy ? ['Brightwater_5ghz', 'brightwater-visitors', 'kids-wifi'] : ['Brightwater_5ghz'],
        clients: busy ? 5 : ap ? 3 : 0,
        rateDown: busy ? 412_000_000 : 0,
        rateUp: busy ? 31_000_000 : 0,
      }),
    ],
    clients: list,
    wired: busy ? 2 : ap ? 1 : 0,
    ports: ports(s),
    cake: busy
      ? [
          {
            dev: 'ifb4eth1',
            download: true,
            rate: 312_000_000,
            bandwidth: 500_000_000,
            bytes: 9e12,
            avgDelayUs: 1_240,
            peakDelayUs: 18_400,
            drops: 1_234_567,
            ecnMarks: 89_012,
            flows: 143,
          },
          {
            dev: 'eth1',
            download: false,
            rate: 21_000_000,
            bandwidth: 50_000_000,
            bytes: 6e11,
            avgDelayUs: 860,
            peakDelayUs: 9_300,
            drops: 45_678,
            ecnMarks: 1_234,
            flows: 61,
          },
        ]
      : [],
    history: history(busy),
  };
}

/** Network Quality's pings over the last hour, as Home polls them. */
export function live(s: Scenario): Polled<Live> {
  const on = s !== 'quiet';
  const samples = on
    ? Array.from({ length: 720 }, (_, i) => {
        const lost = i % 97 === 0;
        return {
          t: NOW - (719 - i) * 5,
          gateway: lost ? null : wave(i, 41, 0.4, 2.1),
          internet: lost ? null : wave(i, 29, 8, i % 53 === 0 ? 180 : 24),
          dns: wave(i, 37, 3, 19),
        };
      })
    : [];
  const status = {
    enabled: on,
    now: NOW,
    interval: on ? 5 : null,
    targets: on ? { gateway: '203.0.113.1', internet: '1.1.1.1', dns_server: '1.1.1.1', dns_domain: 'openwrt.org' } : null,
    gateway_answers: on,
    samples: [],
  };
  return { data: { status, samples }, error: undefined, loading: false, refresh: () => undefined };
}
