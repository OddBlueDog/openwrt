// The Radios & SSIDs page's airtime fairness: the band's switch as the router
// service reads it, and what the card makes of the service's figures (a weight
// in words, the bar of the last second's air, the list's order, the strip).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AIRTIME_BAND_KEYS,
  AIRTIME_CLASS_LABELS,
  AIRTIME_CLASSES,
  AIRTIME_STRIP_MARKS,
  type AirtimeBands,
  type AirtimeClass,
  type AirtimeUse,
  airtimeAgo,
  airtimeAutoOption,
  airtimeAutoPaceRate,
  airtimeAutoShare,
  airtimeBandDefaults,
  airtimeBandOption,
  airtimeBandValues,
  airtimeBandsAreDefault,
  airtimeBandsErrors,
  airtimeBandsOf,
  airtimeBandsReset,
  airtimeByClass,
  airtimeChainsWords,
  airtimeChannelsLabel,
  airtimeClassHint,
  airtimeColumns,
  airtimeDoing,
  airtimeHeldWords,
  airtimePacePercent,
  airtimeState,
  airtimeKey,
  airtimeLabel,
  airtimeOf,
  airtimeOption,
  airtimeSecondParts,
  airtimeSecondTotal,
  airtimeSegments,
  airtimeShare,
  airtimeShareWords,
  airtimeSignalLevel,
  airtimeSignalWords,
  airtimeSorted,
  airtimeStrengthOf,
  airtimeTrimWords,
  airtimeValue,
  airtimeWeightPart,
} from '../src/features/wifi/airtime.ts';

function device(mac: string, name: string | null, cls: AirtimeClass, air_tx: number, air_rx = 0): AirtimeUse {
  return { mac, name, class: cls, air_tx, air_rx };
}

/** Figures added up in floating point: equal to a millionth */
function near(actual: number, expected: number, message?: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${String(actual)} is not ${String(expected)}`);
}

test('airtime: each band has its own option', () => {
  assert.equal(airtimeOption('2g'), 'airtime_2g');
  assert.equal(airtimeOption('5g'), 'airtime_5g');
  assert.equal(airtimeOption('6g'), 'airtime_6g');
});

test('airtime: only 1 is on, as the service reads it', () => {
  assert.equal(airtimeOf('1'), true);
  assert.equal(airtimeOf(undefined), false);
  for (const value of ['0', '', 'on', 'true', 'yes', 'enabled', ' 1', '1 ', '01', '2']) assert.equal(airtimeOf(value), false, JSON.stringify(value));
});

test('airtime: on writes 1, off leaves the option unset', () => {
  assert.equal(airtimeValue(true), '1');
  assert.equal(airtimeValue(false), undefined);
});

test('airtime: the switch reads back what it wrote', () => {
  assert.equal(airtimeOf(airtimeValue(true)), true);
  assert.equal(airtimeOf(airtimeValue(false)), false);
});

test('airtime: every class has a label and says what it gets', () => {
  assert.deepEqual(AIRTIME_CLASSES, ['full', 'slow', 'weak', 'lost']);
  for (const cls of AIRTIME_CLASSES) {
    assert.notEqual(AIRTIME_CLASS_LABELS[cls], '');
    assert.match(airtimeClassHint(cls), /share/);
    // being held back is only said where the driver can do it, and never of a good link
    assert.doesNotMatch(airtimeClassHint(cls), /held back/i, cls);
    assert.equal(/held back/i.test(airtimeClassHint(cls, true)), cls !== 'full', cls);
  }
  // the router's own words for a reduced device
  assert.equal(AIRTIME_CLASS_LABELS.slow.toLowerCase(), 'slow link');
  assert.equal(AIRTIME_CLASS_LABELS.weak.toLowerCase(), 'weak link');
  assert.equal(AIRTIME_CLASS_LABELS.lost.toLowerCase(), 'not answering');
});

test('airtime: what is done besides the share, and what would be where the policy is off', () => {
  assert.equal(airtimeDoing('full', true), undefined);
  assert.equal(airtimeDoing('slow', true), undefined);
  assert.equal(airtimeDoing('weak', true), 'Kept to a frame or two in the radio at a time.');
  // with a driver that takes a number of sends per device, that's said too
  assert.equal(airtimeDoing('weak', true, { tries: 6 }), 'Kept to a frame or two in the radio at a time. Each frame is sent at most 6 times.');
  assert.match(airtimeDoing('lost', true, { tries: 2 }) ?? '', /until it answers\. Each frame is sent at most 2 times\.$/);
  assert.match(airtimeDoing('lost', true, { tries: 1 }) ?? '', /Each frame is sent once\.$/);
  // not where the policy is off, whatever the reply says
  assert.doesNotMatch(airtimeDoing('weak', false, { tries: 6, pace: 238 }) ?? '', /sent|Held to/);
  assert.match(airtimeDoing('lost', true) ?? '', /^Kept to one frame in the radio at a time/);
  // nothing would change for a good link
  assert.equal(airtimeDoing('full', false), undefined);
  for (const cls of ['slow', 'weak', 'lost'] as const) assert.match(airtimeDoing(cls, false) ?? '', /^With the policy on: /, cls);
  assert.match(airtimeDoing('weak', false) ?? '', /a frame or two in the radio at a time/);
});

test('airtime: a paced device says its part of the time, and how long it was held back', () => {
  // thousandths of the time as a whole percent, never "0%"
  assert.equal(airtimePacePercent(238), '24%');
  assert.equal(airtimePacePercent(111), '11%');
  assert.equal(airtimePacePercent(385), '39%');
  assert.equal(airtimePacePercent(3), '1%');
  // a slow link has nothing else done to it: the pacing is its whole line
  assert.equal(airtimeDoing('slow', true, { pace: 333 }), 'Held to 33% of the time while a device with a good link is waiting.');
  assert.equal(
    airtimeDoing('weak', true, { tries: 6, pace: 238 }),
    'Kept to a frame or two in the radio at a time. Held to 24% of the time while a device with a good link is waiting. Each frame is sent at most 6 times.',
  );
  assert.match(airtimeDoing('lost', true, { tries: 2, pace: 111 }) ?? '', /until it answers\. Held to 11% of the time .* Each frame is sent at most 2 times\.$/);
  // a good link is never paced, whatever the reply says
  assert.equal(airtimeDoing('full', true, { pace: 500 }), undefined);
  // off: only that it would be, where the driver can and the policy would
  assert.equal(airtimeDoing('slow', false), 'With the policy on: a reduced share.');
  assert.equal(airtimeDoing('slow', false, { wouldPace: true }), 'With the policy on: a reduced share, and held back while a device with a good link is waiting.');
  assert.match(airtimeDoing('weak', false, { wouldPace: true }) ?? '', /a frame or two in the radio at a time, and held back while/);
  assert.match(airtimeDoing('lost', false, { wouldPace: true }) ?? '', /until it answers, and held back while/);
  assert.doesNotMatch(airtimeDoing('weak', false, { wouldPace: true, pace: 238 }) ?? '', /Held to/);
  // how long it was held: nothing for under half a percent of the second
  assert.equal(airtimeHeldWords(0), undefined);
  assert.equal(airtimeHeldWords(0.004), undefined);
  assert.equal(airtimeHeldWords(0.005), 'Held back for 1% of the last second.');
  assert.equal(airtimeHeldWords(0.84), 'Held back for 84% of the last second.');
  assert.equal(airtimeHeldWords(1.7), 'Held back for 100% of the last second.');
  assert.equal(airtimeHeldWords(Number.NaN), undefined);
});

test('airtime: a weight in words, at each boundary', () => {
  // only 256 is a full share
  assert.equal(airtimeShareWords(256), 'a full share');
  assert.equal(airtimeShareWords(300), 'a full share');
  assert.equal(airtimeShareWords(255), 'about three quarters of a share');
  assert.equal(airtimeShareWords(224), 'about three quarters of a share');
  assert.equal(airtimeShareWords(192), 'about three quarters of a share');
  assert.equal(airtimeShareWords(160), 'about three quarters of a share');
  assert.equal(airtimeShareWords(159), 'about half a share');
  assert.equal(airtimeShareWords(128), 'about half a share');
  assert.equal(airtimeShareWords(96), 'about half a share');
  assert.equal(airtimeShareWords(95), 'about a quarter of a share');
  assert.equal(airtimeShareWords(64), 'about a quarter of a share');
  // a weak device's floor is above the smallest
  assert.equal(airtimeShareWords(48), 'about a quarter of a share');
  assert.equal(airtimeShareWords(33), 'about a quarter of a share');
  // only the policy's lowest is the smallest
  assert.equal(airtimeShareWords(32), 'the smallest share');
  assert.equal(airtimeShareWords(0), 'the smallest share');
});

test('airtime: a weight as the part of a full share, for the meter', () => {
  assert.equal(airtimeWeightPart(256), 1);
  assert.equal(airtimeWeightPart(128), 0.5);
  assert.equal(airtimeWeightPart(32), 0.125);
  assert.equal(airtimeWeightPart(512), 1);
  assert.equal(airtimeWeightPart(-1), 0);
});

test('airtime: a device’s share is what the router sent to it and what it sent', () => {
  near(airtimeShare({ air_tx: 0.2, air_rx: 0.05 }), 0.25);
  assert.equal(airtimeShare({ air_tx: 0, air_rx: 0 }), 0);
  // never more than the second, nor less than none of it
  assert.equal(airtimeShare({ air_tx: 0.8, air_rx: 0.7 }), 1);
  assert.equal(airtimeShare({ air_tx: -0.1, air_rx: 0 }), 0);
  assert.equal(airtimeShare({ air_tx: Number.NaN, air_rx: 0.1 }), 0);
});

test('airtime: the air each class took', () => {
  const byClass = airtimeByClass([
    device('aa', 'tv', 'full', 0.2, 0.1),
    device('bb', 'laptop', 'full', 0.1),
    device('cc', 'camera', 'weak', 0.05),
    device('dd', null, 'lost', 0.02),
  ]);
  near(byClass.full, 0.4);
  assert.equal(byClass.slow, 0);
  near(byClass.weak, 0.05);
  near(byClass.lost, 0.02);
});

test('airtime: the bar is the devices, then other networks and noise, then what was free', () => {
  const tv = device('aa', 'tv', 'full', 0.2, 0.1);
  const camera = device('cc', 'camera', 'weak', 0.1);
  const segments = airtimeSegments([tv, camera], 0.6);
  assert.deepEqual(
    segments.map((s) => [s.kind, s.key, s.label]),
    [
      ['device', 'aa', 'tv'],
      ['device', 'cc', 'camera'],
      ['other', 'other', 'Other networks and noise'],
      ['free', 'free', 'Free'],
    ],
  );
  const [first, second, other, free] = segments;
  near(first?.share ?? -1, 0.3);
  near(second?.share ?? -1, 0.1);
  // busy 0.6, of which the devices' 0.4
  near(other?.share ?? -1, 0.2);
  near(free?.share ?? -1, 0.4);
  // nothing to scale: each part of the bar is its share, and they fill it
  for (const s of segments) near(s.width, s.share, s.key);
  near(
    segments.reduce((n, s) => n + s.width, 0),
    1,
  );
  assert.equal(first?.kind === 'device' ? first.device : undefined, tv);
});

test('airtime: a device on two of a radio’s networks for a moment is two segments', () => {
  assert.equal(airtimeKey({ mac: 'aa' }), 'aa');
  assert.equal(airtimeKey({ mac: 'aa', dev: '' }), 'aa');
  assert.equal(airtimeKey({ mac: 'aa', dev: 'phy1-ap0' }), 'phy1-ap0 aa');
  const segments = airtimeSegments([{ ...device('aa', 'phone', 'full', 0.1), dev: 'phy1-ap0' }, { ...device('aa', 'phone', 'full', 0), dev: 'phy1-ap1' }], null);
  assert.deepEqual(
    segments.map((s) => s.key),
    ['phy1-ap0 aa', 'phy1-ap1 aa', 'free'],
  );
});

test('airtime: the bar without the channel’s busy share has no other networks', () => {
  const segments = airtimeSegments([device('aa', 'tv', 'full', 0.25)], null);
  assert.deepEqual(
    segments.map((s) => s.kind),
    ['device', 'free'],
  );
  const free = segments.at(-1);
  near(free?.share ?? -1, 0.75);
  // what's left isn't known to be free
  assert.equal(free?.label, 'Not used by this band’s devices');
});

test('airtime: devices that took more than the channel was busy leave nothing for other networks', () => {
  const segments = airtimeSegments([device('aa', 'tv', 'full', 0.3, 0.2)], 0.4);
  const other = segments.find((s) => s.kind === 'other');
  const free = segments.find((s) => s.kind === 'free');
  assert.deepEqual([other?.share, other?.width], [0, 0]);
  near(free?.share ?? -1, 0.5);
});

test('airtime: shares that add up to more than the second fill the bar, to scale', () => {
  const segments = airtimeSegments([device('aa', 'a', 'full', 0.9), device('bb', 'b', 'slow', 0.6)], 1);
  const [a, b, other, free] = segments;
  near(a?.share ?? -1, 0.9);
  near(a?.width ?? -1, 0.6);
  near(b?.width ?? -1, 0.4);
  assert.equal(other?.width, 0);
  assert.equal(free?.width, 0);
  near(
    segments.reduce((n, s) => n + s.width, 0),
    1,
  );
});

test('airtime: a band without devices is other networks and free air', () => {
  assert.deepEqual(
    airtimeSegments([], 0.3).map((s) => [s.kind, s.share]),
    [
      ['other', 0.3],
      ['free', 0.7],
    ],
  );
  assert.deepEqual(
    airtimeSegments([], null).map((s) => [s.kind, s.share]),
    [['free', 1]],
  );
  // a busy share out of range counts as all of the second
  assert.equal(airtimeSegments([], 1.4).find((s) => s.kind === 'other')?.share, 1);
});

test('airtime: the bar keeps devices in class order, then by name, whatever air they took', () => {
  const segments = airtimeSegments(
    [
      device('04', null, 'full', 0),
      device('01', 'zoe', 'lost', 0.3),
      device('02', 'Bea', 'full', 0.01),
      device('03', 'adam', 'full', 0.2),
      device('05', 'kit', 'slow', 0.1),
      device('06', 'ann', 'weak', 0.02),
    ],
    null,
  );
  assert.deepEqual(
    segments.map((s) => s.label),
    ['adam', 'Bea', '04', 'kit', 'ann', 'zoe', 'Not used by this band’s devices'],
  );
  // a device that used none has its segment too, with no width
  assert.equal(segments.find((s) => s.key === '04')?.width, 0);
});

test('airtime: the list has the most airtime first, then by name', () => {
  const order = (devices: AirtimeUse[]): string[] => airtimeSorted(devices).map((d) => d.name ?? d.mac);
  assert.deepEqual(
    order([device('01', 'phone', 'full', 0.05), device('02', 'tv', 'full', 0.2, 0.2), device('03', 'camera', 'weak', 0.1), device('04', 'laptop', 'slow', 0.05)]),
    ['tv', 'camera', 'laptop', 'phone'],
  );
  // names without regard to case, numbers in them by value, unnamed devices last by address
  assert.deepEqual(
    order([device('0b', null, 'full', 0), device('01', 'zed', 'full', 0), device('0a', null, 'full', 0), device('02', 'Amy', 'full', 0), device('03', 'tv 10', 'full', 0), device('04', 'tv 2', 'full', 0)]),
    ['Amy', 'tv 2', 'tv 10', 'zed', '0a', '0b'],
  );
});

test('airtime: devices showing the same percent keep their order by name', () => {
  // 0.1% and 0.4% both show as 0%: the smaller one doesn't move down for it
  assert.deepEqual(
    airtimeSorted([device('01', 'b', 'full', 0.004), device('02', 'a', 'full', 0.001), device('03', 'c', 'full', 0.006)]).map((d) => d.name),
    ['c', 'a', 'b'],
  );
});

test('airtime: sorting leaves the router’s list as it was', () => {
  const devices = [device('01', 'b', 'full', 0), device('02', 'a', 'full', 0.5)];
  const sorted = airtimeSorted(devices);
  assert.deepEqual(
    devices.map((d) => d.mac),
    ['01', '02'],
  );
  assert.deepEqual(
    sorted.map((d) => d.mac),
    ['02', '01'],
  );
  airtimeSegments(devices, null);
  assert.deepEqual(
    devices.map((d) => d.mac),
    ['01', '02'],
  );
});

test('airtime: the last minute’s columns end at the newest second', () => {
  assert.deepEqual(airtimeColumns([1, 2, 3], 5), [undefined, undefined, 1, 2, 3]);
  assert.deepEqual(airtimeColumns([1, 2, 3], 3), [1, 2, 3]);
  assert.deepEqual(airtimeColumns([1, 2, 3, 4, 5], 3), [3, 4, 5]);
  assert.deepEqual(airtimeColumns([], 2), [undefined, undefined]);
  assert.deepEqual(airtimeColumns([1, 2], 0), []);
});

test('airtime: a second’s total and its breakdown, on a scale that is always all of the air', () => {
  near(airtimeSecondTotal({ t: 1, full: 0.2, slow: 0.1, weak: 0.05, lost: 0.01 }), 0.36);
  assert.equal(airtimeSecondTotal({ t: 1, full: 0, slow: 0, weak: 0, lost: 0 }), 0);
  // the marks at the strip's sides: all of the air at the top, then each quarter
  assert.deepEqual([...AIRTIME_STRIP_MARKS], [1, 0.75, 0.5, 0.25]);
  // the breakdown of a second, in full and in the bar's order: every class, other networks and noise, what was free
  const parts = airtimeSecondParts({ t: 1, full: 0.2, slow: 0, weak: 0.05, lost: 0, other: 0.15 });
  assert.deepEqual(
    parts.map((p) => p.key),
    ['full', 'slow', 'weak', 'lost', 'other', 'free'],
  );
  assert.deepEqual(
    parts.map((p) => p.label),
    ['Good link', 'Slow link', 'Weak link', 'Not answering', 'Other networks and noise', 'Free'],
  );
  const shares = parts.map((p) => p.share);
  near(shares[0] ?? -1, 0.2);
  assert.equal(shares[1], 0);
  near(shares[2] ?? -1, 0.05);
  assert.equal(shares[3], 0);
  near(shares[4] ?? -1, 0.15);
  near(shares[5] ?? -1, 0.6);
  // a second the channel wasn't read in: the devices' air is known, the rest isn't
  for (const second of [
    { t: 1, full: 0.3, slow: 0, weak: 0, lost: 0 },
    { t: 1, full: 0.3, slow: 0, weak: 0, lost: 0, other: null },
  ]) {
    const unread = airtimeSecondParts(second);
    near(unread[0]?.share ?? -1, 0.3);
    assert.equal(unread.find((p) => p.key === 'other')?.share, null);
    assert.equal(unread.find((p) => p.key === 'free')?.share, null);
  }
  // more than the whole second leaves nothing free; a figure below zero is none
  assert.equal(airtimeSecondParts({ t: 1, full: 0.9, slow: 0, weak: 0, lost: 0, other: 0.4 }).find((p) => p.key === 'free')?.share, 0);
  assert.equal(airtimeSecondParts({ t: 1, full: -0.3, slow: 0.5, weak: 0, lost: 0, other: -1 })[0]?.share, 0);
  assert.equal(airtimeSecondParts({ t: 1, full: 0, slow: 0, weak: 0, lost: 0, other: -1 }).find((p) => p.key === 'other')?.share, 0);
  // and when it was
  assert.equal(airtimeAgo(0), 'The last second');
  assert.equal(airtimeAgo(1), '1 s ago');
  assert.equal(airtimeAgo(59), '59 s ago');
});

test('a band is on only where the switch is on and the driver has weights to set', () => {
  assert.equal(airtimeState(true, true), 'on');
  assert.equal(airtimeState(false, true), 'watching');
  assert.equal(airtimeState(false, false), 'watching');
  // switched on, a driver without airtime weights: said so, not shown as applied
  assert.equal(airtimeState(true, false), 'unsupported');
});

test('airtime: the router\u2019s own figure for other networks is used where it has one', () => {
  // busy 60%, the devices' figures add up to 20%, but the radio itself says
  // only 5% was other networks: the rest was its own sending, not a neighbour's
  const segments = airtimeSegments([device('aa', 'tv', 'full', 0.2)], 0.6, 0.05);
  const other = segments.find((s) => s.kind === 'other');
  const free = segments.find((s) => s.kind === 'free');
  near(other?.share ?? -1, 0.05);
  near(free?.share ?? -1, 0.75);
  // without a busy figure there is no such segment, whatever else is said
  assert.equal(airtimeSegments([device('aa', 'tv', 'full', 0.2)], null, 0.05).find((s) => s.kind === 'other'), undefined);
});

test('airtime: a slow link the policy paces is called very slow', () => {
  assert.equal(airtimeLabel('slow'), 'Slow link');
  assert.equal(airtimeLabel('slow', true), 'Very slow link');
  // the other classes keep their names, paced or not
  assert.equal(airtimeLabel('weak', true), 'Weak link');
  assert.equal(airtimeLabel('lost', true), 'Not answering');
  assert.equal(airtimeLabel('full', true), 'Good link');
});

test('airtime: a band’s settings as saved, the defaults for what is unset', () => {
  // the service's own defaults: lower rates on 2.4 GHz, the same goals
  assert.deepEqual(airtimeBandDefaults('5g'), { full: '60', pace: '30', weak: '12', goal_slow: '17', goal_weak: '12', goal_lost: '5', auto: 'manual' });
  assert.deepEqual(airtimeBandDefaults('6g'), airtimeBandDefaults('5g'));
  assert.deepEqual(airtimeBandDefaults('2g'), { full: '15', pace: '8', weak: '4', goal_slow: '17', goal_weak: '12', goal_lost: '5', auto: 'manual' });
  assert.equal(airtimeBandOption('5g', 'goal_weak'), 'airtime_5g_goal_weak');
  const saved: Record<string, string> = { airtime_5g_pace: '45', airtime_5g_goal_lost: '3', airtime_2g_pace: '6' };
  assert.deepEqual(airtimeBandsOf((o) => saved[o], '5g'), { ...airtimeBandDefaults('5g'), pace: '45', goal_lost: '3' });
  // another band's settings are its own
  assert.deepEqual(airtimeBandsOf((o) => saved[o], '2g'), { ...airtimeBandDefaults('2g'), pace: '6' });
  assert.deepEqual(airtimeBandsOf(() => undefined, '6g'), airtimeBandDefaults('6g'));
});

test('airtime: what is wrong with a band’s settings', () => {
  const ok = airtimeBandDefaults('5g');
  const with_ = (over: Partial<AirtimeBands>): AirtimeBands => ({ ...ok, ...over });
  assert.deepEqual(airtimeBandsErrors(ok), {});
  assert.deepEqual(airtimeBandsErrors(airtimeBandDefaults('2g')), {});
  // decimals are fine, and equal rates leave a class empty, which is allowed
  assert.deepEqual(airtimeBandsErrors(with_({ full: '54.5', pace: '30', weak: '30', goal_weak: '7.5' })), {});
  // a rate that isn't a number, is under 1 or too large
  for (const bad of ['', 'abc', '0', '-5', '1e3', '10001', '12 Mbit']) {
    assert.match(airtimeBandsErrors(with_({ full: bad })).full ?? '', /1 to 10000 Mbit\/s/, bad);
  }
  // a goal is 1 to 100%
  for (const bad of ['', '0', '101', 'x', '-1']) assert.equal(airtimeBandsErrors(with_({ goal_weak: bad })).goal_weak, 'Use 1 to 100%.', bad);
  assert.equal(airtimeBandsErrors(with_({ goal_lost: '100' })).goal_lost, undefined);
  // out of order: said at the lower one, and only there
  assert.deepEqual(airtimeBandsErrors(with_({ pace: '80' })), { pace: 'A slow link can’t start above a good one.' });
  assert.deepEqual(airtimeBandsErrors(with_({ weak: '40' })), { weak: 'A very slow link can’t start above a slow one.' });
  // a rate that is wrong by itself isn't also said to be out of order
  assert.deepEqual(Object.keys(airtimeBandsErrors(with_({ full: 'x', pace: '80' }))), ['full']);
});

test('airtime: what a band’s settings save, and the reset', () => {
  const defaults = airtimeBandDefaults('5g');
  assert.equal(airtimeBandsAreDefault('5g', defaults), true);
  // the same numbers written another way are still the defaults
  assert.equal(airtimeBandsAreDefault('5g', { ...defaults, full: '60.0', goal_lost: ' 5 ' }), true);
  assert.equal(airtimeBandsAreDefault('5g', { ...defaults, pace: '31' }), false);
  // 2.4 GHz's defaults aren't 5 GHz's
  assert.equal(airtimeBandsAreDefault('2g', defaults), false);
  // every option is written: unset at its default, so a default that changes later applies
  const all = airtimeBandValues('5g', defaults);
  assert.deepEqual(Object.keys(all), [...AIRTIME_BAND_KEYS.map((k) => airtimeBandOption('5g', k)), airtimeAutoOption('5g')]);
  assert.ok(Object.values(all).every((v) => v === undefined));
  assert.deepEqual(airtimeBandValues('5g', { ...defaults, pace: '45', goal_slow: '20.50', goal_lost: '05' }), {
    airtime_5g_full: undefined,
    airtime_5g_pace: '45',
    airtime_5g_weak: undefined,
    airtime_5g_goal_slow: '20.5',
    airtime_5g_goal_weak: undefined,
    airtime_5g_goal_lost: undefined,
    airtime_5g_auto: undefined,
  });
  // what is saved reads back as typed numbers
  const saved = airtimeBandValues('5g', { ...defaults, full: '80', weak: '10' });
  assert.deepEqual(airtimeBandsOf((o) => saved[o], '5g'), { ...defaults, full: '80', weak: '10' });
  // settings with something wrong in them aren't saved at all
  assert.deepEqual(airtimeBandValues('5g', { ...defaults, weak: '40' }), {});
});

test('airtime: the channels a radio is using, all of them', () => {
  // the range it takes up, the channel it's on and how wide that is
  assert.equal(airtimeChannelsLabel(36, [36, 40, 44, 48, 52, 56, 60, 64], 160), 'Channels 36–64 (primary 36) · 160 MHz');
  assert.equal(airtimeChannelsLabel(52, [36, 40, 44, 48, 52, 56, 60, 64], 160), 'Channels 36–64 (primary 52) · 160 MHz');
  assert.equal(airtimeChannelsLabel(1, [1, 5], 40), 'Channels 1–5 (primary 1) · 40 MHz');
  // without the width or the channel it's on, what is known
  assert.equal(airtimeChannelsLabel(36, [36, 40], null), 'Channels 36–40 (primary 36)');
  assert.equal(airtimeChannelsLabel(null, [36, 40], 40), 'Channels 36–40 · 40 MHz');
  // a 20 MHz channel is one channel, and its width goes without saying
  assert.equal(airtimeChannelsLabel(6, [6], 20), 'Channel 6');
  // while only the channel it's on is known
  assert.equal(airtimeChannelsLabel(36, [], null), 'Channel 36');
  assert.equal(airtimeChannelsLabel('36', [], null), 'Channel 36');
  assert.equal(airtimeChannelsLabel(null, [], null), undefined);
});

test('airtime: a device’s signal in words, its strength and each antenna', () => {
  assert.equal(airtimeSignalWords(-67, null), '-67 dBm');
  // with the radio's noise, how far above it
  assert.equal(airtimeSignalWords(-67, -92), '-67 dBm, 25 dB above the noise');
  assert.equal(airtimeSignalWords(-54.4, -91.6), '-54 dBm, 37 dB above the noise');
  // a noise figure that isn't one, or a signal at or under it: just the signal
  assert.equal(airtimeSignalWords(-67, 0), '-67 dBm');
  assert.equal(airtimeSignalWords(-95, -92), '-95 dBm');
  assert.equal(airtimeSignalWords(-67, Number.NaN), '-67 dBm');
  assert.equal(airtimeSignalWords(null, -92), undefined);
  // the icon's level: a step for each 10 dB
  assert.deepEqual(
    [-40, -55, -56, -65, -66, -75, -76, -85, -86, -100].map(airtimeSignalLevel),
    [4, 4, 3, 3, 2, 2, 1, 1, 0, 0],
  );
  // each antenna, where there are several
  assert.equal(airtimeChainsWords([-68.2, -73, -78, -74]), 'By antenna: -68, -73, -78, -74 dBm');
  assert.equal(airtimeChainsWords([-60]), undefined);
  assert.equal(airtimeChainsWords(null), undefined);
});

test('airtime: how a band’s shares are set, as saved and as the service reads it', () => {
  assert.equal(airtimeAutoOption('5g'), 'airtime_5g_auto');
  for (const name of ['gentle', 'balanced', 'strict'] as const) assert.equal(airtimeStrengthOf(name), name);
  // anything else is the goals set by hand
  for (const other of [undefined, null, '', 'manual', 'auto', 'Balanced', ' strict', '1']) assert.equal(airtimeStrengthOf(other), undefined, String(other));
  const saved: Record<string, string> = { airtime_5g_auto: 'strict', airtime_2g_auto: 'loud' };
  assert.equal(airtimeBandsOf((o) => saved[o], '5g').auto, 'strict');
  assert.equal(airtimeBandsOf((o) => saved[o], '2g').auto, 'manual');
  assert.equal(airtimeBandsOf(() => undefined, '6g').auto, 'manual');
});

test('airtime: with auto, only the settings it uses are checked and saved', () => {
  const auto = { ...airtimeBandDefaults('5g'), auto: 'balanced' as const };
  // what isn't shown with auto isn't checked: the very slow rate and the goals
  assert.deepEqual(airtimeBandsErrors({ ...auto, pace: 'x', goal_slow: '500', goal_weak: '', goal_lost: '0' }), {});
  // with no very slow rate to set, a weak one above a good one is what's out of order
  assert.deepEqual(airtimeBandsErrors({ ...auto, weak: '40' }), {});
  assert.deepEqual(airtimeBandsErrors({ ...auto, weak: '70' }), { weak: 'A very slow link can’t start above a good one.' });
  assert.match(airtimeBandsErrors({ ...auto, full: '0' }).full ?? '', /1 to 10000 Mbit\/s/);
  // saved: the strength and the rates shown; what isn't shown is left as it is
  assert.deepEqual(airtimeBandValues('5g', { ...auto, pace: 'x', full: '80', goal_lost: '3' }), {
    airtime_5g_full: '80',
    airtime_5g_weak: undefined,
    airtime_5g_auto: 'balanced',
  });
  // back to the goals: the strength unset
  assert.equal(airtimeBandValues('5g', { ...auto, auto: 'manual' })['airtime_5g_auto'], undefined);
  // the hidden goals don't count against the defaults, and the reset keeps them and the strength
  assert.equal(airtimeBandsAreDefault('5g', { ...auto, pace: '45', goal_weak: '9', goal_lost: '3' }), true);
  assert.equal(airtimeBandsAreDefault('5g', { ...auto, full: '80' }), false);
  assert.deepEqual(airtimeBandsReset('5g', { ...auto, full: '80', goal_lost: '3', pace: '45' }), { ...auto, pace: '45', goal_lost: '3' });
  // by hand, the reset is the defaults
  assert.deepEqual(airtimeBandsReset('5g', { ...airtimeBandDefaults('5g'), pace: '45' }), airtimeBandDefaults('5g'));
});

test('airtime: with auto, where slow links start being held back (as the service works it out)', () => {
  // the share beside one good link under four fifths of an even split: a weight under 2/3
  assert.equal(airtimeAutoPaceRate(60, 12, 'balanced'), 40);
  assert.equal(airtimeAutoPaceRate(60, 12, 'gentle'), 26.7);
  assert.equal(airtimeAutoPaceRate(60, 12, 'strict'), 45.8);
  assert.equal(airtimeAutoPaceRate(15, 4, 'balanced'), 10);
  // never below the weak rate
  assert.equal(airtimeAutoPaceRate(60, 30, 'gentle'), 30);
  // and there, by definition, the share beside one good link is 40%
  near(airtimeAutoShare(40, 60, 'balanced', 1, 0.05), 0.4);
});

test('airtime: with auto, a share follows the rate and the devices wanting the air', () => {
  // a device at 8.6 Mbit/s beside one good link
  near(airtimeAutoShare(8.6, 60, 'balanced', 1, 0.05), 8.6 / 68.6);
  assert.ok(Math.abs(airtimeAutoShare(8.6, 60, 'gentle', 1, 0.05) - 0.275) < 0.001);
  assert.ok(Math.abs(airtimeAutoShare(8.6, 60, 'strict', 1, 0.05) - 0.051) < 0.001);
  // the stronger, the smaller
  assert.ok(airtimeAutoShare(25, 60, 'strict', 1, 0.05) < airtimeAutoShare(25, 60, 'balanced', 1, 0.05));
  assert.ok(airtimeAutoShare(25, 60, 'balanced', 1, 0.05) < airtimeAutoShare(25, 60, 'gentle', 1, 0.05));
  // smaller with more devices wanting the air, none counting as one
  near(airtimeAutoShare(8.6, 60, 'balanced', 3, 0.01), 8.6 / 188.6);
  // ... which is under a not-answering goal of 5%
  near(airtimeAutoShare(8.6, 60, 'balanced', 3, 0.05), 0.05);
  near(airtimeAutoShare(8.6, 60, 'balanced', 0, 0.05), airtimeAutoShare(8.6, 60, 'balanced', 1, 0.05));
  // never under the not-answering goal, nor more than all of it; a good link or better: an even split
  near(airtimeAutoShare(1, 60, 'strict', 3, 0.05), 0.05);
  near(airtimeAutoShare(600, 60, 'balanced', 1, 0.05), 0.5);
});

test('airtime: with auto, a held-back device says its share of the air and who it waits for', () => {
  assert.equal(
    airtimeDoing('weak', true, { pace: 100, aim: 125, competing: 1 }),
    'Kept to a frame or two in the radio at a time. Held to about 13% of the air while a device with a better link is waiting.',
  );
  assert.equal(airtimeDoing('slow', true, { pace: 40, aim: 46, competing: 3 }), 'Held to about 5% of the air while 3 devices with better links are waiting.');
  // none wanting the air counts as one
  assert.match(airtimeDoing('slow', true, { pace: 40, aim: 46, competing: 0 }) ?? '', /while a device with a better link is waiting/);
  // without auto, the goal's part of the time as before
  assert.equal(airtimeDoing('slow', true, { pace: 170 }), 'Held to 17% of the time while a device with a good link is waiting.');
  // and with the policy off, nothing of it
  assert.doesNotMatch(airtimeDoing('slow', false, { pace: 40, aim: 46 }) ?? '', /Held to/);
  // the trim is said where the pacing is a percent or more off the share
  assert.match(airtimeTrimWords(100, 125) ?? '', /^Paced at 10% of the time by the driver’s estimate/);
  assert.equal(airtimeTrimWords(120, 125), undefined);
  assert.equal(airtimeTrimWords(170, 0), undefined);
});
