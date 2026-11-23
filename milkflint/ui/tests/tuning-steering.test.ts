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

function data(steering: TuningData['form']['steering'], pppoe: boolean, multiQueue = true, download = 800_000): TuningData {
  return {
    form: { ...defaults, steering },
    milkflint: [],
    globals: 'globals',
    packetSteering: undefined,
    firewall: undefined,
    sqm: { section: 'eth1', multiQueue, download, iqdiscOpts: undefined, targetMs: null },
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

test('multi-queue CAKE stays on in the RPS layout on an Ethernet line too: its ifb has a sub-queue per CPU (sqm-scripts 110)', () => {
  assert.equal(queueSwitch({ ...defaults, steering: 'rps' }, data('auto', false)), undefined);
  assert.equal(queueSwitch({ ...defaults, steering: 'auto' }, data('rps', false)), undefined);
});

test('multi-queue CAKE goes off where one CPU at a time feeds it, and back with the speed’s threshold for the line', () => {
  // OpenWrt's layout and off: one CPU at a time, PPPoE or not
  assert.equal(queueSwitch({ ...defaults, steering: 'openwrt' }, data('auto', true)), false);
  assert.equal(queueSwitch({ ...defaults, steering: 'off' }, data('auto', false)), false);
  // back to a spreading layout: on where Automatic gives it at the speed
  // (1 Gbit/s on Ethernet, 500 Mbit/s on PPPoE), else left as one CAKE
  assert.equal(queueSwitch({ ...defaults, steering: 'auto' }, data('off', false, false, 800_000)), undefined);
  assert.equal(queueSwitch({ ...defaults, steering: 'rss' }, data('openwrt', false, false, 1_200_000)), true);
  assert.equal(queueSwitch({ ...defaults, steering: 'auto' }, data('off', true, false, 800_000)), true);
  assert.equal(queueSwitch({ ...defaults, steering: 'rps' }, data('off', true, false, 450_000)), undefined);
});
