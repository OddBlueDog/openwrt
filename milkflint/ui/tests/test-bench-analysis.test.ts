// The test bench's figures: percentiles, latency, throughput, the router's
// pings and samples cut to a phase's window; Cloudflare's server timing;
// the data limit; a plan's data estimate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Phase } from '../src/features/test-bench/api.ts';
import {
  memberRtts,
  memberThroughput,
  offloaded,
  parseProbes,
  parseRouter,
  percentile,
  phaseWindows,
  RAMP_MS,
  routerRtts,
  routerWindow,
  rttStats,
  serverView,
} from '../src/features/test-bench/analysis.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import { buildPlan, dataEstimate, defaultBudget } from '../src/features/test-bench/plans.ts';
import { cfL4, Meter } from '../src/features/test-bench/wan.ts';

const phase = (kind: Phase['kind'], start: number, dur: number, roles: Record<string, string> = {}): Phase => ({ kind, start, dur, roles });

test('percentiles interpolate between neighbours', () => {
  assert.equal(percentile([], 0.5), undefined);
  assert.equal(percentile([5], 0.95), 5);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2.5);
  assert.equal(percentile([0, 10], 0.95), 9.5);
  assert.equal(percentile([1, 2, 3], 1), 3);
});

test('latency: lost probes counted, the rest in order for jitter', () => {
  const s = rttStats([
    { t: 30, ms: 14 },
    { t: 10, ms: 10 },
    { t: 20, ms: null },
    { t: 40, ms: 12 },
  ]);
  assert.equal(s.sent, 4);
  assert.equal(s.lost, 1);
  assert.equal(s.median, 12);
  assert.equal(s.max, 14);
  // 10 -> 14 -> 12, by when they went
  assert.equal(s.jitter, 3);
  const none = rttStats([]);
  assert.equal(none.median, undefined);
  assert.equal(none.jitter, undefined);
});

test('a load phase leaves its ramp out, an idle one doesn’t, a short one keeps half', () => {
  const w = phaseWindows(1000, [phase('idle', 0, 10_000), phase('wan_down', 10_000, 20_000), phase('wan_up', 30_000, 3000)]);
  assert.deepEqual(
    w.map((x) => [x.from, x.to]),
    [
      [1000, 11_000],
      [11_000 + RAMP_MS, 31_000],
      [31_000 + 1500, 34_000],
    ],
  );
});

const records: RunRecord[] = [
  ['rtt', 'r', 1, 999, 2],
  ['rtt', 'r', 2, 1000, 3],
  ['rtt', 'w', 3, 1500, null],
  ['rtt', 'r', 4, 2000, 5],
  ['tp', 'd', 1100, 1_000_000],
  ['tp', 'd', 1350, 1_000_000],
  ['tp', 'd', 2100, 500_000],
  ['tp', 'u', 1200, 250_000],
  ['cf', 1300, 8, 7, 1, 0],
  ['cf', 1900, 12, 7, 2, 1],
  ['cf', 1950, 10, 7, 0, 0],
];

test("a member's probes in a window, by when they went", () => {
  assert.deepEqual(memberRtts(records, 'r', { from: 1000, to: 2000 }), [{ t: 1000, ms: 3 }]);
  assert.deepEqual(memberRtts(records, 'w'), [{ t: 1500, ms: null }]);
});

test('throughput: the average over the window and its busiest second', () => {
  const tp = memberThroughput(records, 'd', { from: 1000, to: 3000 });
  assert.ok(tp !== undefined);
  assert.equal(tp.bytes, 2_500_000);
  // 2.5 MB over 2 s = 10 Mbit/s; the first second had 2 MB = 16 Mbit/s
  assert.equal(tp.mbit, 10);
  assert.equal(tp.peak, 16);
  assert.equal(memberThroughput(records, 'u', { from: 2000, to: 3000 }), undefined);
});

test("Cloudflare's view: its median RTT, retransmits and losses added up", () => {
  assert.deepEqual(serverView(records, { from: 1000, to: 2000 }), { rtt: 10, retrans: 3, lost: 1, n: 3 });
});

test("the router's pings: each once, in the window", () => {
  const lines = parseProbes([
    JSON.stringify({ t: 2000, r: { m1: [[0, 1000, 0.5], [1, 1200, null]], wan: [[0, 1100, 10]] } }),
    JSON.stringify({ t: 3000, r: { m1: [[1, 1200, null], [2, 2500, 0.7]] } }),
    'not json',
    JSON.stringify({ t: 'x' }),
  ]);
  assert.equal(lines.length, 2);
  assert.deepEqual(routerRtts(lines, 'm1'), [
    { t: 1000, ms: 0.5 },
    { t: 1200, ms: null },
    { t: 2500, ms: 0.7 },
  ]);
  assert.deepEqual(routerRtts(lines, 'm1', { from: 2000, to: 3000 }), [{ t: 2500, ms: 0.7 }]);
  assert.deepEqual(routerRtts(lines, 'nobody'), []);
});

// a router sample: CPUs [busy, softirq, irq]; softnet [done, dropped, squeezed]; CAKE [bytes, packets, drops, backlog, tins]
const tin = (drops: number, marks: number, peakUs: number, avgUs: number): number[] => [0, drops, marks, 0, 5000, peakUs, avgUs, 0, 0];
const sample = (t: number, cpu: [number, number][], drops: number, marks: number, avgUs: number, sn: number[][]): string =>
  JSON.stringify({
    t,
    dt: 1,
    cpu: cpu.map(([b, s]) => [b, s, 0]),
    sn,
    self: [0.01, 0.005],
    cake: {
      'eth1 8005:': [0, 0, 0, 0, [tin(0, 0, 300, 100)]],
      'ifb4eth1 8007:1': [0, 0, drops, 0, [tin(drops, marks, avgUs * 2, avgUs)]],
    },
    ct_scan: t === 2000 ? { n: 100, off: 40, m: { m1: [10, 8, 9, 1] } } : null,
  });

test("the router's samples in a window: the busiest core, Smart Queue's delay and its drops and marks there, softnet", () => {
  const lines = parseRouter([
    sample(1000, [[0.1, 0], [0.2, 0.1]], 5, 1, 1000, [[1, 0, 0]]),
    sample(2000, [[0.5, 0.4], [0.9, 0.8]], 7, 4, 3000, [[1, 2, 3]]),
    sample(3000, [[0.4, 0.3], [0.3, 0.2]], 12, 6, 2000, [[1, 0, 1]]),
    sample(9000, [[1, 1], [1, 1]], 99, 99, 99_000, [[0, 9, 9]]),
  ]);
  const r = routerWindow(lines, { from: 1000, to: 4000 });
  assert.equal(r.cpuMax, 0.9);
  assert.ok(r.cpuP95 !== undefined && r.cpuP95 > 0.4 && r.cpuP95 < 0.9);
  assert.ok(r.down !== undefined && r.up !== undefined);
  assert.equal(r.down.avgMs, 3);
  assert.equal(r.down.peakMs, 6);
  // counters: the window's last sample less its first
  assert.equal(r.down.drops, 7);
  assert.equal(r.down.marks, 5);
  assert.equal(r.up.drops, 0);
  assert.equal(r.softnetDrops, 2);
  assert.equal(r.squeezed, 4);
  assert.equal(r.self, 0.01);
  assert.deepEqual(offloaded(lines, 'm1', { from: 1000, to: 4000 }), { flows: 10, offloaded: 8 });
  assert.equal(offloaded(lines, 'm2', { from: 1000, to: 4000 }), undefined);
});

test("Cloudflare's cfL4 Server-Timing: RTTs from µs to ms, counts", () => {
  assert.deepEqual(cfL4('?proto=TCP&rtt=7654&min_rtt=7623&rtt_var=2921&sent=6&recv=7&lost=2&retrans=3&sent_bytes=2842'), {
    rtt: 7.654,
    minRtt: 7.623,
    retrans: 3,
    lost: 2,
  });
  assert.equal(cfL4('?proto=TCP'), undefined);
  assert.deepEqual(cfL4('rtt=1000'), { rtt: 1, minRtt: 1, retrans: 0, lost: 0 });
});

test('the data limit stops the loads once, as soon as it is reached', () => {
  let hits = 0;
  const m = new Meter(1000, () => {
    hits++;
  });
  m.add('d', 600);
  assert.equal(hits, 0);
  m.add('u', 500);
  m.add('d', 500);
  assert.equal(hits, 1);
  assert.equal(m.total, 1600);
  const recs: RunRecord[] = [];
  m.flush(5000, (r) => recs.push(r));
  assert.deepEqual(recs, [
    ['tp', 'd', 5000, 1100],
    ['tp', 'u', 5000, 500],
  ]);
  assert.equal(m.rate('d'), (1100 * 8) / 1e6);
});

test("a plan's data estimate: each load phase at the shaped rate, nothing for a rehearsal", () => {
  const members = [{ id: 'm1', name: 'Mac', wired: true }];
  const { schedule } = buildPlan('quick', members, false);
  assert.deepEqual(schedule.options, { endpoint: 'cloudflare', latency: 'uk', budget_mb: 2000, custom_sites: [] });
  // 15 s at 80 Mbit/s down = 150 MB; 15 s at 16 Mbit/s up = 30 MB
  assert.deepEqual(dataEstimate(schedule, { down_kbit: 80_000, up_kbit: 16_000 }), { down: 150, up: 30 });
  assert.equal(dataEstimate(schedule, null), undefined);
  assert.deepEqual(dataEstimate(buildPlan('quick', members, true).schedule, null), { down: 0, up: 0 });
  assert.equal(defaultBudget({ down: 150, up: 30 }), 500);
  assert.equal(defaultBudget({ down: 1500, up: 300 }), 2700);
  assert.equal(defaultBudget(undefined), 2000);
});
