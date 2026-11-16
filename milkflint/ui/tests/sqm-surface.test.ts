// What the Smart Queue page shows on its surface: when it asks for the
// connection type, what More settings says is folded under it, and each
// direction's rate against its shaped speed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type SqmData, sqmData } from '../src/features/sqm/model.ts';
import { linkUnasked, moreSummary, queueNumber, shareOfLimit, totalRate } from '../src/features/sqm/surface.ts';
import type { CakeQdisc } from '../src/lib/api/stats.ts';
import type { Section } from '../src/lib/api/uci.ts';
import { section } from './uci-fixture.ts';

const load = (sqm: Section[] | undefined): SqmData =>
  sqmData({
    sqm,
    firewall: [section('defaults', 'cfg01')],
    milkflint: [],
    wanDevice: 'eth1',
    wanProto: 'dhcp',
    devices: ['eth0', 'eth1'],
  });

test('the connection type is asked for while OpenWrt’s own queue has never shaped', () => {
  // a queue as OpenWrt's default leaves it: off, with no compensation
  const fresh = load([
    section('queue', 'eth1', { enabled: '0', interface: 'eth1', download: '120000', upload: '20000', linklayer: 'none' }),
  ]);
  assert.equal(fresh.form.link, 'none');
  assert.equal(linkUnasked(fresh), true);
  // on with none: chosen (or kept), so the page says what it costs instead
  const on = load([
    section('queue', 'eth1', { enabled: '1', interface: 'eth1', download: '120000', upload: '20000', linklayer: 'none' }),
  ]);
  assert.equal(linkUnasked(on), false);
  // no queue yet: the page fills in Fibre / Ethernet
  const none = load([]);
  assert.equal(none.form.link, 'ethernet');
  assert.equal(linkUnasked(none), false);
  // a preset chosen, Smart Queue off: shown as chosen
  const docsis = load([
    section('queue', 'eth1', { enabled: '0', interface: 'eth1', linklayer: 'ethernet', overhead: '18', tcMPU: '64' }),
  ]);
  assert.equal(linkUnasked(docsis), false);
});

test('More settings names what isn’t at its usual value', () => {
  const data = load([
    section('queue', 'wan', {
      enabled: '1',
      interface: 'eth1',
      download: '300000',
      upload: '40000',
      script: 'piece_of_cake.qos',
    }),
  ]);
  assert.deepEqual(moreSummary(data.form, data), []);
  assert.deepEqual(
    moreSummary({ ...data.form, prioritise: true, latency: 'low', perDevice: true, restoreDscp: true, device: 'eth0' }, data),
    ['Prioritise by traffic type', 'Low latency target', 'Fair share per device', 'Devices’ priorities kept', 'Shapes eth0'],
  );
  assert.deepEqual(moreSummary({ ...data.form, latency: 'custom' }, data), ['Custom latency target']);
});

test('a direction’s rate and its share of the shaped speed', () => {
  const q = (parent: string | undefined): CakeQdisc => ({
    kind: 'cake',
    dev: 'ifb4eth1',
    ...(parent === undefined ? {} : { parent }),
  });
  assert.equal(queueNumber(q('8001:a')), 10);
  assert.equal(queueNumber(q(undefined)), 0);
  assert.equal(totalRate([undefined, undefined]), undefined);
  assert.equal(totalRate([undefined, 5e6, 3e6]), 8e6);
  assert.equal(shareOfLimit(8e6, 10e6), 0.8);
  assert.equal(shareOfLimit(12e6, 10e6), 1);
  assert.equal(shareOfLimit(undefined, 10e6), undefined);
  assert.equal(shareOfLimit(5e6, undefined), undefined);
});
