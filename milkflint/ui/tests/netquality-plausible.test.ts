// The probe's impossible times (a clock that jumped, a bad sample): left out
// of every figure Network quality and Home work out, never printed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pairPings, pingScale, responsiveness } from '@/features/dashboard/model';
import type { History, Sample } from '@/features/network-quality/api';
import { chartScale, historyLine, liveLine, offScale } from '@/features/network-quality/chart-data';
import {
  LONGEST_ANSWER_MS,
  PROBE_TIMEOUT_MS,
  possibleBucket,
  possibleHistory,
  possibleSample,
  possibleSamples,
  possibleStat,
  possibleTime,
} from '@/features/network-quality/plausible';
import { summarize, summarizeDnsServer } from '@/features/network-quality/score';

// what the dev VM's probe reported after its host slept
const JUMP = 3_228_553;

const round = (t: number, internet: number | null, over: Partial<Sample> = {}): Sample => ({
  t,
  gateway: 0.4,
  internet,
  dns: 4,
  ...over,
});

test('a time beyond the probe’s timeout, and half a second for a busy router, is impossible', () => {
  assert.equal(PROBE_TIMEOUT_MS, 2000);
  assert.equal(LONGEST_ANSWER_MS, 2500);
  for (const v of [0, 0.1, 14, 1999, 2000, 2500, null, undefined]) assert.equal(possibleTime(v), true, String(v));
  for (const v of [2501, 10_000, JUMP, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(possibleTime(v), false, String(v));
});

test('a round with any impossible time is left out: a gap, not a loss', () => {
  assert.equal(possibleSample(round(0, 14)), true);
  assert.equal(possibleSample(round(0, null)), true, 'no answer is a loss, not impossible');
  assert.equal(possibleSample(round(0, JUMP)), false);
  assert.equal(possibleSample(round(0, 14, { gateway: JUMP })), false);
  assert.equal(possibleSample(round(0, 14, { dns_servers: { a: 3, b: JUMP } })), false);
  assert.equal(possibleSample(round(0, 14, { routes: { uk: JUMP } })), false);
  assert.deepEqual(
    possibleSamples([round(0, 14), round(5, JUMP), round(10, null)]).map((s) => s.t),
    [0, 10],
  );
});

test('the score, typical, worst, jitter and loss leave the impossible round out', () => {
  const steady = Array.from({ length: 60 }, (_, i) => round(i * 5, 10 + (i % 2)));
  const jumped = [
    ...steady.slice(0, 30),
    round(150, JUMP, { gateway: JUMP, dns: JUMP }),
    ...steady.slice(30).map((s) => ({ ...s, t: s.t + 5 })),
  ];
  const clean = summarize(steady);
  const s = summarize(jumped);
  assert.equal(s.probes.internet.worst, clean.probes.internet.worst);
  assert.equal(s.probes.internet.typical, clean.probes.internet.typical);
  assert.equal(s.probes.internet.loss, 0, 'not counted as lost');
  assert.equal(s.jitter, clean.jitter);
  assert.equal(s.score, clean.score);
  assert.equal(summarizeDnsServer([round(0, 9, { dns_servers: { a: JUMP } })], 'a').answered, 0);
});

test('a history point with an impossible typical is a gap; an impossible worst is unknown', () => {
  assert.equal(possibleStat(null), null);
  assert.deepEqual(possibleStat([12, 40, 0, 12]), [12, 40, 0, 12]);
  assert.deepEqual(possibleStat([12, JUMP, 0, 12]), [12, null, 0, 12]);
  assert.equal(possibleStat([JUMP, JUMP, 0, 1]), null);
  const b = possibleBucket({
    i: 3,
    internet: [JUMP, JUMP, 0, 1],
    dns: [4, 5, 0, 12],
    routes: { uk: [9, JUMP, 1, 2] },
    dns_servers: { a: [JUMP, JUMP, 0, 2] },
  });
  assert.deepEqual(b, { i: 3, internet: null, dns: [4, 5, 0, 12], routes: { uk: [9, null, 1, 2] }, dns_servers: { a: null } });
  assert.equal('gateway' in b, false, 'an absent probe stays absent');
  const history: History = {
    now: 600,
    start: 0,
    step: 60,
    days: 7,
    buckets: [
      { i: 0, internet: [10, 12, 0, 12], dns: null },
      { i: 1, internet: [JUMP, JUMP, 0, 1], dns: null },
    ],
  };
  const l = historyLine(
    { key: 'internet', label: 'Internet', color: 'red', sample: (s) => s.internet, bucket: (x) => x.internet },
    possibleHistory(history),
  );
  assert.deepEqual(
    l.points.map((p) => p.t),
    [0],
  );
});

test('Home: responsiveness, its chart’s scale and its load pairs never take an impossible ping', () => {
  const now = 10_000;
  const hour = Array.from({ length: 720 }, (_, i) => round(now - 3595 + i * 5, 10));
  hour[700] = round(now - 3595 + 700 * 5, JUMP);
  const r = responsiveness(hour, now);
  assert.equal(r.hour.worst, 10);
  assert.equal(r.hour.peak, 10);
  assert.equal(r.hour.loss, 0);
  assert.equal(r.state.label, 'Steady');
  // the caption's "the highest was …" can't be the jump
  assert.deepEqual(pingScale([10, 10, 10, JUMP]), { top: 20, cut: undefined });
  assert.deepEqual(pingScale([10, 10, 10, 300, JUMP]).cut, 300);
  const pairs = pairPings(
    [
      { t: 100, internet: JUMP },
      { t: 105, internet: 11 },
    ],
    [
      { t: 98, wanDown: 1, wanUp: 1 },
      { t: 100, wanDown: 1, wanUp: 1 },
      { t: 102, wanDown: 1, wanUp: 1 },
      { t: 104, wanDown: 1, wanUp: 1 },
      { t: 106, wanDown: 1, wanUp: 1 },
    ],
    0,
    { down: undefined, up: undefined },
    2,
  );
  assert.deepEqual(
    pairs.map((p) => p.ping),
    [11],
  );
});

const spec = {
  key: 'internet',
  label: 'Internet',
  color: 'var(--chart-1)',
  sample: (s: Sample) => s.internet,
  bucket: () => undefined,
};

test('the chart’s scale stops short of a spike far above a line’s typical, and says so', () => {
  // an hour at 9–11 ms with one 1.8 s stall: the scale stays readable
  const samples = Array.from({ length: 720 }, (_, i) => round(i * 5, 9 + (i % 3)));
  samples[360] = round(1800, 1800);
  const l = liveLine(spec, samples);
  const s = chartScale([l], 5);
  assert.ok(s.max <= 100, `top ${String(s.max)}`);
  assert.ok(s.max >= 11, 'room for every ordinary ping');
  assert.deepEqual(s.above, { count: 1, highest: 1800 });
  assert.deepEqual(
    offScale([l], 0, 3600, s.max).map((o) => [o.t, o.v]),
    [[1800, 1800]],
  );
  // a spike within eight times the typical (or 20 ms) is on the scale
  const mild = liveLine(spec, [round(0, 10), round(5, 10), round(10, 60), round(15, 10)]);
  assert.equal(chartScale([mild], 5).above, undefined);
  assert.ok(chartScale([mild], 5).max >= 60);
  // several lines: each one's own typical sets its reach, the highest reach sets the top
  const far = liveLine(
    { ...spec, key: 'us' },
    Array.from({ length: 20 }, (_, i) => round(i * 5, 80 + (i % 4))),
  );
  assert.equal(chartScale([l, far], 5).above?.count, 1);
  assert.ok(chartScale([l, far], 5).max >= 83);
  // nothing shown: an empty scale, nothing above it
  assert.deepEqual(chartScale([], 5).above, undefined);
});

test('a stretch of at least 1% of the points is shown in full, not cut', () => {
  // a busy line: half an hour at 10 ms, then 30 pings at 150 ms
  const samples = Array.from({ length: 720 }, (_, i) => round(i * 5, i >= 600 && i < 630 ? 150 : 10));
  const s = chartScale([liveLine(spec, samples)], 5);
  assert.equal(s.above, undefined);
  assert.ok(s.max >= 150);
});

test('points above the scale make one mark per slice of the span, not one each', () => {
  // six rare spikes in a row (under 1% of the hour)
  const samples = Array.from({ length: 720 }, (_, i) => round(i * 5, i >= 600 && i < 606 ? 900 : 10));
  const l = liveLine(spec, samples);
  const s = chartScale([l], 5);
  assert.deepEqual(s.above, { count: 6, highest: 900 });
  assert.equal(offScale([l], 0, 3600, s.max).length, 2);
});
