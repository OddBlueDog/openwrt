// Address helpers the LAN, Guest Wi-Fi, VPN and Firewall pages check
// addresses with (their modules call the router too: tests/resolve.ts lets
// the tests import them).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wanBehindNat } from '../src/features/firewall/api.ts';
import { inSubnet, intToIp, ipToInt, prefixLength } from '../src/lib/api/network.ts';

test('a netmask or a prefix length, as a prefix length', () => {
  assert.equal(prefixLength(undefined), 24);
  assert.equal(prefixLength('24'), 24);
  assert.equal(prefixLength('255.255.255.0'), 24);
  assert.equal(prefixLength('255.255.254.0'), 23);
  assert.equal(prefixLength('255.255.255.255'), 32);
  assert.equal(prefixLength('255.0.0.0'), 8);
});

test('addresses to numbers and back', () => {
  assert.equal(ipToInt('192.168.1.1'), 0xc0a80101);
  assert.equal(ipToInt('0.0.0.0'), 0);
  assert.equal(ipToInt('255.255.255.255'), 0xffffffff);
  assert.equal(intToIp(0xc0a80101), '192.168.1.1');
  assert.equal(intToIp(0xffffffff), '255.255.255.255');
  for (const n of [0, 1, 0x0a000001, 0x7fffffff, 0x80000000, 0xfffffffe]) assert.equal(ipToInt(intToIp(n)), n);
});

test('anything else is not an address', () => {
  for (const bad of ['', '1.2.3', '1.2.3.4.5', '1.2.3.256', '1.2.3.-1', ' 1.2.3.4', '1.2.3.4 ', 'a.b.c.d', '1..2.3', '1.2.3.1000']) {
    assert.equal(ipToInt(bad), undefined, bad);
  }
});

test('a usable host address in the router’s subnet: not its network or broadcast address', () => {
  assert.equal(inSubnet('192.168.1.50', '192.168.1.1', 24), true);
  assert.equal(inSubnet('192.168.1.254', '192.168.1.1', 24), true);
  assert.equal(inSubnet('192.168.1.0', '192.168.1.1', 24), false);
  assert.equal(inSubnet('192.168.1.255', '192.168.1.1', 24), false);
  assert.equal(inSubnet('192.168.2.1', '192.168.1.1', 24), false);
  assert.equal(inSubnet('192.168.200.9', '192.168.1.1', 16), true);
  assert.equal(inSubnet('10.0.0.5', '10.0.0.1', 30), false);
  assert.equal(inSubnet('10.0.0.2', '10.0.0.1', 30), true);
  assert.equal(inSubnet('not an address', '192.168.1.1', 24), false);
});

test('a private or shared (CGNAT) internet address means nothing reaches port forwards', () => {
  assert.equal(wanBehindNat(undefined), undefined);
  for (const a of ['10.0.0.1', '172.16.0.1', '172.31.255.1', '192.168.0.10']) assert.equal(wanBehindNat(a), 'private', a);
  for (const a of ['100.64.0.1', '100.127.255.254']) assert.equal(wanBehindNat(a), 'cgnat', a);
  for (const a of ['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '81.2.69.142', '192.169.0.1']) {
    assert.equal(wanBehindNat(a), undefined, a);
  }
});
