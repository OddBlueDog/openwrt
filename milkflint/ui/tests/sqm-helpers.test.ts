// Smart Queue's small sums: CAKE's options as LuCI keeps them, CAKE's target,
// and which CAKEs are the internet port's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { delayMs, directionsOf, summarize } from '../src/features/sqm/cake.ts';
import { cakeTargetMs, GSO, optValue, takesWhole, wholeOf, wholeSetting, wholeValue, withOpts } from '../src/features/sqm/gso.ts';
import { MULTI_QUEUE_KBIT, multiQueueOf, multiQueueSetting, multiQueueValue, usesMultiQueue } from '../src/features/sqm/multi-queue.ts';
import type { CakeQdisc } from '../src/lib/api/stats.ts';

test('a managed keyword is replaced, the rest stay in order', () => {
  assert.equal(withOpts('nat dual-dsthost split-gso', GSO, ['no-split-gso']), 'nat dual-dsthost no-split-gso');
  assert.equal(withOpts(undefined, GSO, ['no-split-gso']), 'no-split-gso');
  assert.equal(withOpts('no-split-gso', GSO, []), '');
  assert.equal(withOpts('  nat   wash ', GSO, []), 'nat wash');
});

test('one that takes a value goes with its value, and only that', () => {
  assert.equal(withOpts('nat rtt 50ms wash', ['rtt'], ['rtt', '100ms']), 'nat wash rtt 100ms');
  assert.equal(withOpts('rtt 50ms', ['rtt'], []), '');
  assert.equal(withOpts('mpu 64 overhead 18 nat', ['overhead'], []), 'mpu 64 nat');
  assert.equal(withOpts('memlimit 32m fwmark 0xff', ['memlimit', 'fwmark'], []), '');
  // a value that reads like a flag isn't kept as one
  assert.equal(withOpts('rtt internet nat', ['rtt'], []), 'nat');
  // at the end with its value missing: nothing to go wrong
  assert.equal(withOpts('nat rtt', ['rtt'], []), 'nat');
});

test('a keyword that takes no value leaves the next word alone', () => {
  assert.equal(withOpts('split-gso nat', GSO, []), 'nat');
  assert.equal(withOpts('internet nat', ['internet'], ['metro']), 'nat metro');
});

test('the value after a keyword', () => {
  assert.equal(optValue('nat rtt 50ms', 'rtt'), '50ms');
  assert.equal(optValue('nat', 'rtt'), undefined);
  assert.equal(optValue('nat rtt', 'rtt'), '');
  assert.equal(optValue(undefined, 'rtt'), undefined);
});

test('CAKE’s target is a twentieth of its rtt', () => {
  assert.equal(cakeTargetMs(undefined), 5);
  assert.equal(cakeTargetMs('nat wash'), 5);
  assert.equal(cakeTargetMs('rtt 50ms'), 2.5);
  assert.equal(cakeTargetMs('rtt 1s'), 50);
  assert.equal(cakeTargetMs('rtt 100us'), 0.005);
  assert.equal(cakeTargetMs('rtt 0.5ms'), 0.025);
  assert.equal(cakeTargetMs('lan'), 0.05);
  assert.equal(cakeTargetMs('datacentre nat'), 0.005);
  assert.equal(cakeTargetMs('metro'), 0.5);
  assert.equal(cakeTargetMs('oceanic'), 15);
  // what can't be told isn't guessed
  assert.equal(cakeTargetMs('rtt fast'), null);
  assert.equal(cakeTargetMs('rtt'), null);
  assert.equal(cakeTargetMs('rtt 50'), null);
});

test('taking GRO packets whole', () => {
  assert.equal(takesWhole(499_999, 'auto'), false);
  assert.equal(takesWhole(500_000, 'auto'), true);
  assert.equal(takesWhole(1_000, 'on'), true);
  assert.equal(takesWhole(1_000_000, 'off'), false);
  for (const w of ['auto', 'on', 'off'] as const) assert.equal(wholeSetting(wholeValue(w)), w);
  assert.equal(wholeSetting('2'), 'auto');
});

test('multi-queue CAKE goes with the download speed, unless chosen', () => {
  assert.equal(usesMultiQueue(MULTI_QUEUE_KBIT - 1, 'auto'), false);
  assert.equal(usesMultiQueue(MULTI_QUEUE_KBIT, 'auto'), true);
  assert.equal(usesMultiQueue(20_000, 'on'), true);
  assert.equal(usesMultiQueue(800_000, 'off'), false);
  for (const c of ['auto', 'on', 'off'] as const) assert.equal(multiQueueSetting(multiQueueValue(c)), c);
  assert.equal(multiQueueSetting(undefined), 'auto');
  assert.equal(multiQueueSetting('yes'), 'auto');
});

test('the multi-queue choice shown is what the queue does', () => {
  // no queue yet: the setting
  assert.equal(multiQueueOf(undefined, undefined, 0), 'auto');
  assert.equal(multiQueueOf('0', undefined, 800_000), 'off');
  // use_mq as the setting gives at this speed: the setting
  assert.equal(multiQueueOf(undefined, true, 750_000), 'auto');
  assert.equal(multiQueueOf(undefined, false, 85_000), 'auto');
  assert.equal(multiQueueOf('1', true, 85_000), 'on');
  assert.equal(multiQueueOf('0', false, 750_000), 'off');
  // use_mq set elsewhere (LuCI) to something else: shown as it is, and saved so
  assert.equal(multiQueueOf(undefined, false, 750_000), 'off');
  assert.equal(multiQueueOf(undefined, true, 85_000), 'on');
  assert.equal(multiQueueOf('1', false, 750_000), 'off');
  assert.equal(multiQueueOf('0', true, 85_000), 'on');
});

const cake = (dev: string, over: Partial<CakeQdisc> = {}): CakeQdisc => ({ kind: 'cake', dev, ...over });

test('the internet port’s directions, download first; guests’ and the VPN’s left out', () => {
  const out = directionsOf([
    cake('eth1'),
    cake('ifb4eth1'),
    cake('br-guest'),
    cake('ifb4br-guest'),
    cake('br-guest3'),
    cake('wg_out'),
    cake('ifb4wg_out'),
  ]);
  assert.deepEqual(out.map((d) => [d.dev, d.download]), [['ifb4eth1', true], ['eth1', false]]);
});

test('cake_mq: its own sub-queues, on its own device only', () => {
  const out = directionsOf([
    cake('ifb4eth1', { kind: 'cake_mq', handle: '1:' }),
    cake('ifb4eth1', { parent: '1:1' }),
    cake('ifb4eth1', { parent: '1:2' }),
    cake('ifb4eth1', { parent: '2:1' }),
    cake('eth1', { parent: '1:1' }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]?.queues.length, 2);
  assert.equal(out[0].download, true);
});

test('a CAKE under something else isn’t a direction of its own', () => {
  assert.deepEqual(directionsOf([cake('eth1', { parent: '1:1' })]), []);
});

test('one direction’s figures: added over queues, delays from the busiest tin of the worst', () => {
  const q = (sent: number, avg: number, peak: number): CakeQdisc =>
    cake('eth1', { bytes: 10, tins: [{ sent_bytes: sent, avg_delay_us: avg, peak_delay_us: peak, drops: 1, ecn_mark: 2, sparse_flows: 3, bulk_flows: 4 }, { sent_bytes: 0, avg_delay_us: 99999, peak_delay_us: 99999, drops: 1 }] });
  const root = cake('eth1', { options: { bandwidth: 1000 } });
  const s = summarize({ dev: 'eth1', download: false, root, queues: [q(100, 500, 800), q(50, 700, 900)] });
  assert.equal(s.bandwidth, 8000);
  assert.equal(s.bytes, 20);
  assert.equal(s.avgDelayUs, 700);
  assert.equal(s.peakDelayUs, 900);
  assert.equal(s.drops, 4);
  assert.equal(s.ecnMarks, 4);
  assert.equal(s.flows, 14);
  assert.equal(delayMs(undefined), '—');
  assert.equal(delayMs(1500), '1.5 ms');
});

test('the GRO choice to show: the setting, or what the queue does when LuCI changed it', () => {
  assert.equal(wholeOf(undefined, 'nat no-split-gso', 800_000), 'auto');
  assert.equal(wholeOf(undefined, 'nat', 300_000), 'auto');
  // taken out, or put in, by hand
  assert.equal(wholeOf(undefined, 'nat', 800_000), 'off');
  assert.equal(wholeOf(undefined, 'no-split-gso', 300_000), 'on');
  assert.equal(wholeOf('1', 'nat', 300_000), 'off');
  assert.equal(wholeOf('0', 'nat', 800_000), 'off');
  // no queue: the setting
  assert.equal(wholeOf('1', null, 0), 'on');
});
