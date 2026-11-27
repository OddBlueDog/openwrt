// The Data Usage page's 24-hour history: the per-device windows (busiest first, router buckets left out),
// the chart's 5-minute grid (zero while the history ran, nothing before it), and the "History since" line.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chartSeries,
  HISTORY_POLL_MS,
  sinceText,
  volume,
  windowColumns,
  windowRows,
  type History,
} from '../src/features/data-statistics/history.ts';

const w = (d24: number, u24 = 0): History['windows'][string] => ({
  h1: [d24 / 24, 0],
  h4: [d24 / 6, 0],
  h8: [d24 / 3, 0],
  h24: [d24, u24],
});
const history = (over: Partial<History> = {}): History => ({ on: true, since: 1000, windows: {}, series: [], ...over });

test('windowRows: busiest 24 h (down + up) first, names found by MAC whatever its case', () => {
  const h = history({ windows: { 'aa:bb:cc:dd:ee:01': w(100), 'AA:BB:CC:DD:EE:02': w(50, 80), 'aa:bb:cc:dd:ee:03': w(10) } });
  const rows = windowRows(h, new Map([['aa:bb:cc:dd:ee:02', 'Kitchen iPad']]));
  assert.deepEqual(
    rows.map((r) => r.mac),
    ['aa:bb:cc:dd:ee:02', 'aa:bb:cc:dd:ee:01', 'aa:bb:cc:dd:ee:03'],
  );
  assert.equal(rows[0]?.name, 'Kitchen iPad');
  assert.equal(rows[1]?.name, undefined);
});

test('windowRows: the all-zero bucket and the router’s own MACs are left out', () => {
  const h = history({ windows: { '00:00:00:00:00:00': w(900), 'aa:bb:cc:dd:ee:09': w(800), 'aa:bb:cc:dd:ee:01': w(1) } });
  const rows = windowRows(h, new Map(), new Set(['AA:BB:CC:DD:EE:09']));
  assert.deepEqual(
    rows.map((r) => r.mac),
    ['aa:bb:cc:dd:ee:01'],
  );
});

test('windowColumns: Device, 1 h, 4 h, 8 h, 24 h, with the first and last kept when compact', () => {
  assert.deepEqual(
    windowColumns.map((c) => c.label),
    ['Device', '1 h', '4 h', '8 h', '24 h'],
  );
  assert.deepEqual(
    windowColumns.filter((c) => c.compact === true).map((c) => c.label),
    ['Device', '24 h'],
  );
  const row = windowRows(history({ windows: { 'aa:bb:cc:dd:ee:01': { ...w(0), h24: [1536, 1024] } } }), new Map())[0];
  assert.ok(row);
  assert.equal(volume(row.h24), '↓ 1.5 KB · ↑ 1 KB');
  // drawn with arrow icons that screen readers say as words, not as characters
  assert.equal(typeof windowColumns[4]?.cell(row), 'object');
});

test('the page asks every 5 minutes, not faster', () => {
  assert.equal(HISTORY_POLL_MS, 300_000);
});

test('sinceText: says when the history began, and nothing once it has run a day', () => {
  const now = 1_794_929_400;
  assert.match(sinceText(now - 3600, now), /^History since \d\d:\d\d$/);
  assert.equal(sinceText(now - 90_000, now), '');
  assert.equal(sinceText(now - 86_400, now), '');
  assert.equal(sinceText(null, now), '');
});

test('sinceText: the router only reads lines under 24 h old, so "since" never reaches a day; it hides within two steps of it', () => {
  const now = 1_794_929_400;
  assert.match(sinceText(now - 80_000, now), /^History since /);
  assert.equal(sinceText(now - 86_100, now), '');
  assert.equal(sinceText(now - 86_400 + 301, now), '');
});

test('chartSeries: 5-minute steps over the last day; a quiet step is 0 once the history ran, nothing before', () => {
  const now = 1_794_929_400 + 100; // 100 s into a step
  const step = 1_794_929_400;
  const since = step - 3600; // began an hour ago
  const s = chartSeries(history({ since, series: [[step - 1800, 3000, 600]] }), now);
  assert.equal(s.to, now);
  assert.equal(s.from, now - 86_400);
  const at = (t: number): readonly [number, number | null] | undefined => s.down.find((p) => p[0] === t);
  // before it began: no value at all
  assert.equal(at(step - 7200)?.[1], null);
  assert.equal(at(step - 3900)?.[1], null);
  // from when it began: zero where nothing moved
  assert.equal(at(step - 3600)?.[1], 0);
  assert.equal(at(step - 3000)?.[1], 0);
  // the step with a point: bits per second over the 300 s step
  assert.equal(at(step - 1800)?.[1], (3000 * 8) / 300);
  assert.equal(s.up.find((p) => p[0] === step - 1800)?.[1], (600 * 8) / 300);
  // steps run in order, 300 s apart, and the last one is the current step
  assert.equal(s.down[s.down.length - 1]?.[0], step);
  assert.ok(s.down.every((p, i) => i === 0 || p[0] - (s.down[i - 1]?.[0] ?? 0) === 300));
  assert.equal(s.down.length, 289);
});

test('chartSeries: no history running draws nothing; points in the same step add up', () => {
  const now = 1_794_929_400;
  assert.ok(chartSeries(history({ since: null }), now).down.every((p) => p[1] === null));
  const s = chartSeries(
    history({
      since: now - 1000,
      series: [
        [now - 600, 300, 0],
        [now - 590, 300, 0],
      ],
    }),
    now,
  );
  assert.equal(s.down.find((p) => p[0] === now - 600)?.[1], (600 * 8) / 300);
});
