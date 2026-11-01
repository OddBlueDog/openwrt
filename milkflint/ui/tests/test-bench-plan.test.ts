// The test bench's plans, clock sync, device names and run timing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Clock, estimate } from '../src/features/test-bench/clock.ts';
import {
  buildPlan,
  d2dPairs,
  fitLabel,
  MAX_PHASE_S,
  MAX_RUN_S,
  MIN_PHASE_S,
  phaseAt,
  type PlanMember,
  presets,
  scheduleLength,
} from '../src/features/test-bench/plans.ts';
import { memberRecords, memberTiming } from '../src/features/test-bench/timing.ts';
import { agentText, parseAgent } from '../src/features/test-bench/ua.ts';

const mac: PlanMember = { id: 'm1', name: 'Mac', wired: true };
const phone: PlanMember = { id: 'm2', name: 'iPhone', wired: false };
const pc: PlanMember = { id: 'm3', name: 'PC', wired: true };
const tablet: PlanMember = { id: 'm4', name: 'iPad', wired: false };

// ---- Clock sync ----

test('the clock offset comes from the shortest round trip, to within half of it', () => {
  // router = local + 1000; answers made halfway, except the slow one's
  const e = estimate([
    { sent: 0, received: 40, router: 1030 },
    { sent: 100, received: 104, router: 1102 },
    { sent: 200, received: 230, router: 1205 },
  ]);
  assert.ok(e !== undefined);
  assert.equal(e.offset, 1000);
  assert.equal(e.uncertainty, 2);
  assert.equal(e.at, 104);
});

test('no samples, or only impossible ones, give no estimate', () => {
  assert.equal(estimate([]), undefined);
  assert.equal(estimate([{ sent: 10, received: 5, router: 100 }]), undefined);
});

test('a clock keeps its newest samples, so an old lucky one ages out', () => {
  const c = new Clock();
  c.add({ sent: 0, received: 1, router: 500.5 });
  for (let i = 1; i <= 16; i++) c.add({ sent: i * 100, received: i * 100 + 10, router: i * 100 + 5 + 2000 });
  assert.equal(c.estimate?.offset, 2000);
  assert.equal(c.router(0), 2000);
  assert.equal(c.local(2500), 500);
});

// ---- Plans ----

test('every preset builds a schedule the router takes: phases in order, within its limits', () => {
  const groups = [[mac], [phone], [mac, phone], [mac, phone, pc, tablet]];
  for (const p of presets) {
    for (const members of groups) {
      const { schedule } = buildPlan(p.id, members, true);
      assert.ok(schedule.phases.length > 0, p.id);
      let at = 0;
      for (const ph of schedule.phases) {
        assert.ok(ph.start >= at, `${p.id}: ${ph.kind} starts before the one before it ends`);
        assert.ok(ph.dur >= MIN_PHASE_S * 1000 && ph.dur <= MAX_PHASE_S * 1000, `${p.id}: ${ph.kind} lasts ${String(ph.dur)}`);
        for (const id of Object.keys(ph.roles)) assert.ok(members.some((m) => m.id === id), `${p.id}: role for ${id}`);
        assert.ok(new TextEncoder().encode(ph.label ?? '').length <= 48);
        at = ph.start + ph.dur;
      }
      assert.ok(scheduleLength(schedule) <= MAX_RUN_S * 1000, p.id);
      assert.equal(schedule.dry, true);
    }
  }
});

test('a quick check loads the wired device and runs about a minute', () => {
  const { schedule } = buildPlan('quick', [phone, mac], false);
  const down = schedule.phases.find((p) => p.kind === 'wan_down');
  assert.deepEqual(down?.roles, { m1: 'down' });
  assert.equal(schedule.dry, false);
  const s = scheduleLength(schedule) / 1000;
  assert.ok(s >= 45 && s <= 75, String(s));
});

test('Wi-Fi vs wired loads each kind in turn, then pairs them', () => {
  const { schedule, notes } = buildPlan('wifi-wired', [mac, phone, tablet], true);
  const downs = schedule.phases.filter((p) => p.kind === 'wan_down').map((p) => Object.keys(p.roles));
  assert.deepEqual(downs, [['m1'], ['m2']]);
  const pairs = schedule.phases.filter((p) => p.kind === 'd2d').map((p) => p.pair);
  assert.deepEqual(pairs, [
    ['m1', 'm2'],
    ['m1', 'm2'],
    ['m2', 'm4'],
    ['m2', 'm4'],
  ]);
  assert.equal(notes.length, 0);
  // a connect phase before the first device-to-device phase, for everyone in a pair
  const connect = schedule.phases.findIndex((p) => p.kind === 'connect');
  assert.ok(connect >= 0 && connect < schedule.phases.findIndex((p) => p.kind === 'd2d'));
  assert.deepEqual(Object.keys(schedule.phases[connect]?.roles ?? {}).sort(), ['m1', 'm2', 'm4']);
});

test('Wi-Fi vs wired says what it needs when a kind is missing', () => {
  const { notes } = buildPlan('wifi-wired', [mac, pc], true);
  assert.ok(notes.some((n) => n.includes('needs a wired device and a Wi-Fi one')));
});

test('device-to-device pairs: Wi-Fi with wired first, the wired end first', () => {
  const pairs = d2dPairs([phone, tablet, mac, pc], 3).map(([a, b]) => `${a.id}-${b.id}`);
  assert.deepEqual(pairs.slice(0, 3), ['m1-m2', 'm3-m2', 'm1-m4']);
  assert.deepEqual(d2dPairs([mac]), []);
});

test('a busy household has one downloader, one uploader, a pair, and the rest browsing', () => {
  const { schedule } = buildPlan('full', [mac, phone, pc, tablet], true);
  const h = schedule.phases.find((p) => p.kind === 'household');
  assert.deepEqual(h?.roles, { m1: 'down', m2: 'up', m3: 'a', m4: 'b' });
  assert.deepEqual(h.pair, ['m3', 'm4']);
});

test('a custom plan with nothing ticked still idles, then cools down', () => {
  const { schedule } = buildPlan('custom', [mac], true, {
    idleS: 0,
    loadS: 10,
    download: false,
    upload: false,
    both: false,
    everyone: false,
    d2d: false,
    dns: false,
    household: false,
  });
  assert.deepEqual(
    schedule.phases.map((p) => p.kind),
    ['idle', 'cooldown'],
  );
});

test('labels are cut to what the router takes, at a character', () => {
  assert.equal(fitLabel('Download · Mac'), 'Download · Mac');
  const long = fitLabel(`Download · ${'é'.repeat(40)}`);
  assert.ok(new TextEncoder().encode(long).length <= 48);
  assert.ok(long.endsWith('…'));
});

test('the phase at a time: none before the start or after the end', () => {
  const s = { phases: [{ start: 0, dur: 1000 }, { start: 1000, dur: 2000 }] };
  assert.equal(phaseAt(s, -1), -1);
  assert.equal(phaseAt(s, 0), 0);
  assert.equal(phaseAt(s, 1500), 1);
  assert.equal(phaseAt(s, 3000), -1);
});

// ---- Devices ----

test('user agents name the device and browser', () => {
  const cases: [string, boolean, string, string][] = [
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      false,
      'Mac',
      'Safari 26 on macOS',
    ],
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      true,
      'iPad',
      'Safari 26 on iPadOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
      true,
      'iPhone',
      'Safari 18 on iOS',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      true,
      'iPhone',
      'Chrome 141 on iOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      false,
      'Windows PC',
      'Edge 141 on Windows',
    ],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0', false, 'Windows PC', 'Firefox 144 on Windows'],
    [
      'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      true,
      'Android phone',
      'Chrome 141 on Android',
    ],
  ];
  for (const [ua, touch, label, text] of cases) {
    const a = parseAgent(ua, touch);
    assert.equal(a.label, label, ua);
    assert.equal(agentText(a), text, ua);
  }
  assert.equal(agentText(parseAgent(undefined)), 'Unknown browser');
});

// ---- Run timing ----

const line = (seq: number, records: unknown[]): string => JSON.stringify({ m: 'm1', seq, records });

test("a member's records: each report once, in order, broken lines and unknown records skipped", () => {
  const lines = [
    line(1, [['mark', 1, 2000, 2003, 1.5]]),
    line(0, [['mark', 0, 1000, 1001, 1], ['bogus', 1]]),
    line(1, [['mark', 1, 2000, 9999, 1.5]]),
    '{not json',
    line(2, [['end', 3000, 'completed'], ['mark', 'x', 1, 2, 3]]),
  ];
  assert.deepEqual(memberRecords(lines), [
    ['mark', 0, 1000, 1001, 1],
    ['mark', 1, 2000, 2003, 1.5],
    ['end', 3000, 'completed'],
  ]);
});

test('timing: typical and worst start error, phases missed, hidden and lost pages', () => {
  const t = memberTiming(
    [
      ['mark', 0, 1000, 1002, 1],
      ['mark', 1, 2000, 1995, 3],
      ['mark', 1, 2000, 2100, 3],
      ['hidden', 2500],
      ['lost', 2600],
      ['end', 3000, 'stopped by Mac'],
      ['end', 3100, 'later'],
    ],
    3,
  );
  assert.equal(t.marked, 2);
  assert.equal(t.phases, 3);
  assert.equal(t.skewMedian, -1.5);
  assert.equal(t.skewWorst, -5);
  assert.equal(t.uncertainty, 3);
  assert.equal(t.hidden, true);
  assert.equal(t.lost, true);
  assert.equal(t.ended, 'stopped by Mac');
  assert.equal(memberTiming([], 2).skewMedian, undefined);
});
