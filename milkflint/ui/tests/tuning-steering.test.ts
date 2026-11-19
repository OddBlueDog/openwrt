// Performance tuning's packet steering choice: Automatic (RSS, but the RPS
// layout on a PPPoE line, whose packets RSS can't spread), what each choice
// writes and runs, and when it offers to switch Smart Queue's multi-queue
// CAKE with it (packet-steering.sh and sqm-scripts' 109 do the rest).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Section } from '../src/lib/api/uci.ts';
import {
  changedSettings,
  defaults,
  hasPppoe,
  queueSwitch,
  readSteering,
  steeringInUse,
  steeringValues,
  type TuningData,
} from '../src/features/tuning/model.ts';

const iface = (name: string, values: Record<string, string>): Section => ({ '.name': name, '.type': 'interface', ...values });

test('Automatic is the default, and what an unset setting reads as', () => {
  assert.equal(defaults.steering, 'auto');
  assert.equal(readSteering(undefined, undefined, undefined), 'auto');
  assert.deepEqual(changedSettings(defaults, { firewall: undefined }), []);
});

test('each choice reads back from what it writes', () => {
  for (const steering of ['auto', 'rss', 'rps', 'openwrt'] as const) {
    const v = steeringValues(steering);
    assert.equal(readSteering(undefined, v.layout, v.rss), steering, steering);
  }
  assert.deepEqual(steeringValues('auto'), { layout: undefined, rss: undefined });
  assert.deepEqual(steeringValues('rss'), { layout: undefined, rss: '1' });
  assert.deepEqual(steeringValues('rps'), { layout: undefined, rss: '0' });
  // off is OpenWrt's own option, whatever MilkFlint's say
  assert.equal(readSteering('0', undefined, '1'), 'off');
});

test('a PPPoE line: an interface on PPPoE with a device, as packet steering counts it', () => {
  assert.equal(hasPppoe([iface('wan', { proto: 'dhcp', device: 'eth1' })]), false);
  assert.equal(hasPppoe([iface('wan', { proto: 'pppoe', device: 'eth1' })]), true);
  assert.equal(hasPppoe([iface('fttp', { proto: 'pppoe', device: 'wan_vlan' }), iface('wan', { proto: 'dhcp' })]), true);
  assert.equal(hasPppoe([iface('wan', { proto: 'pppoe' })]), false);
});

test('what runs: Automatic is RSS, but RPS on a PPPoE line or without the rings', () => {
  assert.equal(steeringInUse('auto', { pppoe: false, rssMissing: false }), 'rss');
  assert.equal(steeringInUse('auto', { pppoe: true, rssMissing: false }), 'rps');
  assert.equal(steeringInUse('auto', { pppoe: false, rssMissing: true }), 'rps');
  assert.equal(steeringInUse('rss', { pppoe: true, rssMissing: false }), 'rss');
  assert.equal(steeringInUse('rss', { pppoe: false, rssMissing: true }), 'rps');
  assert.equal(steeringInUse('openwrt', { pppoe: true, rssMissing: false }), 'openwrt');
});

function data(steering: TuningData['form']['steering'], pppoe: boolean, multiQueue = true): TuningData {
  return {
    form: { ...defaults, steering },
    milkflint: [],
    globals: 'globals',
    packetSteering: undefined,
    firewall: undefined,
    sqm: { section: 'eth1', multiQueue, download: 800_000, iqdiscOpts: undefined, targetMs: null },
    wed: { milkflint: [], sqm: [], firewall: [] },
    accessPoint: false,
    pppoe,
  };
}

test('multi-queue CAKE stays on where it still spreads: on a PPPoE line, each CPU has its own sub-queue', () => {
  assert.equal(queueSwitch({ ...defaults, steering: 'rps' }, data('auto', true)), undefined);
  assert.equal(queueSwitch({ ...defaults, steering: 'rss' }, data('auto', true)), undefined);
  assert.equal(queueSwitch({ ...defaults, steering: 'auto' }, data('rps', true)), undefined);
});

test('multi-queue CAKE goes off where everything reaches one queue, and back on with RSS', () => {
  // a DHCP line in the RPS layout: every download on ring 0, so one sub-queue
  assert.equal(queueSwitch({ ...defaults, steering: 'rps' }, data('auto', false)), false);
  assert.equal(queueSwitch({ ...defaults, steering: 'auto' }, data('rps', false, false)), true);
  // OpenWrt's layout and off: one CPU at a time, PPPoE or not
  assert.equal(queueSwitch({ ...defaults, steering: 'openwrt' }, data('auto', true)), false);
  assert.equal(queueSwitch({ ...defaults, steering: 'off' }, data('auto', true)), false);
});
