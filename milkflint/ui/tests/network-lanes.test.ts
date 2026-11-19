// The CPU lanes on Performance Tuning and Smart Queue: which CPU a download
// sub-queue runs on (its XPS CPU on a PPPoE line, else its RSS ring's), what
// a receive ring's chip says from the traffic it gets, not just its share of
// the RSS table (ring 0 carries the switch's ports and PPPoE), and the
// sentence on a download's path.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NetworkLive, QueueNow, RingNow } from '../src/hooks/use-network-live.ts';
import { queueCpu, ringSummary } from '../src/lib/network-lanes.ts';
import { pathSentence } from '../src/lib/network-text.ts';

test('a download sub-queue runs on its XPS CPU when it has one, else on its RSS ring’s', () => {
  assert.equal(queueCpu([2], 1), 2);
  assert.equal(queueCpu([], 1), 1);
  assert.equal(queueCpu(undefined, 3), 3);
  // XPS over several CPUs doesn't pin it
  assert.equal(queueCpu([1, 2, 3], undefined), undefined);
});

const ring = (r: Partial<RingNow>): RingNow => ({ ring: 0, cpu: 0, irqRate: undefined, load: undefined, share: 0, ...r });

test('a ring in the RSS table, busy or not', () => {
  assert.deepEqual(ringSummary(ring({ ring: 1, share: 1 / 3, irqRate: 5000, load: 0.12 })), {
    detail: '33% of flows · 5k/s · 12% CPU',
    idle: false,
  });
  // a PPPoE line with RSS chosen: the table sends flows to rings 1-3, and none arrive
  assert.deepEqual(ringSummary(ring({ ring: 1, share: 1 / 3, irqRate: 0, load: 0 })), {
    detail: '33% of flows · 0/s · 0% CPU',
    idle: true,
  });
});

test('ring 0 outside the RSS table: idle only when nothing arrives, the switch’s ports and PPPoE do', () => {
  assert.deepEqual(ringSummary(ring({ irqRate: 4200, load: 0.3 })), { detail: 'not hashed · 4.2k/s · 30% CPU', idle: false });
  assert.deepEqual(ringSummary(ring({ irqRate: 3, load: 0 })), { detail: 'no flows', idle: true });
  // no rate yet (the first sample)
  assert.deepEqual(ringSummary(ring({})), { detail: 'no flows', idle: true });
});

function live(over: Partial<NetworkLive>): NetworkLive {
  return {
    cpus: [],
    rss: { table: [128, 0, 0, 0], hash: 'toeplitz', spreading: false },
    rings: [ring({ share: 1 })],
    send: undefined,
    wifi: { irqs: [], cpus: [], load: undefined, threads: 0 },
    rps: [1, 2, 3],
    threads: [],
    queues: [],
    qdiscs: [],
    rates: new Map(),
    ...over,
  };
}

const queue = (number: number, cpu: number | undefined): QueueNow => ({
  key: `ifb4pppoe-wan 8009:${String(number)}`,
  dev: 'ifb4pppoe-wan',
  download: true,
  number,
  bits: undefined,
  avgDelayUs: undefined,
  flows: 0,
  cpu,
});

test('the RPS layout: one ring, handed on by flow; with a sub-queue per CPU (PPPoE), the path says so', () => {
  assert.equal(
    pathSentence(live({})),
    'What the Ethernet receives arrives on one ring, and packet steering (RPS) hands it on to CPUs 1–3 by flow.',
  );
  assert.equal(
    pathSentence(live({ queues: [queue(1, 0), queue(2, 1), queue(3, 2), queue(4, 3)] })),
    'What the Ethernet receives arrives on one ring, and packet steering (RPS) hands it on to CPUs 1–3 by flow; each CPU then feeds its own Smart Queue queue.',
  );
});
