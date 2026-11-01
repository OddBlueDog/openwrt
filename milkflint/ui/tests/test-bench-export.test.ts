// The test bench's timelines (a run second by second) and its export: the
// file has no public addresses, and opens again as the same report.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseRouter } from '../src/features/test-bench/analysis.ts';
import { defaultThresholds, runChecks } from '../src/features/test-bench/checks.ts';
import { buildExport, EXPORT_FORMAT, exportName, hideAddresses, parseExport } from '../src/features/test-bench/export.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import { cakeSeconds, memberRate, stationSamples, wanPort, worstEachSecond } from '../src/features/test-bench/timelines.ts';
import { fixture, phases, T0 } from './test-bench-fixture.ts';

// ---- Timelines ----

test('latency each second: the worst answered, a second with only lost probes, a gap', () => {
  const w = worstEachSecond(
    [
      { t: T0 + 100, ms: 5 },
      { t: T0 + 600, ms: 9 },
      { t: T0 + 1200, ms: null },
      { t: T0 + 3100, ms: 4 },
    ],
    T0,
  );
  assert.deepEqual(w.points, [
    [500, 9],
    [1500, null],
    [2500, null],
    [3500, 4],
  ]);
  assert.deepEqual(w.lost, [1200]);
});

test('a device’s speed each second: nothing arriving in its load phase is 0, outside it nothing', () => {
  const recs: RunRecord[] = [
    ['tp', 'd', T0 + 10_100, 125_000],
    ['tp', 'd', T0 + 10_900, 125_000],
    ['tp', 'd', T0 + 12_500, 250_000],
  ];
  const p = memberRate(recs, 'd', T0, phases, 'm1', T0 + 26_000);
  assert.deepEqual(p.slice(0, 3), [
    [10_500, 2],
    [11_500, 0],
    [12_500, 2],
  ]);
  assert.equal(p.length, 10);
  assert.deepEqual(memberRate(recs, 'u', T0, phases, 'm1', T0 + 26_000), []);
});

test('Smart Queue each second: drops and marks since the last sample, the busiest tin of those that sent', () => {
  const lines = parseRouter([
    JSON.stringify({ t: T0, cake: { 'ifb4eth1 1:': [0, 0, 0, 0, [[0, 0, 0, 0, 5000, 0, 0], [0, 0, 0, 0, 5000, 0, 0]]] } }),
    JSON.stringify({
      t: T0 + 1000,
      dt: 1,
      cake: { 'ifb4eth1 1:': [1_250_000, 900, 2, 1500, [[1_250_000, 2, 5, 1500, 5000, 7000, 3000], [0, 0, 0, 0, 5000, 30_000, 9000]]] },
    }),
  ]);
  const [s] = cakeSeconds(lines, T0, 'down');
  // the second tin sent nothing: its old delay isn't this second's
  assert.deepEqual(s, { t: 1000, avgMs: 3, peakMs: 7, drops: 2, marks: 5, backlog: 1500, mbit: 10 });
  assert.deepEqual(cakeSeconds(lines, T0, 'up'), []);
});

test('a Wi-Fi station every 2 s: retries and failed frames as shares of those sent since', () => {
  const s = stationSamples(fixture().router, T0, 'm1');
  assert.equal(s.length, 14);
  assert.equal(s[0]?.retries, null);
  assert.equal(s[1]?.retries, 0.05);
  assert.equal(s[1].failed, 0);
  assert.equal(s[1].aqlMs, 2);
  assert.deepEqual(stationSamples(fixture().router, T0, 'm2'), []);
});

test('the WAN port: as the first sample names it, else from Smart Queue’s queue on it', () => {
  assert.equal(wanPort(fixture().router), 'eth1');
  assert.equal(wanPort(parseRouter([JSON.stringify({ t: 1, cake: { 'ifb4wan 1:': [0, 0, 0, 0, []], 'wan 1:': [0, 0, 0, 0, []] } })])), 'wan');
  assert.equal(wanPort([]), undefined);
});

// ---- Export ----

test('public addresses are hidden; the home network’s, versions, times and MAC addresses aren’t', () => {
  const cases: [string, string][] = [
    ['to 203.0.113.7:443 failed', 'to hidden:443 failed'],
    ['via 192.168.1.1 and 10.0.0.2, 172.16.5.4', 'via 192.168.1.1 and 10.0.0.2, 172.16.5.4'],
    ['172.32.0.1', 'hidden'],
    ['Chrome/141.0.0.0 Safari/537.36', 'Chrome/141.0.0.0 Safari/537.36'],
    ['1.2.3.4.5', '1.2.3.4.5'],
    ['999.1.1.1', '999.1.1.1'],
    ['at 12:30:05, aa:bb:cc:dd:ee:ff', 'at 12:30:05, aa:bb:cc:dd:ee:ff'],
    ['from 2a00:1450:4009:81f::200e!', 'from hidden!'],
    ['2001:0db8:0000:0000:0000:ff00:0042:8329', 'hidden'],
    ['fe80::1, fd12:3456::1 and ::1', 'fe80::1, fd12:3456::1 and ::1'],
  ];
  for (const [s, want] of cases) assert.equal(hideAddresses(s), want, s);
});

test('an export has everything, and no public address anywhere in it', () => {
  const data = fixture({ publicAddresses: true });
  const t = defaultThresholds();
  const checks = runChecks(data, t);
  const x = buildExport(data, checks, t, new Date('2026-01-02T03:04:05Z'));
  const text = JSON.stringify(x);
  assert.equal(x.format, EXPORT_FORMAT);
  assert.equal(x.exported, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(x.router, { model: 'Test router', firmware: 'MilkFlint test' });
  assert.ok(!text.includes('2a00:1450') && !text.includes('203.0.113.7'));
  assert.equal(x.run.members[1]?.ip, 'hidden');
  assert.equal(x.run.members[0]?.ip, '192.168.1.10');
  assert.ok(text.includes('Chrome/141.0.0.0'));
  assert.equal(x.data.members['m1']?.length, data.records.get('m1')?.length);
  assert.equal(x.summary.phases.length, 3);
  assert.equal(x.summary.phases[1]?.members['m1']?.down?.mbit, 10);
  assert.equal(x.checks.length, 14);
  assert.deepEqual(x.thresholds, t);
  assert.match(exportName(data), /^milkflint-bench-\d{4}-\d{2}-\d{2}-abcdef012345\.json$/);
});

test('an export opens again as the same report, with the thresholds it was saved with', () => {
  const data = fixture();
  const t = { ...defaultThresholds(), wanAdded: { pass: 25, warn: 40 } };
  const back = parseExport(JSON.stringify(buildExport(data, runChecks(data, t), t)));
  assert.deepEqual(back.data.meta, data.meta);
  assert.deepEqual(back.data.end, data.end);
  assert.deepEqual(back.data.records, data.records);
  assert.deepEqual(back.data.probes, data.probes);
  assert.deepEqual(back.data.router, data.router);
  assert.deepEqual(back.data.dns, data.dns);
  assert.deepEqual(back.thresholds, t);
  assert.deepEqual(runChecks(back.data, t), runChecks(data, t));
});

test('a file that isn’t an export is turned down', () => {
  assert.throws(() => parseExport('not json'), /not a JSON file/);
  assert.throws(() => parseExport('{"format":"something/1"}'), /not a milkflint-bench\/1 file/);
});
