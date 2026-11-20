// A pretend router for the browser tests: the raw ubus answers a real one
// gives the widgets that read it themselves (Guest Wi-Fi, banIP, AdGuard
// Home, VPN, Remote access, Scheduled tasks, Data usage, the sensors'
// history), for the scenarios in fixtures.ts. home-fit.test.tsx puts
// `answer` in place of lib/ubus.ts's call, so each answer still goes through
// the page's own schema and loader: one that drifts from them fails the test.
// A call it has no answer for fails as on a router without that method.
import { NOW, type Scenario } from './fixtures';

type Options = Readonly<Record<string, string | readonly string[]>>;

/** A uci config as `uci get` gives it: sections by name, in order. */
function uci(sections: readonly (readonly [string, string, Options])[]): { values: Record<string, unknown> } {
  return {
    values: Object.fromEntries(
      sections.map(([name, type, options], i) => [
        name,
        { '.anonymous': false, '.type': type, '.name': name, '.index': i, ...options },
      ]),
    ),
  };
}

const GUESTS = [
  { id: 'guest', label: 'Visitors', ssid: 'brightwater-visitors', key: 'lemon-tree-42', subnet: 9 },
  { id: 'guest2', label: 'Kids', ssid: 'kids-wifi', key: 'K7#pQ2!vLm9', subnet: 10 },
  { id: 'guest3', label: 'Attic workshop and garden office', ssid: 'attic-and-garden-office-wifi', key: 'x', subnet: 11 },
] as const;

const PEERS = [
  { key: 'pTq1Y2l8wK0cB3vX9mN4rS6tU7vW8xY9zA0bC1dE2fG=', name: 'Sam’s iPhone 15 Pro Max', handshake: NOW - 45 },
  { key: 'hJ3kL5mN7pQ9rS1tU3vW5xY7zA9bC1dE3fG5hJ7kL9m=', name: 'Work laptop', handshake: NOW - 3_600 },
  { key: 'aB2cD4eF6gH8iJ0kL2mN4oP6qR8sT0uV2wX4yZ6aB8c=', name: 'Alex’s Pixel', handshake: 0 },
];

/** Device control's people on the busy router: Sam off on school nights, and Alex (a long name) paused for half an hour. */
export const SAM = { id: 'devctl_s4m0', devices: ['aa:00:00:00:00:01', 'aa:00:00:00:00:02'] } as const;
export const ALEX = { id: 'devctl_a1ex', devices: ['aa:00:00:00:00:03'] } as const;

function milkflint(s: Scenario): unknown {
  return uci([
    ['mode', 'mode', { mode: s === 'ap' ? 'ap' : 'router' }],
    ['datastats', 'datastats', { enabled: s === 'quiet' ? '0' : '1' }],
    ...(s === 'busy' ? [...GUESTS.map((g) => [g.id, 'guest_network', { label: g.label }] as const)] : []),
    ...(s === 'busy'
      ? ([
          [SAM.id, 'person', { name: 'Sam', device: [...SAM.devices] }],
          [ALEX.id, 'person', { name: 'Alexandra-Margaret Kensington', device: [...ALEX.devices], safesearch: '1' }],
        ] as const)
      : []),
  ]);
}

/** Sam's school nights as Device control writes them, and the sections everyone shares. */
function devctlRules(): (readonly [string, string, Options])[] {
  const person = { src: '*', dest: 'wan', src_mac: [...SAM.devices], ipset: '!devctl_extra', proto: 'all', target: 'REJECT' };
  const set = (name: string): readonly [string, string, Options] => [
    name,
    'ipset',
    { name, family: 'any', match: ['src_mac'], timeout: '0' },
  ];
  return [
    set('devctl_paused'),
    set('devctl_extra'),
    [
      'devctl_pause',
      'rule',
      { name: 'Device control: paused', src: '*', dest: 'wan', ipset: 'devctl_paused', proto: 'all', target: 'REJECT' },
    ],
    ['devctl_restore', 'include', { type: 'script', path: '/usr/libexec/milkflint/device-control-restore', fw4_compatible: '1' }],
    [
      `${SAM.id}_w1`,
      'rule',
      { ...person, name: 'Sam: School nights', start_time: '21:00:00', stop_time: '23:59:59', weekdays: 'Mon Tue Wed Thu Sun' },
    ],
    [
      `${SAM.id}_w1_am`,
      'rule',
      {
        ...person,
        name: 'Sam: School nights (morning)',
        start_time: '00:00:00',
        stop_time: '07:00:00',
        weekdays: 'Mon Tue Wed Thu Fri',
      },
    ],
  ];
}

/** milkflint.devicecontrol's status: Alex paused for half an hour from NOW. */
function deviceControl(s: Scenario): unknown {
  return {
    now: NOW,
    offset: 0,
    paused: s === 'busy' ? { [ALEX.devices[0]]: NOW + 1800 } : {},
    extra: {},
    ready: s === 'busy',
    today:
      s === 'busy'
        ? { since: NOW - 55_800, midnight: NOW - 55_800, devices: { [SAM.devices[0]]: [812_000_000, 40_000_000] } }
        : null,
    seen: { [SAM.devices[1]]: 7_200 },
    clock: { ntp: true, synced: true, stratum: 2, at: NOW - 600, uptime: 90_000 },
    adguard: { installed: true, enabled: false, state: null },
  };
}

/** root's crontab: in the busy scenario a restart twice a week, Wi-Fi off at night, a check every few minutes and banIP's update. */
function crontab(s: Scenario): string {
  return s === 'busy'
    ? [
        '0 4 * * 1,4 /sbin/reboot',
        '30 23 * * * /sbin/wifi down',
        '*/5 * * * * /root/check-the-backup-drive-is-still-mounted.sh > /dev/null 2>&1',
        '# milkflint-banip begin (managed by the web interface)',
        '34 3,15 * * * /usr/libexec/milkflint/banip-action reload',
        '# milkflint-banip end',
        '',
      ].join('\n')
    : '';
}

function network(s: Scenario): unknown {
  return uci([
    ['lan', 'interface', { device: 'br-lan', proto: s === 'ap' ? 'dhcp' : 'static', ipaddr: '192.168.1.1/24' }],
    ...(s === 'ap' ? [] : [['wan', 'interface', { device: 'eth1', proto: 'dhcp' }] as const]),
    ...(s === 'busy'
      ? [
          ...GUESTS.flatMap((g) => [
            [`${g.id}_dev`, 'device', { type: 'bridge', name: `br-${g.id}` }] as const,
            [g.id, 'interface', { device: `br-${g.id}`, proto: 'static', ipaddr: `192.168.${String(g.subnet)}.1/24` }] as const,
          ]),
          ['wg_in', 'interface', { proto: 'wireguard', listen_port: '51820' }] as const,
          ...PEERS.map((p, i) => [`peer${String(i)}`, 'wireguard_wg_in', { public_key: p.key, description: p.name }] as const),
        ]
      : []),
  ]);
}

function wireless(s: Scenario): unknown {
  const guestAps =
    s === 'busy'
      ? GUESTS.map(
          (g, i) =>
            [
              `guest_ap${String(i)}`,
              'wifi-iface',
              { device: 'radio1', mode: 'ap', network: [g.id], ssid: g.ssid, encryption: 'sae-mixed', key: g.key, isolate: '1' },
            ] as const,
        )
      : [];
  return uci([
    ['radio0', 'wifi-device', { type: 'mac80211', band: '2g', channel: '6' }],
    [
      'default_radio0',
      'wifi-iface',
      {
        device: 'radio0',
        mode: 'ap',
        network: ['lan'],
        ssid: 'Brightwater',
        encryption: 'sae-mixed',
        key: 'secret-home-key',
        ...(s === 'busy' ? {} : { disabled: '1' }),
      },
    ],
    ['radio1', 'wifi-device', { type: 'mac80211', band: '5g', channel: '100' }],
    [
      'default_radio1',
      'wifi-iface',
      {
        device: 'radio1',
        mode: 'ap',
        network: ['lan'],
        ssid: 'Brightwater_5ghz',
        encryption: 'sae-mixed',
        key: 'secret-home-key',
      },
    ],
    ...guestAps,
  ]);
}

function firewall(s: Scenario): unknown {
  return uci([
    ['lan_zone', 'zone', { name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' }],
    [
      'wan_zone',
      'zone',
      { name: 'wan', network: ['wan', 'wan6'], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT', masq: '1' },
    ],
    ['lan_wan', 'forwarding', { src: 'lan', dest: 'wan' }],
    ...(s === 'busy'
      ? GUESTS.flatMap((g) => [
          [
            `${g.id}_zone`,
            'zone',
            { name: g.id, network: [g.id], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' },
          ] as const,
          [`${g.id}_wan`, 'forwarding', { src: g.id, dest: 'wan' }] as const,
        ])
      : []),
    ...(s === 'busy' ? devctlRules() : []),
  ]);
}

function dhcp(s: Scenario): unknown {
  return uci([
    ['lan', 'dhcp', { interface: 'lan', start: '100', limit: '150', leasetime: '12h' }],
    ['tv', 'host', { name: 'lounge-apple-tv-4k', mac: ['5c:e9:1e:00:00:a0'], ip: '192.168.1.100' }],
    ...(s === 'busy'
      ? GUESTS.map((g) => [g.id, 'dhcp', { interface: g.id, start: '100', limit: '150', leasetime: '1h' }] as const)
      : []),
  ]);
}

function interfaces(s: Scenario): unknown {
  const up = (name: string, address: string, proto = 'static'): unknown => ({
    interface: name,
    up: true,
    proto,
    'ipv4-address': [{ address, mask: 24 }],
  });
  return {
    interface: [
      up('lan', '192.168.1.1', s === 'ap' ? 'dhcp' : 'static'),
      ...(s === 'busy'
        ? [
            { interface: 'wan', up: true, proto: 'dhcp', 'ipv4-address': [{ address: '203.0.113.47', mask: 24 }] },
            ...GUESTS.map((g) => up(g.id, `192.168.${String(g.subnet)}.1`)),
          ]
        : []),
    ],
  };
}

function wirelessDevices(s: Scenario): unknown {
  const iface = (section: string, ifname: string, ssid: string, net: string): unknown => ({
    section,
    ifname,
    config: { mode: 'ap', ssid, network: [net] },
  });
  return {
    radio0: {
      up: true,
      disabled: false,
      config: { band: '2g', channel: '6' },
      interfaces: s === 'busy' ? [iface('default_radio0', 'phy0-ap0', 'Brightwater', 'lan')] : [],
    },
    radio1: {
      up: true,
      disabled: false,
      config: { band: '5g', channel: '100' },
      interfaces: [
        iface('default_radio1', 'phy1-ap0', 'Brightwater_5ghz', 'lan'),
        ...(s === 'busy' ? GUESTS.map((g, i) => iface(`guest_ap${String(i)}`, `phy1-ap${String(i + 1)}`, g.ssid, g.id)) : []),
      ],
    },
  };
}

/** Devices on an access point (only the busy router's first two guest networks have any). */
function stations(s: Scenario, device: unknown): unknown {
  const n = s === 'busy' ? (({ 'phy1-ap1': 2, 'phy1-ap2': 1 } as Record<string, number>)[String(device)] ?? 0) : 0;
  return {
    results: Array.from({ length: n }, (_, i) => ({
      mac: `aa:bb:cc:00:0${String(i)}:0${String(n)}`,
      signal: -55 - i * 7,
      noise: -92,
      connected_time: 3_600 + i * 100,
      authorized: true,
      rx: { bytes: 1e8, packets: 1e5, rate: 576_000, mhz: 80, nss: 2 },
      tx: { bytes: 4e8, packets: 3e5, rate: 1_200_900, mhz: 80, nss: 2 },
    })),
  };
}

function usage(s: Scenario): unknown {
  if (s !== 'busy') return { columns: ['mac', 'ip', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts'], data: [] };
  return {
    columns: ['mac', 'ip', 'conns', 'rx_bytes', 'rx_pkts', 'tx_bytes', 'tx_pkts'],
    data: Array.from({ length: 8 }, (_, i) => [
      `5c:e9:1e:00:0${String(i)}:a${String(i)}`,
      `192.168.1.${String(100 + i * 17)}`,
      9_000 - i * 900,
      Math.round(612_000_000_000 / (i + 1) ** 1.5),
      400_000_000,
      Math.round(41_000_000_000 / (i + 1) ** 1.5),
      90_000_000,
    ]),
  };
}

function banip(s: Scenario): unknown {
  if (s === 'ap') return { installed: true, enabled: false, mode: 'ap', state: 'ap' };
  if (s === 'quiet') return { installed: true, enabled: false, mode: 'router', state: 'off' };
  const slots = Array.from({ length: 12 }, (_, i) => 40 + ((i * 37) % 160));
  return {
    installed: true,
    version: '1.9.1-r5',
    enabled: true,
    mode: 'router',
    state: 'protecting',
    table: true,
    elements: 187_432,
    drops: {
      step: 300,
      end: NOW - 300,
      counted: slots,
      logged: slots.map((n) => n - 10),
      flood: slots.map(() => 0),
      hour: 1_834,
      day: 40_321,
      source: 'counters',
    },
    now: NOW,
  };
}

function adguard(s: Scenario): unknown {
  if (s === 'ap') return { installed: true, enabled: false, mode: 'ap' };
  if (s === 'quiet') return { installed: true, enabled: false, mode: 'router', state: 'off' };
  return {
    installed: true,
    enabled: true,
    configured: true,
    mode: 'router',
    running: true,
    state: 'active',
    stats: { queries: 148_213, blocked: 29_934, hours: 24, avg_ms: 12.4 },
  };
}

function vpn(s: Scenario): unknown {
  if (s !== 'busy') return { installed: true, now: NOW, interfaces: [] };
  return {
    installed: true,
    now: NOW,
    interfaces: [
      {
        name: 'wg_out',
        public_key: 'Zx8cV7bN6mQ5wE4rT3yU2iO1pA0sD9fG8hJ7kL6zX5c=',
        listen_port: null,
        fwmark: '0x200',
        peers: [
          {
            public_key: 'pIa0uK1vPn2sErVeR3kEy4fOr5tEsTs6aBcDeFgHiJk=',
            endpoint: '198.51.100.10:1337',
            allowed_ips: ['0.0.0.0/0', '::/0'],
            latest_handshake: NOW - 38,
            rx_bytes: 912_345_678_901,
            tx_bytes: 45_678_901_234,
            keepalive: 25,
          },
        ],
      },
      {
        name: 'wg_in',
        public_key: 'Bnh2O2q4FUNSl9D2IYv6PyLUeGBkxLdFKrh7Z0loFhg=',
        listen_port: 51_820,
        fwmark: null,
        peers: PEERS.map((p) => ({
          public_key: p.key,
          endpoint: p.handshake === 0 ? null : '203.0.113.86:51820',
          allowed_ips: ['10.7.0.2/32'],
          latest_handshake: p.handshake,
          rx_bytes: 12_345_678,
          tx_bytes: 98_765_432,
          keepalive: null,
        })),
      },
    ],
  };
}

function sensorHistory(s: Scenario): unknown {
  if (s === 'quiet') return { now: NOW, interval: null, samples: [] };
  const names = ['cpu-thermal', 'mt7530-phy-eth1', 'mt7530-phy-lan1', 'mt7915-phy0', 'mt7915-phy1'];
  return {
    now: NOW,
    interval: 10,
    samples: Array.from({ length: 360 }, (_, i) => ({
      t: NOW - (359 - i) * 10,
      c: Object.fromEntries(names.map((n, k) => [n, 48 + k * 9 + Math.sin(i / (7 + k)) * 3])),
    })),
  };
}

/** The theme the pretend router keeps (System → Themes); the tests set it through the page's own setThemeId. */
let themeSettings: { theme: string; custom: unknown[] } = { theme: '', custom: [] };

/** What the router answers; undefined where it has no such method (the caller fails as `call` does). */
export function answer(s: Scenario, object: string, method: string, params: Record<string, unknown>): unknown {
  switch (`${object} ${method}`) {
    case 'milkflint.themes get':
      return themeSettings;
    case 'milkflint.themes set':
      themeSettings = { theme: typeof params['theme'] === 'string' ? params['theme'] : '', custom: [] };
      return { saved: true };
    case 'uci get': {
      const config = params['config'];
      if (config === 'milkflint') return milkflint(s);
      if (config === 'network') return network(s);
      if (config === 'wireless') return wireless(s);
      if (config === 'firewall') return firewall(s);
      if (config === 'dhcp') return dhcp(s);
      if (config === 'sqm' && s === 'busy')
        return uci([['eth1', 'queue', { enabled: '1', interface: 'eth1', download: '500000', upload: '50000' }]]);
      return undefined;
    }
    case 'file read':
      return params['path'] === '/etc/crontabs/root' ? { data: crontab(s) } : undefined;
    case 'network.interface dump':
      return interfaces(s);
    case 'luci-rpc getWirelessDevices':
      return wirelessDevices(s);
    case 'iwinfo assoclist':
      return stations(s, params['device']);
    case 'luci-rpc getDHCPLeases':
      return { dhcp_leases: [], dhcp6_leases: [] };
    case 'luci-rpc getHostHints':
      return {};
    case 'milkflint.traffic periods':
      return s === 'busy'
        ? { installed: true, enabled: true, periods: ['2026-11-01'] }
        : { installed: true, enabled: false, periods: [] };
    case 'milkflint.traffic usage':
      return usage(s);
    case 'milkflint.banip status':
      return banip(s);
    case 'milkflint.adguardhome status':
      return adguard(s);
    case 'milkflint.vpn status':
      return vpn(s);
    case 'milkflint.sensors history':
      return sensorHistory(s);
    case 'milkflint.devicecontrol status':
      return deviceControl(s);
    case 'milkflint neighbors':
      return { neighbors: [] };
    default:
      return undefined;
  }
}
