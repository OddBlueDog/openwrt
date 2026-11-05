// The Network Quality charts: lines from samples and history, the table's
// values, the marks along the time axis, and the CSV.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { History, Sample } from '../src/features/network-quality/api.ts';
import {
  type ChartLine,
  csvName,
  formatLoss,
  formatSliceTime,
  historyLine,
  type LineSpec,
  lineStats,
  linesToCsv,
  liveLine,
  lossBins,
  lossSliceAt,
  niceScale,
  runs,
  slotValues,
  timeTicks,
  unrecorded,
} from '../src/features/network-quality/chart-data.ts';

const us: LineSpec = {
  key: 'us',
  label: 'US',
  color: 'red',
  sample: (s) => (s.routes === undefined ? undefined : (s.routes['us'] ?? null)),
  bucket: (b) => b.routes?.['us'],
};
const sample = (t: number, us?: number | null): Sample => ({
  t,
  gateway: null,
  internet: 7,
  dns: 8,
  ...(us === undefined ? {} : { routes: { us } }),
});
const line = (points: ChartLine['points'], over: Partial<ChartLine> = {}): ChartLine => ({ key: 'x', label: 'X', color: 'red', countLoss: true, points, ...over });
const at = (t: number, v?: number): ChartLine['points'][number] => ({ t, v, lost: v === undefined ? 1 : 0, rounds: 1 });

test('an hour of once-a-minute route pings fills the whole hour, not half of it', () => {
  // the rounds fall a second late now and then, and most samples have no route ping
  const now = 100_000;
  const samples: Sample[] = [];
  for (let t = now - 3599, n = 0; t <= now; t += 5, n++) samples.push(sample(t, n % 12 === 0 ? 75 : undefined));
  const l = liveLine(us, samples);
  assert.equal(l.points.length, 60);
  assert.ok((l.points[0]?.t ?? 0) - (now - 3600) < 60, 'starts at the left edge');
  assert.ok(now - (l.points[59]?.t ?? 0) < 60, 'ends at the right edge');
  assert.deepEqual(unrecorded([l], now - 3600, now), []);
  assert.equal(runs(l.points).length, 1, 'one unbroken line');
});

test('a lost sample is a point without a value; a sample not asked is no point', () => {
  const l = liveLine(us, [sample(0, 75), sample(5), sample(60, null), sample(120, 76)]);
  assert.deepEqual(
    l.points.map((p) => [p.t, p.v, p.lost]),
    [
      [0, 75, 0],
      [60, undefined, 1],
      [120, 76, 0],
    ],
  );
  assert.equal(runs(l.points).length, 2);
});

test('a history bucket keeps its typical, worst and loss; empty ones are skipped', () => {
  const history: History = {
    now: 1000,
    start: 0,
    step: 120,
    days: 7,
    buckets: [
      { i: 1, internet: null, dns: null, routes: { us: [75, 113, 1, 2] } },
      { i: 2, internet: null, dns: null, routes: { us: [null, null, 2, 2] } },
      { i: 3, internet: null, dns: null, routes: { us: null } },
      { i: 4, internet: null, dns: null },
    ],
  };
  assert.deepEqual(historyLine(us, history).points, [
    { t: 120, v: 75, worst: 113, lost: 1, rounds: 2 },
    { t: 240, v: undefined, worst: undefined, lost: 2, rounds: 2 },
  ]);
});

test('a line breaks where nothing was recorded, and the time shows as unrecorded', () => {
  const l = line([at(0, 1), at(60, 1), at(120, 1), at(900, 1), at(960, 1)]);
  assert.equal(runs(l.points).length, 2);
  assert.deepEqual(unrecorded([l], 0, 960), [{ from: 120, to: 900 }]);
  assert.deepEqual(unrecorded([l], -600, 1500), [
    { from: -600, to: 0 },
    { from: 120, to: 900 },
    { from: 960, to: 1500 },
  ]);
});

test('the table: now, median, best, 95th percentile (of the worsts where there are any), loss', () => {
  const points = Array.from({ length: 100 }, (_, i) => at(i * 60, i + 1));
  const s = lineStats(line(points));
  assert.equal(s.now, 100);
  assert.equal(s.typical, 50);
  assert.equal(s.best, 1);
  assert.equal(s.worst, 96);
  assert.equal(s.loss, 0);

  const buckets = lineStats(line([{ t: 0, v: 10, worst: 90, lost: 1, rounds: 4 }, { t: 60, v: undefined, lost: 4, rounds: 4 }]));
  assert.equal(buckets.now, null);
  assert.equal(buckets.typical, 10);
  assert.equal(buckets.worst, 90);
  assert.equal(buckets.loss, 5 / 8);

  assert.equal(lineStats(line([])).now, undefined);
});

test('rare loss still shows', () => {
  assert.equal(formatLoss(0), '0%');
  assert.equal(formatLoss(0.0004), '<0.1%');
  assert.equal(formatLoss(0.003), '0.3%');
  assert.equal(formatLoss(0.25), '25%');
});

test('the scale ends on a round number with even ticks', () => {
  assert.deepEqual(niceScale(113), { max: 150, ticks: [0, 50, 100, 150] });
  assert.deepEqual(niceScale(148), { max: 200, ticks: [0, 50, 100, 150, 200] });
  assert.deepEqual(niceScale(6, 25), { max: 30, ticks: [0, 10, 20, 30] });
  assert.equal(niceScale(0).ticks[0], 0);
});

test('clock marks fall on round times and clear of "now"', () => {
  const start = Date.UTC(2026, 10, 5, 7, 49) / 1000;
  const hour = timeTicks(start, start + 3600);
  assert.ok(hour.length >= 3 && hour.length <= 4);
  for (const t of hour) assert.equal((t.t - new Date(t.t * 1000).getTimezoneOffset() * 60) % 900, 0);
  assert.ok(hour.every((t) => t.t > start && t.t < start + 3600 * 0.95));
  assert.equal(timeTicks(start, start + 86400).length, 6);
  // a mark a day, minus the one that would sit on "now"
  assert.equal(timeTicks(start, start + 7 * 86400).length, 6);
});

test('loss marks count only lines that can lose, in the slice they happened', () => {
  const lost = line([at(0, 1), at(500)]);
  const silent = line([at(100), at(900)], { countLoss: false });
  assert.deepEqual(lossBins([lost, silent], 0, 1000, 10), [{ from: 500, to: 600, share: 1 }]);
  assert.deepEqual(lossBins([silent], 0, 1000, 10), []);
});

test('a slice of the loss strip says what each line lost in it', () => {
  const us = line([at(150, 75), at(160), at(170, 80), at(500)], { label: 'US' });
  const uk = line([at(150, 6), at(160, 6)], { key: 'uk', label: 'UK' });
  const silent = line([at(160)], { key: 'gw', label: 'Gateway', countLoss: false });
  const got = lossSliceAt([us, uk, silent], 0, 1000, 0.16, 10);
  assert.equal(got.from, 100);
  assert.equal(got.to, 200);
  assert.equal(got.lost, 1);
  assert.equal(got.rounds, 5);
  assert.deepEqual(got.lines, [{ label: 'US', color: 'red', lost: 1, rounds: 3 }]);
  // answered, and nothing asked at all, read differently
  assert.deepEqual(lossSliceAt([uk], 0, 1000, 0.16, 10).lines, []);
  assert.equal(lossSliceAt([uk], 0, 1000, 0.16, 10).rounds, 2);
  assert.equal(lossSliceAt([uk], 0, 1000, 0.9, 10).rounds, 0);
  // the very end of the span is the last slice, as the marks have it
  assert.equal(lossSliceAt([line([at(1000)])], 0, 1000, 1, 10).lost, 1);
  assert.deepEqual(lossBins([line([at(1000)])], 0, 1000, 10), [{ from: 900, to: 1000, share: 1 }]);
});

test('a slice\u2019s time has seconds when it is short and a weekday over a long span', () => {
  const t = Date.UTC(2026, 10, 5, 8, 0) / 1000;
  assert.match(formatSliceTime(t, t + 360, 86400), /^\d\d:\d\d–\d\d:\d\d$/);
  assert.match(formatSliceTime(t, t + 15, 3600), /^\d\d:\d\d:\d\d–\d\d:\d\d:\d\d$/);
  assert.match(formatSliceTime(t, t + 2520, 7 * 86400), /^\S+ \d\d:\d\d–\d\d:\d\d$/);
});

test('hovering finds the nearest point even when the rounds drift off the slots', () => {
  const l = line([at(61, 75), at(122), { t: 183, v: 80, worst: 113, lost: 0, rounds: 3 }]);
  const { values, upper, notes } = slotValues(l, 0, 60, 5, (v) => `${String(v)} ms`);
  assert.deepEqual(values, [75, 75, undefined, 80, 80]);
  assert.deepEqual(upper, [undefined, undefined, undefined, 113, 113]);
  assert.deepEqual(notes, [undefined, undefined, 'lost', 'worst 113 ms', 'worst 113 ms']);
  // far from any point: nothing, rather than the nearest one
  assert.deepEqual(slotValues(line([at(0, 1)]), 0, 60, 8, String).values.slice(3), [undefined, undefined, undefined, undefined, undefined]);
});

test('a second dot only where a point stands for several probes and the worst differs', () => {
  const upper = (p: ChartLine['points'][number]) => slotValues(line([p]), 0, 60, 1, String).upper[0];
  assert.equal(upper({ t: 0, v: 7, worst: 30, lost: 0, rounds: 24 }), 30);
  assert.equal(upper({ t: 0, v: 7, worst: 7, lost: 0, rounds: 24 }), undefined);
  assert.equal(upper({ t: 0, v: 7, worst: 30, lost: 0, rounds: 1 }), undefined);
  assert.equal(upper({ t: 0, v: 7, lost: 0, rounds: 1 }), undefined);
});

test('the CSV has a row per time, empty cells where a line was not asked or lost', () => {
  const a = line([at(1000, 7.1234), at(1060)], { label: 'DNS · Cloudflare' });
  const b = line([{ t: 1060, v: 75, worst: 113, lost: 0, rounds: 2 }], { key: 'y', label: 'US' });
  const csv = linesToCsv([a, b]).split('\r\n');
  assert.equal(csv[0], 'local time,unix time,DNS Cloudflare ms,DNS Cloudflare lost,DNS Cloudflare probes,US ms,US worst ms,US lost,US probes');
  assert.match(csv[1] ?? '', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d,1000,7\.123,0,1,,,,$/);
  assert.match(csv[2] ?? '', /,1060,,1,1,75,113,0,2$/);
  assert.equal(csv[3], '');
  assert.equal(csv.length, 4);
});

test('the CSV quotes names and defuses ones a spreadsheet would run', () => {
  const head = (label: string): string => linesToCsv([line([], { label })]).split('\r\n')[0] ?? '';
  assert.match(head('a,"b"'), /"a,""b"" ms"/);
  assert.match(head('=cmd()'), /,'=cmd\(\) ms,/);
});

test('the file is named after what it holds', () => {
  assert.match(csvName('routes', '24h', 1793868560), /^milkflint-routes-24h-\d{4}-\d\d-\d\d-\d{4}\.csv$/);
});
