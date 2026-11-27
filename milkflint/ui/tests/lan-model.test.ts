// The LAN page's settings: the DHCP pool's range, the checks on the router's
// address and pool (the form's schema), the UCI changes (netmask or
// address/prefix, as the config already had it), and the line More settings
// shows when folded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hostCount,
  type LanForm,
  lanFormSchema,
  leaseLabel,
  moreSummary,
  moves,
  netmaskOf,
  range,
  toChanges,
} from '../src/features/lan/model.ts';
import { formErrors } from '../src/lib/form/errors.ts';

const validate = (f: LanForm): Partial<Record<keyof LanForm, string>> => formErrors(lanFormSchema, f);

const form = (over: Partial<LanForm> = {}): LanForm => ({
  ipaddr: '192.168.1.1',
  prefix: '24',
  dhcp: true,
  start: '100',
  limit: '150',
  leasetime: '12h',
  cidrStyle: false,
  ...over,
});

test('the pool runs from the network’s start plus the offset', () => {
  assert.deepEqual(range(form()), { first: '192.168.1.100', last: '192.168.1.249' });
  assert.deepEqual(range(form({ ipaddr: '10.0.5.1', prefix: '16', start: '300', limit: '10' })), {
    first: '10.0.1.44',
    last: '10.0.1.53',
  });
  assert.equal(range(form({ ipaddr: 'nope' })), undefined);
});

test('network sizes and netmasks', () => {
  assert.equal(netmaskOf(24), '255.255.255.0');
  assert.equal(netmaskOf(22), '255.255.252.0');
  assert.equal(hostCount(24), 254);
  assert.equal(hostCount(16), 65534);
});

test('the router needs a private address that isn’t the network’s or broadcast', () => {
  assert.deepEqual(validate(form()), {});
  assert.match(validate(form({ ipaddr: '8.8.8.8' })).ipaddr ?? '', /private address/);
  assert.match(validate(form({ ipaddr: '192.168.1.0' })).ipaddr ?? '', /broadcast/);
  assert.match(validate(form({ ipaddr: '192.168.1.255' })).ipaddr ?? '', /broadcast/);
  assert.ok(validate(form({ ipaddr: '172.20.0.1', prefix: '16' })).ipaddr === undefined);
});

test('the pool has to fit in the network', () => {
  assert.equal(validate(form({ start: '0' })).start, 'Use 1 to 254.');
  assert.ok(validate(form({ start: '200', limit: '60' })).limit !== undefined);
  assert.ok(validate(form({ start: '200', limit: '54' })).limit === undefined);
});

test('a new address keeps the config’s style: netmask, or address/prefix', () => {
  const before = form();
  assert.deepEqual(toChanges(form({ ipaddr: '192.168.8.1' }), before)[0], {
    op: 'set',
    config: 'network',
    section: 'lan',
    values: { ipaddr: '192.168.8.1', netmask: '255.255.255.0' },
  });
  const cidr = form({ cidrStyle: true });
  assert.deepEqual(toChanges(form({ cidrStyle: true, prefix: '23' }), cidr)[0], {
    op: 'set',
    config: 'network',
    section: 'lan',
    values: { ipaddr: '192.168.1.1/23' },
  });
});

test('only the DHCP pool is written when the address stays', () => {
  const before = form();
  assert.deepEqual(toChanges(form({ dhcp: false }), before), [
    { op: 'set', config: 'dhcp', section: 'lan', values: { ignore: '1', start: '100', limit: '150', leasetime: '12h' } },
  ]);
  assert.equal(moves(form({ leasetime: '1h' }), before), false);
  assert.equal(moves(form({ prefix: '23' }), before), true);
});

test('the folded More settings line says what’s set', () => {
  assert.equal(moreSummary(form()), '/24 network · 150 addresses from 192.168.1.100 · lease 12 hours');
  assert.equal(moreSummary(form({ dhcp: false })), '/24 network');
  assert.equal(leaseLabel('2h'), '2h');
});
