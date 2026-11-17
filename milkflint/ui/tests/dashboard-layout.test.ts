// The figures Home works out rather than reads: wired devices, the
// responsiveness summary, the busiest devices, the path. Its layout is
// tests/home-layout.test.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  agoLabels,
  busiestFirst,
  busyFlags,
  LOAD_FLOOR_BPS,
  LOAD_SHARE,
  type LoadPair,
  loadSummary,
  mergePairs,
  pairPings,
  pathSteps,
  highRate,
  lineBusyNow,
  type PathInput,
  pingScale,
  responsiveness,
  wiredDevices,
} from '@/features/dashboard/model';
import type { Sample } from '@/features/network-quality/api';

const REACHABLE = 0x02;
const STALE = 0x04;
const lan = { address: '192.168.1.1', mask: 24 };

test('wired devices: answering LAN neighbours that aren’t on the Wi-Fi', () => {
  const n = (ip: string, mac: string, state = REACHABLE): { ip: string; mac: string; dev: string; state: number } => ({
    ip,
    mac,
    dev: 'br-lan',
    state,
  });
  const neighbors = [
    n('192.168.1.10', 'AA:00:00:00:00:01'),
    // the same device with a second address
    n('192.168.1.11', 'aa:00:00:00:00:01'),
    n('192.168.1.12', 'aa:00:00:00:00:02', STALE),
    // on the Wi-Fi
    n('192.168.1.13', 'aa:00:00:00:00:03'),
    // outside the LAN: the provider's gateway
    n('10.0.2.2', 'aa:00:00:00:00:04'),
    // the router itself, and the main router in access point mode
    n('192.168.1.1', 'aa:00:00:00:00:05'),
    n('192.168.1.254', 'aa:00:00:00:00:06'),
  ];
  assert.equal(wiredDevices(neighbors, lan, new Set(['aa:00:00:00:00:03']), new Set(['192.168.1.254'])), 1);
  // nothing known: no table, an empty one (a router without the reader), no LAN address
  assert.equal(wiredDevices(undefined, lan, new Set(), new Set()), undefined);
  assert.equal(wiredDevices([], lan, new Set(), new Set()), undefined);
  assert.equal(wiredDevices(neighbors, undefined, new Set(), new Set()), undefined);
});

test('busiest devices first, idle ones by signal', () => {
  const d = (
    name: string,
    down: number | undefined,
    up: number | undefined,
    signal: number,
  ): { name: string; down: number | undefined; up: number | undefined; signal: number } => ({
    name,
    down,
    up,
    signal,
  });
  const order = busiestFirst([
    d('idle-near', 100, 0, -40),
    d('busy', 5e6, 1e5, -70),
    d('busier', 3e7, 0, -60),
    d('idle-far', undefined, undefined, -75),
  ]);
  assert.deepEqual(
    order.map((x) => x.name),
    ['busier', 'busy', 'idle-near', 'idle-far'],
  );
});

const ping = (t: number, internet: number | null): Sample => ({ t, gateway: null, internet, dns: 5 });

test('responsiveness: the latest ping, the hour, and a word for how it compares', () => {
  const now = 10_000;
  // an hour at 10 ms, every 5 s
  const hour = Array.from({ length: 720 }, (_, i) => ping(now - 3595 + i * 5, 10));
  const steady = responsiveness(hour, now);
  assert.equal(steady.now, 10);
  assert.equal(steady.hour.typical, 10);
  assert.equal(steady.hour.loss, 0);
  assert.deepEqual(steady.state, { tone: 'success', label: 'Steady' });

  // the last five minutes at 40 ms: slower than usual
  const slow = hour.map((s) => (s.t > now - 300 ? { ...s, internet: 40 } : s));
  assert.deepEqual(responsiveness(slow, now).state, { tone: 'warning', label: 'Slower than usual' });

  // a few lost in the last five minutes
  const lossy = hour.map((s, i) => (s.t > now - 300 && i % 10 === 0 ? { ...s, internet: null } : s));
  assert.deepEqual(responsiveness(lossy, now).state, { tone: 'warning', label: 'Losing pings' });

  // one lost isn't worth a warning
  const one = hour.map((s, i) => (i === hour.length - 3 ? { ...s, internet: null } : s));
  assert.equal(responsiveness(one, now).state.label, 'Steady');

  // nothing answered lately; the latest lost
  const silent = hour.map((s) => (s.t > now - 300 ? { ...s, internet: null } : s));
  const r = responsiveness(silent, now);
  assert.deepEqual(r.state, { tone: 'destructive', label: 'Not answering' });
  assert.equal(r.now, null);

  assert.deepEqual(responsiveness([], now).state, { tone: 'info', label: 'Measuring' });
  assert.equal(responsiveness([], now).now, undefined);
});

test('the ping chart’s scale keeps the typical ping readable and says what it cut', () => {
  assert.deepEqual(pingScale([]), { top: 20, cut: undefined });
  assert.deepEqual(pingScale([9, 10, 11, 12]), { top: 20, cut: undefined });
  assert.deepEqual(pingScale([9, 10, 10, 40]), { top: 50, cut: undefined });
  // one spike at 300 ms over a 10 ms hour: the top stops at 8x typical
  const spiky = [...Array.from({ length: 99 }, () => 10), 300];
  assert.deepEqual(pingScale(spiky), { top: 80, cut: 300 });
});

test('a chart’s foot: the span ago, then now', () => {
  assert.deepEqual(agoLabels(100, 220, '2 min'), [
    { t: 100, label: '2 min ago' },
    { t: 220, label: 'Now' },
  ]);
});

const base: PathInput = {
  lineBusy: false,
  ap: false,
  online: true,
  noWan: false,
  wanDown: 2e6,
  wanUp: 5e5,
  probe: { internet: 9, gateway: 1.5, gatewaySilent: false },
  cake: [],
  cpu: 0.1,
  cores: [0.1, 0.2],
  radios: [
    { name: 'radio0', band: '2.4 GHz', up: true, clients: 1, channel: 6, htmode: 'HE20', rateDown: 1e6 },
    { name: 'radio1', band: '5 GHz', up: false, clients: 0, channel: undefined, htmode: undefined, rateDown: undefined },
  ],
  wired: 2,
  lanUp: true,
  gateway: undefined,
};

test('the path: shared steps, then the last hop, each with what is measured', () => {
  const { shared, last } = pathSteps(base);
  assert.deepEqual(
    shared.map((s) => [s.name, s.state, s.status]),
    [
      ['Internet', 'ok', 'Online'],
      ['Smart Queue', 'off', 'Off'],
      ['Router', 'ok', 'OK'],
    ],
  );
  assert.deepEqual(shared[0]?.figure, { label: 'Download now', value: '2 Mbit/s' });
  assert.equal(shared[1]?.route, 'sqm');
  assert.deepEqual(
    last.map((s) => [s.name, s.state, s.figure?.value]),
    [
      ['Wi-Fi 2.4 GHz', 'ok', '1'],
      ['Wi-Fi 5 GHz', 'down', undefined],
      ['Wired', 'ok', '2'],
    ],
  );
  assert.deepEqual(last[0]?.lines, ['Channel 6 · HE20', 'Download 1 Mbit/s']);
  // the wired count unknown: no figure rather than a guess
  assert.equal(pathSteps({ ...base, wired: undefined }).last[2]?.figure, undefined);
});

test('a band with no network switched on is off by choice, not down: no red flag', () => {
  const radios = base.radios.map((r) => (r.name === 'radio1' ? { ...r, off: true } : r));
  const off = pathSteps({ ...base, radios }).last.find((s) => s.name === 'Wi-Fi 5 GHz');
  assert.ok(off !== undefined);
  assert.equal(off.state, 'off');
  assert.equal(off.status, 'Off');
  assert.deepEqual(off.lines, ['No network switched on']);
});

test('the path’s delays: only where the router measures them', () => {
  const { shared, last } = pathSteps(base);
  // past the gateway: the internet ping less the gateway's; the gateway itself as the first hop
  assert.deepEqual(shared[0]?.delays, [{ label: 'Past the gateway, adds about', value: '7.5 ms' }]);
  assert.ok(shared[0].lines.includes('To the gateway 1.5 ms'));
  // nothing measured inside the router, on the Wi-Fi or the cables
  for (const s of [shared[2], ...last]) assert.deepEqual(s?.delays, []);
  // a gateway that doesn't answer: the whole ping, no difference
  const silent = pathSteps({ ...base, probe: { internet: 9, gateway: undefined, gatewaySilent: true } }).shared[0];
  assert.deepEqual(silent?.delays, []);
  assert.ok(silent.lines.includes('Ping 9 ms; the gateway doesn’t answer pings'));
  // Network Quality off: no delay at all
  const off = pathSteps({ ...base, probe: undefined }).shared[0];
  assert.deepEqual(off?.delays, []);
  assert.ok(off.lines.includes('Delay not measured: Network Quality is off'));
});

test('the path flags a busy core, a full shaped line, and a link that is down', () => {
  const busy = pathSteps({
    ...base,
    cores: [0.2, 0.95],
    cake: [
      { download: true, rate: 88e6, bandwidth: 100e6, avgDelayUs: 1200, peakDelayUs: 5000 },
      { download: false, rate: 1e6, bandwidth: 20e6, avgDelayUs: 400, peakDelayUs: undefined },
    ],
  });
  assert.deepEqual(
    busy.shared.map((s) => [s.name, s.state]),
    [
      ['Internet', 'ok'],
      ['Smart Queue', 'busy'],
      ['Router', 'busy'],
    ],
  );
  // CAKE's own average time in the queue each way, and the peak it reports
  assert.deepEqual(busy.shared[1]?.delays, [
    { label: 'Queue down', value: '1.2 ms' },
    { label: 'Queue up', value: '0.4 ms' },
  ]);
  assert.ok(busy.shared[1].lines.includes('Peaks 5 ms down'));
  assert.ok(busy.shared[1].lines.includes('At 88% of its limit'));

  const offline = pathSteps({ ...base, online: false });
  assert.equal(offline.shared[0]?.state, 'down');
  assert.equal(offline.shared[0].status, 'Offline');
  assert.deepEqual(offline.shared[0].delays, []);
  assert.equal(pathSteps({ ...base, online: false, noWan: true }).shared[0]?.status, 'Not set up');
});

test('in access point mode the path starts at the main router, with no Smart Queue', () => {
  const { shared } = pathSteps({ ...base, ap: true, gateway: '192.168.1.254' });
  assert.deepEqual(
    shared.map((s) => [s.name, s.route]),
    [
      ['Main router', 'mode'],
      ['Router', 'system-overview'],
    ],
  );
  assert.deepEqual(shared[0]?.lines, ['Via 192.168.1.254']);
});

// ---- at rest and under load ----

const rate = (t: number, down: number, up = 1e5): { t: number; wanDown: number; wanUp: number } => ({
  t,
  wanDown: down,
  wanUp: up,
});

test('pings pair with the WAN rate polled over the interval they fell in', () => {
  // the browser's clock runs 100 s ahead of the router's
  const rates = [rate(1100, 1e6), rate(1102, 2e6), rate(1104, 3e6), { t: 1106, wanDown: undefined, wanUp: undefined }];
  const pairs = pairPings(
    [
      { t: 999, internet: 8 }, // in the first rate's interval, whose start isn't known: left out
      { t: 1001, internet: 9 }, // 1101 in the browser: the 1102 rate covers it
      { t: 1003.5, internet: null }, // 1103.5: the 1104 rate
      { t: 1005, internet: 12 }, // 1105: the 1106 sample has no rate yet
      { t: 1010, internet: 12 }, // after the newest rate: wait for the next poll
    ],
    rates,
    100,
    { down: 100e6, up: undefined },
    2,
  );
  assert.deepEqual(pairs, [
    { t: 1001, ping: 9, down: 2e6, up: 1e5, limitDown: 100e6, limitUp: undefined },
    { t: 1003.5, ping: null, down: 3e6, up: 1e5, limitDown: 100e6, limitUp: undefined },
  ]);
});

test('pairs merge once each, oldest first, for the last hour', () => {
  const p = (t: number, ping = 10): LoadPair => ({ t, ping, down: 0, up: 0, limitDown: undefined, limitUp: undefined });
  const merged = mergePairs([p(100), p(4000), p(4005)], [p(4005, 11), p(4010)], 4010);
  assert.deepEqual(
    merged.map((x) => [x.t, x.ping]),
    [
      [4000, 10],
      [4005, 11],
      [4010, 10],
    ],
  );
});

const pair = (t: number, ping: number | null, down: number, limitDown?: number, up = 0): LoadPair => ({
  t,
  ping,
  down,
  up,
  limitDown,
  limitUp: undefined,
});

test('busy: half of Smart Queue’s limit while it shapes, else half the highest rate seen, never under the floor', () => {
  // shaping at 100 Mbit/s: 50 Mbit/s and over is busy, whatever else was seen
  assert.deepEqual(busyFlags([pair(1, 9, 49e6, 100e6), pair(2, 9, 50e6, 100e6), pair(3, 9, 92e6, 100e6)]), [false, true, true]);
  // no Smart Queue: half the highest seen
  assert.deepEqual(busyFlags([pair(1, 9, 100e6), pair(2, 9, 40e6), pair(3, 9, 60e6)]), [true, false, true]);
  // an idle line's small bursts are never load
  assert.deepEqual(busyFlags([pair(1, 9, 8e5), pair(2, 9, 2e3)]), [false, false]);
  assert.equal(LOAD_FLOOR_BPS, 1e6);
  assert.equal(LOAD_SHARE, 0.5);
  // either direction: a full upload is load too
  assert.deepEqual(busyFlags([pair(1, 9, 0, undefined, 25e6), pair(2, 9, 0, undefined, 1e3)]), [true, false]);
});

test('at rest against under load, and the stretches the line was busy', () => {
  const step = 5;
  const pairs = [
    pair(100, 9, 1e5),
    pair(105, 10, 1e5),
    pair(110, 30, 80e6),
    pair(115, null, 92e6), // lost under load: no time, still busy
    pair(120, 34, 88e6),
    pair(125, 11, 1e5),
    pair(200, 40, 95e6), // a second stretch after a gap
  ];
  const s = loadSummary(pairs, step);
  assert.equal(s.paired, 7);
  // the highest seen is 95 Mbit/s (no Smart Queue): busy from 47.5
  assert.equal(s.busy, 4);
  assert.equal(s.atRest, 10);
  assert.equal(s.underLoad, 34);
  assert.deepEqual(s.stretches, [
    { from: 107.5, to: 122.5 },
    { from: 197.5, to: 202.5 },
  ]);

  // nothing busy yet: no under-load figure, no stretch
  const quiet = loadSummary([pair(100, 9, 1e5), pair(105, 10, 2e5)], step);
  assert.equal(quiet.underLoad, undefined);
  assert.equal(quiet.atRest, 10);
  assert.deepEqual(quiet.stretches, []);
  assert.deepEqual(loadSummary([], step), { paired: 0, busy: 0, atRest: undefined, underLoad: undefined, stretches: [] });
});

test('the path flags a busy internet line, by the same rule as Responsiveness', () => {
  const quiet = [
    { wanDown: 2e5, wanUp: 1e5 },
    { wanDown: 3e5, wanUp: 1e5 },
  ];
  assert.equal(lineBusyNow(quiet, undefined, undefined), false, "an idle line's bursts are not load");
  const loaded = [
    { wanDown: 1e6, wanUp: 1e5 },
    { wanDown: 92e6, wanUp: 1e6 },
  ];
  assert.equal(lineBusyNow(loaded, undefined, undefined), true, 'the highest rate of the window, now');
  assert.equal(lineBusyNow([{ wanDown: 40e6, wanUp: 0 }], 100e6, 20e6), false, "under half of Smart Queue's limit");
  assert.equal(lineBusyNow([{ wanDown: 60e6, wanUp: 0 }], 100e6, 20e6), true, 'half of it or more');
  assert.equal(lineBusyNow([], undefined, undefined), false);
  const { shared } = pathSteps({ ...base, lineBusy: true });
  assert.equal(shared[0]?.state, 'busy');
  assert.equal(shared[0].status, 'Busy');
});

test("one bogus sample can't set the bar for a busy line", () => {
  // an idle-then-loaded window with a single absurd sample in it
  const history = [
    ...Array.from({ length: 30 }, () => ({ wanDown: 1e5, wanUp: 1e5 })),
    { wanDown: 1.5e12, wanUp: 0 },
    ...Array.from({ length: 29 }, () => ({ wanDown: 4.5e9, wanUp: 2e7 })),
  ];
  assert.equal(lineBusyNow(history, undefined, undefined), true);
  assert.equal(highRate([1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]), 9);
  assert.equal(highRate([]), 0);
});
