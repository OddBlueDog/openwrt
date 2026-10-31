// The Operating Mode page's access point settings: the fixed address's
// checks (the router repeats them), the request the switch sends, and the
// form prefilled from the main router's network as the WAN port sees it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type ApForm, apAddress, initialForm, netmaskOf, toRequest, validate } from '../src/features/mode/model.ts';

const fixed = (over: Partial<ApForm> = {}): ApForm => ({
  proto: 'static',
  ipaddr: '192.168.0.2',
  prefix: '24',
  gateway: '192.168.0.1',
  dns: '',
  bridgeOffload: false,
  ...over,
});

test('a fixed address on the main router’s network is fine', () => {
  assert.deepEqual(validate(fixed()), {});
  assert.deepEqual(validate(fixed({ ipaddr: '10.0.3.200', prefix: '16', gateway: '10.0.0.1' })), {});
});

test('automatic needs nothing filled in', () => {
  assert.deepEqual(validate(fixed({ proto: 'dhcp', ipaddr: '', gateway: '' })), {});
});

test('a fixed address that isn’t one, or is the network or broadcast address, is refused', () => {
  for (const ipaddr of ['', '192.168.0', '192.168.0.256', 'router', '192.168.0.0', '192.168.0.255']) {
    assert.notEqual(validate(fixed({ ipaddr })).ipaddr, undefined, ipaddr);
  }
});

test('the main router must be on the same network, and not MilkFlint’s own address', () => {
  assert.match(validate(fixed({ gateway: '192.168.1.1' })).gateway ?? '', /same network/);
  assert.match(validate(fixed({ gateway: '192.168.0.2' })).gateway ?? '', /you picked/);
  assert.notEqual(validate(fixed({ gateway: '' })).gateway, undefined);
  assert.equal(validate(fixed({ prefix: '22', gateway: '192.168.3.1' })).gateway, undefined);
});

test('up to three DNS servers, IPv4, space or comma separated', () => {
  assert.equal(validate(fixed({ dns: '1.1.1.1, 9.9.9.9 8.8.8.8' })).dns, undefined);
  assert.equal(validate(fixed({ dns: '1.1.1.1 9.9.9.9 8.8.8.8 1.0.0.1' })).dns, 'Up to three.');
  assert.notEqual(validate(fixed({ dns: '1.1.1.1 dns.quad9.net' })).dns, undefined);
});

test('automatic sends only the mode, the protocol and the bridge fast path', () => {
  assert.deepEqual(toRequest(fixed({ proto: 'dhcp', bridgeOffload: true })), { mode: 'ap', proto: 'dhcp', bridge_offload: true });
});

test('a fixed address sends a netmask, and the main router as DNS when none is given', () => {
  assert.deepEqual(toRequest(fixed()), {
    mode: 'ap',
    proto: 'static',
    ipaddr: '192.168.0.2',
    netmask: '255.255.255.0',
    gateway: '192.168.0.1',
    dns: ['192.168.0.1'],
    bridge_offload: false,
  });
  assert.deepEqual(toRequest(fixed({ dns: '9.9.9.9,1.1.1.1' })).dns, ['9.9.9.9', '1.1.1.1']);
  assert.equal(netmaskOf(22), '255.255.252.0');
  assert.equal(netmaskOf(16), '255.255.0.0');
});

test('the form starts automatic, with the main router and its network size from the WAN port', () => {
  const f = initialForm({ ipaddr: '192.168.0.57', prefix: 22, gateway: '192.168.0.1' }, true);
  assert.equal(f.proto, 'dhcp');
  assert.equal(f.prefix, '22');
  assert.equal(f.gateway, '192.168.0.1');
  assert.equal(f.ipaddr, '');
  assert.equal(f.bridgeOffload, true);
  // without an address on the WAN port (or a strange prefix): /24, nothing filled in
  assert.deepEqual(initialForm(null, false), { proto: 'dhcp', ipaddr: '', prefix: '24', gateway: '', dns: '', bridgeOffload: false });
  assert.equal(initialForm({ prefix: 31 }, false).prefix, '24');
});

test('where to open MilkFlint afterwards: its fixed address, or unknown when the main router picks', () => {
  assert.equal(apAddress(fixed({ ipaddr: ' 192.168.0.2 ' })), '192.168.0.2');
  assert.equal(apAddress(fixed({ proto: 'dhcp' })), undefined);
});
