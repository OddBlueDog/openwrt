// The test bench's report: its thresholds (defaults, what's stored, how a
// figure grades), latency idle against under load, and every check on a
// made-up run, at the edges that change its verdict.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Check, type CheckId, defaultThresholds, grade, parseThresholds, runChecks, THRESHOLDS, thresholdKeys, worst } from '../src/features/test-bench/checks.ts';
import { latencyRows } from '../src/features/test-bench/latency.ts';
import { fixture, type FixtureOptions } from './test-bench-fixture.ts';

const checks = (o: FixtureOptions = {}, t = defaultThresholds()): Map<CheckId, Check> => new Map(runChecks(fixture(o), t).map((c) => [c.id, c]));
const status = (o: FixtureOptions, id: CheckId): string | undefined => checks(o).get(id)?.status;

// ---- Thresholds ----

test('thresholds: every check’s default, and a stored copy read back with junk left out', () => {
  const d = defaultThresholds();
  assert.deepEqual(d.wanAdded, { pass: 15, warn: 30 });
  // a threshold with no warning level
  assert.deepEqual(d.shaperReach, { pass: 85, warn: null });
  assert.deepEqual(parseThresholds(d), d);
  assert.deepEqual(parseThresholds('nonsense'), d);
  const p = parseThresholds({ wanAdded: { pass: 20, warn: 'x' }, cpu: { pass: Infinity }, shaperReach: { pass: 70, warn: 60 }, extra: { pass: 1 } });
  assert.deepEqual(p.wanAdded, { pass: 20, warn: 30 });
  assert.deepEqual(p.cpu, d.cpu);
  assert.deepEqual(p.shaperReach, { pass: 70, warn: null });
  assert.deepEqual(Object.keys(p).sort(), [...thresholdKeys].sort());
  // every key's definition reads the same way round
  for (const k of thresholdKeys) {
    const def: { better: string; pass: number; warn?: number } = THRESHOLDS[k];
    if (def.warn !== undefined) assert.ok(def.better === 'lower' ? def.warn >= def.pass : def.warn <= def.pass, k);
  }
});

test('a figure against its threshold: at the level passes, lower-is-better and higher-is-better, no warning level, a warning level the wrong way', () => {
  const t = defaultThresholds();
  assert.equal(grade('wanAdded', 15, t), 'pass');
  assert.equal(grade('wanAdded', 15.1, t), 'warn');
  assert.equal(grade('wanAdded', 30, t), 'warn');
  assert.equal(grade('wanAdded', 30.1, t), 'fail');
  // percentages worked out in floating point
  assert.equal(grade('lanLoss', (1 / 1000) * 100, t), 'pass');
  assert.equal(grade('wifiSignal', -67, t), 'pass');
  assert.equal(grade('wifiSignal', -70, t), 'warn');
  assert.equal(grade('wifiSignal', -80, t), 'fail');
  assert.equal(grade('shaperReach', 80, t), 'info');
  assert.equal(grade('shaperReach', 90, t), 'pass');
  const odd = { ...t, wanAdded: { pass: 20, warn: 10 } };
  assert.equal(grade('wanAdded', 20, odd), 'pass');
  assert.equal(grade('wanAdded', 21, odd), 'fail');
  assert.equal(worst(['pass', 'skip', 'info']), 'info');
  assert.equal(worst(['pass', 'fail', 'warn']), 'fail');
  assert.equal(worst([]), 'skip');
});

// ---- Latency ----

test('latency per device and target: idle against under load, the router’s own, a device that never answers pings', () => {
  const rows = latencyRows(fixture());
  const row = (member: string | null, target: string) => rows.find((r) => r.member === member && r.target === target);
  const net = row('m1', 'internet');
  assert.equal(net?.idle.median, 20);
  assert.equal(net.loaded.p95, 40);
  assert.equal(net.added, 20);
  // only the download loads the network: the DNS phase isn't "under load"
  assert.deepEqual(
    net.phases.map((p) => p.window.phase.kind),
    ['wan_down'],
  );
  assert.equal(row(null, 'wan')?.added, 2);
  assert.equal(row('m2', 'ping')?.silent, true);
  assert.equal(row('m1', 'ping')?.silent, false);
  // nothing measured to its peers: no row
  assert.equal(row('m1', 'peers'), undefined);
});

// ---- Checks ----

test('the made-up run’s verdicts, in the report’s order', () => {
  const c = runChecks(fixture(), defaultThresholds());
  assert.deepEqual(
    c.map((x) => [x.id, x.status]),
    [
      ['internet-latency', 'warn'],
      ['router-latency', 'pass'],
      ['spikes', 'pass'],
      ['lan-loss', 'warn'],
      ['sqm', 'pass'],
      ['shaper', 'pass'],
      ['cpu', 'pass'],
      ['softnet', 'pass'],
      ['drops', 'pass'],
      ['offload', 'pass'],
      ['wifi', 'warn'],
      ['dns', 'pass'],
      ['overhead', 'pass'],
      ['quality', 'pass'],
    ],
  );
  const by = new Map(c.map((x) => [x.id, x]));
  assert.equal(by.get('internet-latency')?.value, '+20 ms');
  assert.match(by.get('internet-latency')?.detail ?? '', /Mac, to the internet, in Download/);
  // one of the Mac's 100 pings lost; the PC answers none, so it's left out and said why
  assert.equal(by.get('lan-loss')?.value, '1%');
  assert.ok(by.get('lan-loss')?.notes.some((n) => n.startsWith('PC doesn’t answer pings')) === true);
  assert.match(by.get('sqm')?.value ?? '', /↓ 4 ms/);
  assert.equal(by.get('shaper')?.value, '↓ 96%');
  // the bridge drops 2 frames a second whatever it does: not counted against it
  assert.equal(by.get('drops')?.value, 'none');
  assert.equal(by.get('offload')?.value, '90%');
  assert.match(by.get('wifi')?.value ?? '', /Mac: 5% retries, 0% failed, -70 dBm/);
  assert.equal(by.get('overhead')?.value, '1% of a core');
  assert.equal(by.get('quality')?.value, 'clock ±1.5 ms');
});

test('thresholds change the verdicts', () => {
  const t = { ...defaultThresholds(), wanAdded: { pass: 25, warn: 40 }, wifiSignal: { pass: -72, warn: -80 } };
  const c = checks({}, t);
  assert.equal(c.get('internet-latency')?.status, 'pass');
  assert.equal(c.get('wifi')?.status, 'pass');
});

test('checks that can’t be measured say why: Smart Queue off, flow offloading off', () => {
  const noSqm = checks({ sqm: false });
  assert.equal(noSqm.get('sqm')?.status, 'skip');
  assert.equal(noSqm.get('sqm')?.detail, 'Smart Queue is off.');
  assert.equal(noSqm.get('shaper')?.status, 'skip');
  assert.equal(status({ offloading: false }, 'offload'), 'skip');
});

test('the router CPU: the busiest core’s 95th percentile under load, and a core near full for 3 s running', () => {
  assert.equal(status({ cpuLoad: 0.85 }, 'cpu'), 'warn');
  // 2 of the download's 8 seconds at 97%: its 95th percentile is past the warning level already
  const two = checks({ pegged: [13, 14] }).get('cpu');
  assert.equal(two?.status, 'fail');
  assert.deepEqual(two.notes, []);
  const three = checks({ pegged: [13, 14, 15] }).get('cpu');
  assert.equal(three?.status, 'fail');
  assert.deepEqual(three.notes, ['A core stayed at 95% or more for 3 s running.']);
});

test('one softnet drop fails', () => {
  assert.equal(status({ softnetDrops: 1 }, 'softnet'), 'fail');
});

test('data quality: a page hidden for a while warns, a device that sent nothing fails', () => {
  const hidden = checks({ hidden: true }).get('quality');
  assert.equal(hidden?.status, 'warn');
  assert.ok(hidden.notes.some((n) => n.includes('hidden')));
  assert.equal(status({ pcSentNothing: true }, 'quality'), 'fail');
});

test('a rehearsal has only its data quality', () => {
  assert.deepEqual(
    runChecks(fixture({ dry: true }), defaultThresholds()).map((c) => c.id),
    ['quality'],
  );
});
