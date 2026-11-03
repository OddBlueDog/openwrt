// Address helpers the LAN, Guest Wi-Fi, VPN and Firewall pages check
// addresses with (their modules call the router too: tests/resolve.ts lets
// the tests import them).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { wanBehindNat } from '../src/features/firewall/api.ts';
import { globalIpv6, hintName, inSubnet, intToIp, ipToInt, isPrivateMac, prefixLength } from '../src/lib/api/network.ts';
import { describeRate, generationOf } from '../src/lib/api/wireless.ts';

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

test('private (made-up) MAC addresses: the locally administered bit', () => {
  for (const mac of ['02:00:00:00:00:01', '0A:12:34:56:78:9A', '3e:00:00:00:00:02', 'f6:aa:bb:cc:dd:ee']) assert.equal(isPrivateMac(mac), true, mac);
  for (const mac of ['00:00:5e:00:53:01', 'A4:83:E7:12:34:56', '94:00:00:00:00:01', '']) assert.equal(isPrivateMac(mac), false, mac);
});

test('hint names lose the local domain', () => {
  assert.equal(hintName({ name: 'iPhone.lan' }), 'iPhone');
  assert.equal(hintName({ name: 'printer' }), 'printer');
  assert.equal(hintName({ name: '' }), undefined);
  assert.equal(hintName({}), undefined);
  assert.equal(hintName(undefined), undefined);
});

test('only global IPv6 addresses', () => {
  assert.deepEqual(
    globalIpv6(['2001:db8:1:2::618', 'fd00:1:2::618', 'fe80::1', 'FC00::1', '2001:db8::1']),
    ['2001:db8:1:2::618', '2001:db8::1'],
  );
  assert.deepEqual(globalIpv6(undefined), []);
});

test('the Wi-Fi generation of a rate', () => {
  assert.equal(generationOf(undefined), undefined);
  assert.equal(generationOf({ he: true }), undefined, 'no rate, nothing to go by');
  assert.equal(generationOf({ rate: 1200900, he: true, vht: false }), 6);
  assert.equal(generationOf({ rate: 2882400, eht: true, he: false }), 7);
  assert.equal(generationOf({ rate: 866700, vht: true }), 5);
  assert.equal(generationOf({ rate: 144400, ht: true }), 4);
  assert.equal(generationOf({ rate: 6000 }), 0);
  assert.equal(describeRate({ rate: 1200900, he: true, mcs: 11, nss: 2, mhz: 80 }), 'Wi-Fi 6 · MCS 11 · 2×2 · 80 MHz');
  assert.equal(describeRate({ rate: 6000 }), 'legacy');
});
