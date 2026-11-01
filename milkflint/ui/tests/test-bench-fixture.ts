// A made-up finished run for the report's tests: two devices (a Mac on
// Wi-Fi, a PC on a wire whose firewall doesn't answer pings), an idle
// phase, a download the Mac makes through Smart Queue, and a DNS phase;
// the router's pings, its samples each second and its DNS lookups. Each
// part goes through the parser the router's would.
import type { Phase, StoredRun } from '../src/features/test-bench/api.ts';
import { parseProbes, parseRouter } from '../src/features/test-bench/analysis.ts';
import { parseDns } from '../src/features/test-bench/dns-pages.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import type { RunData } from '../src/features/test-bench/run-data.ts';

export const T0 = 100_000;

export interface FixtureOptions {
  dry?: boolean;
  sqm?: boolean;
  offloading?: boolean;
  /** the busiest core's busy share under load, and seconds (from the start) it's at 0.97 instead */
  cpuLoad?: number;
  pegged?: readonly number[];
  softnetDrops?: number;
  /** the Mac's page was hidden a while */
  hidden?: boolean;
  /** the PC sent nothing */
  pcSentNothing?: boolean;
  /** the PC joined over a global IPv6 address, and the Mac's browser wrote one into an error */
  publicAddresses?: boolean;
}

export const phases: Phase[] = [
  { kind: 'idle', start: 0, dur: 10_000, roles: {}, label: 'Idle' },
  { kind: 'wan_down', start: 10_000, dur: 10_000, roles: { m1: 'down' } },
  { kind: 'dns', start: 20_000, dur: 6_000, roles: { m2: 'dns' } },
];

export function fixture(o: FixtureOptions = {}): RunData {
  const end = T0 + 26_000;
  const loaded = (t: number): boolean => t >= T0 + 10_000 && t < T0 + 20_000;
  const mac: RunRecord[] = [];
  const pc: RunRecord[] = [];
  for (const [i, p] of phases.entries()) {
    mac.push(['mark', i, T0 + p.start, T0 + p.start + 3, 1.5]);
    pc.push(['mark', i, T0 + p.start, T0 + p.start + 5, 0.8]);
  }
  for (let t = T0; t < end; t += 500) {
    mac.push(['rtt', 'w', 0, t, loaded(t) ? 40 : 20]);
    mac.push(['rtt', 'r', 0, t, loaded(t) ? 5 : 2]);
    pc.push(['rtt', 'r', 0, t, 3]);
  }
  for (let t = T0 + 10_000; t < T0 + 20_000; t += 100) mac.push(['tp', 'd', t, 125_000]);
  if (o.hidden === true) mac.push(['hidden', T0 + 15_000], ['visible', T0 + 16_000]);
  if (o.publicAddresses === true) mac.push(['err', T0 + 11_000, 'connection to 203.0.113.7 failed (via 192.168.1.1)']);
  pc.push(['cold', 'google.com', T0 + 22_000, 31, 'failed'], ['page', 'google.com', T0 + 22_100, 120, 'first'], ['page', 'google.com', T0 + 22_300, 40, 'repeat']);

  // the router's pings: the Mac's (one lost of 100), the PC's (never answered), its gateway's
  const probes: string[] = [];
  let n = 0;
  for (let t = T0; t < end; t += 260) {
    n++;
    probes.push(
      JSON.stringify({
        t,
        r: {
          m1: [[n, t, n === 50 ? null : 1]],
          ...(n <= 50 ? { m2: [[n, t, null]] } : {}),
          wan: [[n, t, loaded(t) ? 12 : 10]],
        },
      }),
    );
  }

  // the router's samples, each second
  const router: string[] = [];
  let down = 0;
  let tin = 0;
  let marks = 0;
  let txp = 0;
  let retries = 0;
  for (let s = 0; s <= 26; s++) {
    const t = T0 + s * 1000;
    const busy = loaded(t) ? (o.pegged?.includes(s) === true ? 0.97 : (o.cpuLoad ?? 0.5)) : 0.2;
    const sent = loaded(t) ? 1_200_000 : 1000;
    down += sent;
    tin += sent;
    if (loaded(t)) marks += 3;
    const line: Record<string, unknown> = {
      t,
      cpu: [
        [busy, 0.1, 0],
        [0.1, 0.02, 0],
      ],
      sn: [
        [100, s === 15 ? (o.softnetDrops ?? 0) : 0, 1],
        [50, 0, 0],
      ],
      if: { eth1: [sent, 2000, 900, 400, 0, 0, 0, 0], 'br-lan': [3000, sent, 500, 900, 2, 0, 0, 0] },
      cake:
        o.sqm === false
          ? {}
          : {
              'ifb4eth1 1:': [down, s * 900, 0, loaded(t) ? 30_000 : 0, [[tin, 0, marks, 0, 5000, 8000, 4000, 1, 2], [500, 0, 0, 0, 5000, 20_000, 15_000, 0, 0]]],
              'eth1 1:': [s * 2000, s * 400, 0, 0, [[s * 2000, 0, 0, 0, 5000, 1000, 500, 1, 0]]],
            },
      ct: 40 + s,
      self: [0.008, 0.001, 0.001],
      cost_ms: 12,
    };
    if (s === 0) line['wan'] = 'eth1';
    if (s > 0) line['dt'] = 1;
    if (s % 2 === 0) {
      txp += 1000;
      retries += 50;
      line['wifi'] = { sta: { m1: { dev: 'phy1-ap0', signal: -70, tx_mbit: 800, rx_mbit: 600, c: [txp, retries, 0, 500, 0, 0, null, null], aql: 2000 } }, ap: {} };
    }
    if (s % 10 === 5) line['ct_scan'] = { n: 50, off: 9, m: { m1: [12, 9, 10, 2, 10] }, ms: 3 };
    router.push(JSON.stringify(line));
  }

  const dns = [
    JSON.stringify({ upstream: 'dnsproxy' }),
    ...[
      { t: T0 + 20_500, s: 'google.com', k: 'cold', ms: 30, rc: 3, n: 0, ttl: null, fw: 1 },
      { t: T0 + 20_540, s: 'google.com', k: 'up', ms: 25, rc: 3, n: 0, ttl: null, fw: null },
      { t: T0 + 20_580, s: 'google.com', k: 'warm', ms: 15, rc: 0, n: 1, ttl: 60, fw: 1 },
      { t: T0 + 20_600, s: 'google.com', k: 'again', ms: 0.05, rc: 0, n: 1, ttl: 60, fw: 0 },
    ].map((l) => JSON.stringify({ p: 2, ...l })),
  ];

  const meta: StoredRun = {
    id: 'abcdef012345',
    bench: 'b1',
    bench_name: 'Bench',
    created: T0 - 4000,
    created_wall: 1_700_000_000,
    t0: T0,
    end,
    schedule: { name: 'Test', dry: o.dry === true, phases, length: 26_000, options: { endpoint: 'dev', latency: 'uk', budget_mb: 100, custom_sites: [] } },
    members: [
      {
        id: 'm1',
        name: 'Mac',
        ip: '192.168.1.10',
        ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        platform: 'macOS',
        link: { kind: 'wifi', band: '5', signal: -70 },
      },
      { id: 'm2', name: 'PC', ip: o.publicAddresses === true ? '2a00:1450:4009:81f::200e' : '192.168.1.20', ua: 'Windows', platform: 'Windows', link: { kind: 'wired', port: 'lan2' } },
    ],
    coordinator: 'Mac',
    settings: {
      sqm: o.sqm === false ? [] : [{ interface: 'eth1', enabled: '1', download: 10_000, upload: 2000, qdisc: 'cake' }],
      firewall: { flow_offloading: o.offloading === false ? '0' : '1' },
      wifi: [],
      dns: 'auto',
      firmware: 'MilkFlint test',
      model: 'Test router',
    },
  };
  return {
    meta,
    end: { reason: 'completed', at: end },
    records: new Map([
      ['m1', mac],
      ['m2', o.pcSentNothing === true ? [] : pc],
    ]),
    probes: parseProbes(probes),
    router: parseRouter(router),
    dns: parseDns(dns),
  };
}
