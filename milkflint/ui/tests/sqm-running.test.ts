// Whether CAKE runs as the Smart Queue page saved it: tc's qdiscs against
// the internet's queue, direction by direction.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ifbOf, shapingProblems } from '../src/features/sqm/running.ts';
import type { CakeQdisc } from '../src/lib/api/stats.ts';
import type { Section } from '../src/lib/api/uci.ts';
import { section } from './uci-fixture.ts';

const queue = (values: Record<string, string> = {}): Section =>
  section('queue', 'wan', {
    enabled: '1',
    interface: 'eth1',
    download: '800000',
    upload: '60000',
    use_mq: '1',
    use_mq_egress: '0',
    ...values,
  });

/** a plain CAKE at a device's root, as tc -j shows it: the speed in bytes/s */
const cake = (dev: string, kbit: number): CakeQdisc => ({ kind: 'cake', dev, handle: '8001:', root: true, options: { bandwidth: kbit * 125 } });

/** multi-queue CAKE: its root and a CAKE per transmit queue under it, each with the whole speed */
const multi = (dev: string, kbit: number): CakeQdisc[] => [
  { kind: 'cake_mq', dev, handle: '1:', root: true, options: { bandwidth: kbit * 125 } },
  ...[1, 2, 3, 4].map((n): CakeQdisc => ({ kind: 'cake', dev, parent: `1:${String(n)}`, options: { bandwidth: kbit * 125 } })),
];

test('as saved: nothing to say', () => {
  assert.deepEqual(shapingProblems(queue(), [...multi('ifb4eth1', 800000), cake('eth1', 60000)]), []);
  // one CAKE each way
  assert.deepEqual(shapingProblems(queue({ download: '300000', use_mq: '0' }), [cake('ifb4eth1', 300000), cake('eth1', 60000)]), []);
  // the guest networks' and the VPN's CAKEs are theirs
  const others = [cake('br-guest', 50000), cake('ifb4br-guest', 10000), cake('wg_out', 40000), cake('ifb4wg_out', 40000)];
  assert.deepEqual(shapingProblems(queue(), [...others, ...multi('ifb4eth1', 800000), cake('eth1', 60000)]), []);
});

test('a direction tc refused is reported, though the other one shapes', () => {
  // estimating the speed with multi-queue: the kernel refuses the download's CAKE, sqm
  // brings the ifb up and redirects to it all the same, and the badge said Shaping
  const autorate = queue({ iqdisc_opts: 'nat autorate-ingress' });
  assert.deepEqual(shapingProblems(autorate, [cake('eth1', 60000)]), ['Downloads aren’t shaped: there’s no CAKE on ifb4eth1.']);
  assert.deepEqual(shapingProblems(queue(), [...multi('ifb4eth1', 800000)]), ['Uploads aren’t shaped: there’s no CAKE on eth1.']);
  assert.equal(shapingProblems(queue(), []).length, 2);
});

test('one CAKE where multi-queue was saved, or the other way round', () => {
  assert.deepEqual(shapingProblems(queue(), [cake('ifb4eth1', 800000), cake('eth1', 60000)]), [
    'Downloads run one CAKE, not multi-queue CAKE as saved.',
  ]);
  assert.deepEqual(shapingProblems(queue({ download: '300000', use_mq: '0' }), [...multi('ifb4eth1', 300000), cake('eth1', 60000)]), [
    'Downloads run multi-queue CAKE, not one CAKE as saved.',
  ]);
  // the upload kept to one CAKE, and running multi-queue
  assert.deepEqual(shapingProblems(queue(), [...multi('ifb4eth1', 800000), ...multi('eth1', 60000)]), [
    'Uploads run multi-queue CAKE, not one CAKE as saved.',
  ]);
  // upload multi-queue asked for: either, as only a device with several send queues gets it
  for (const upload of [multi('eth1', 60000), [cake('eth1', 60000)]]) {
    assert.deepEqual(shapingProblems(queue({ use_mq_egress: '1' }), [...multi('ifb4eth1', 800000), ...upload]), []);
    const likeDownloads = queue();
    Reflect.deleteProperty(likeDownloads, 'use_mq_egress');
    assert.deepEqual(shapingProblems(likeDownloads, [...multi('ifb4eth1', 800000), ...upload]), []);
  }
});

test('the speed: an old one still running is reported; an estimated one isn’t compared', () => {
  // a save sqm didn't pick up
  assert.deepEqual(shapingProblems(queue({ download: '650000' }), [...multi('ifb4eth1', 800000), cake('eth1', 60000)]), [
    'Downloads are shaped at 800 Mbit/s, not the 650 Mbit/s saved.',
  ]);
  assert.deepEqual(shapingProblems(queue({ upload: '45000' }), [...multi('ifb4eth1', 800000), cake('eth1', 60000)]), [
    'Uploads are shaped at 60 Mbit/s, not the 45 Mbit/s saved.',
  ]);
  const unlimited: CakeQdisc = { ...cake('eth1', 0), options: { bandwidth: 'unlimited' } };
  assert.deepEqual(shapingProblems(queue(), [...multi('ifb4eth1', 800000), unlimited]), ['Uploads are shaped at no limit, not the 60 Mbit/s saved.']);
  // autorate-ingress: CAKE sets the download's speed itself
  const estimating = queue({ use_mq: '0', iqdisc_opts: 'autorate-ingress' });
  assert.deepEqual(shapingProblems(estimating, [cake('ifb4eth1', 612345), cake('eth1', 60000)]), []);
});

test('off, or a direction at 0: no CAKE wanted, and one still there is reported', () => {
  const off = queue({ enabled: '0' });
  assert.deepEqual(shapingProblems(off, []), []);
  assert.deepEqual(shapingProblems(off, [cake('eth1', 60000)]), ['CAKE still shapes uploads on eth1, though Smart Queue is off.']);
  // sqm leaves a direction with no speed (0, or what isn't a number) unshaped
  for (const download of ['0', 'NaN', '']) {
    const one = queue({ download });
    assert.deepEqual(shapingProblems(one, [cake('eth1', 60000)]), [], download);
    assert.deepEqual(shapingProblems(one, [cake('ifb4eth1', 800000), cake('eth1', 60000)]), ['CAKE still shapes downloads on ifb4eth1, though their speed is 0.'], download);
  }
});

test('nothing expected of no queue, or of one without an interface (sqm doesn’t start it)', () => {
  assert.deepEqual(shapingProblems(undefined, [cake('eth1', 60000)]), []);
  assert.deepEqual(shapingProblems(section('queue', 'wan', { enabled: '1', download: '800000', upload: '60000' }), []), []);
});

test('the download’s ifb as sqm names it: cut to a device name’s 15 characters', () => {
  assert.equal(ifbOf('eth1'), 'ifb4eth1');
  assert.equal(ifbOf('pppoe-wan'), 'ifb4pppoe-wan');
  assert.equal(ifbOf('eth1.1234567890'), 'ifb4eth1.123456');
  // on PPPoE's session
  const pppoe = queue({ interface: 'pppoe-wan' });
  assert.deepEqual(shapingProblems(pppoe, [...multi('ifb4pppoe-wan', 800000), cake('pppoe-wan', 60000)]), []);
  assert.deepEqual(shapingProblems(pppoe, [...multi('ifb4eth1', 800000), cake('eth1', 60000)]).length, 2, 'still on the port');
});
