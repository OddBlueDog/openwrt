// The LAN & DHCP page's lease tables: names joined by MAC whatever its case,
// unnamed devices last, every DHCPv6 address kept, and the lease time in words.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatDuration } from '@/lib/format';
import { leaseLeftText, leaseRows4, leaseRows6, leftText } from '@/features/lan/leases';

test('lease left: Never ends, a duration, Expired, or nothing when unknown', () => {
  assert.equal(leftText(false), 'Never ends');
  assert.equal(leftText(39720), formatDuration(39720));
  assert.equal(leftText(0), 'Expired');
  assert.equal(leftText(-5), 'Expired');
  assert.equal(leftText(undefined), '');
});

test('IPv4 leases are named by MAC whatever its case, and unnamed ones come last', () => {
  const names = new Map([['aa:00:00:00:01:20', 'Studio Mac']]);
  const rows = leaseRows4(
    [
      { macaddr: 'AA:00:00:00:09:99', ipaddr: '192.168.1.9', expires: false },
      { macaddr: 'AA:00:00:00:01:20', ipaddr: '192.168.1.20', expires: 100 },
      { macaddr: 'aa:00:00:00:05:55', hostname: 'zebra', ipaddr: '192.168.1.5' },
    ],
    names,
  );
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Studio Mac', 'zebra', undefined],
  );
  assert.deepEqual(rows[0]?.addrs, ['192.168.1.20']);
  assert.equal(rows[2]?.expires, false);
  assert.equal(new Set(rows.map((r) => r.key)).size, 3);
});

test('DHCPv6 leases keep every address and the DUID, and fall back to the lease hostname without a MAC', () => {
  const rows = leaseRows6(
    [
      { macaddr: 'AA:00:00:00:01:20', duid: '0001', ip6addrs: ['fd00:1::20', 'fd00:1::21'], expires: 40000 },
      { hostname: 'printer', duid: '00030001aa', ip6addrs: ['fd00:1::31'], expires: false },
    ],
    new Map([['aa:00:00:00:01:20', 'Studio Mac']]),
  );
  // sorted by name: printer, then Studio Mac
  const mac = rows.find((r) => r.duid === '0001');
  const printer = rows.find((r) => r.duid === '00030001aa');
  assert.ok(mac && printer);
  assert.equal(mac.name, 'Studio Mac');
  assert.deepEqual(mac.addrs, ['fd00:1::20', 'fd00:1::21']);
  assert.equal(printer.name, 'printer');
  assert.equal(printer.mac, undefined);
});

test('two DHCPv6 leases with one DUID get two distinct keys', () => {
  const rows = leaseRows6(
    [
      { duid: '0001', ip6addrs: ['fd00:1::20'], expires: 100 },
      { duid: '0001', ip6addrs: ['fd00:1::21'], expires: 100 },
    ],
    new Map(),
  );
  assert.equal(new Set(rows.map((r) => r.key)).size, 2);
});

test('SLAAC: addresses a device picked itself go on its lease row, or a row of their own; link-local and leased ones are left out', () => {
  const rows = leaseRows6(
    [{ macaddr: 'AA:00:00:00:01:20', duid: '0001', ip6addrs: ['fd00:1::20'], expires: 40000 }],
    new Map([['aa:00:00:00:01:20', 'Studio Mac']]),
    {
      'aa:00:00:00:01:20': { ip6addrs: ['fd00:1::20', '2001:DB8:1:1::20', 'fe80::1'] },
      'bb:00:00:00:00:02': { name: 'pixel-8.lan', ip6addrs: ['2001:db8:1:1::99', 'fe80::2'] },
      'cc:00:00:00:00:03': { ip6addrs: ['fe80::3'] },
    },
  );
  assert.equal(rows.length, 2);
  const mac = rows.find((r) => r.name === 'Studio Mac');
  const phone = rows.find((r) => r.mac === 'bb:00:00:00:00:02');
  assert.ok(mac && phone);
  assert.deepEqual(mac.addrs, ['fd00:1::20']);
  assert.deepEqual(mac.slaac, ['2001:db8:1:1::20']);
  assert.equal(leaseLeftText(mac), leftText(40000));
  assert.equal(phone.name, 'pixel-8');
  assert.deepEqual(phone.addrs, []);
  assert.deepEqual(phone.slaac, ['2001:db8:1:1::99']);
  assert.equal(leaseLeftText(phone), 'No lease (SLAAC)');
});
