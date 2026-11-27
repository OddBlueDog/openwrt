// The shared names module: MAC -> name, and address -> device, plus the one DHCP lease call's mapping.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addressNamesFrom, leasedNames, namesFrom } from '../src/lib/api/names.ts';
import { leasesFrom, type Lease, type Lease6, type Neighbor } from '../src/lib/api/network.ts';

test('namesFrom: a dhcp host name wins over a lease, which wins over a hint (domain cut)', () => {
  const names = namesFrom(
    new Map([['aa:bb:cc:00:00:01', 'Given']]),
    new Map([
      ['aa:bb:cc:00:00:01', 'Leased'],
      ['aa:bb:cc:00:00:02', 'Leased2'],
    ]),
    new Map([
      ['aa:bb:cc:00:00:02', 'Hinted.lan'],
      ['aa:bb:cc:00:00:03', 'Hinted3.lan'],
    ]),
  );
  assert.equal(names.get('aa:bb:cc:00:00:01'), 'Given');
  assert.equal(names.get('aa:bb:cc:00:00:02'), 'Leased2');
  assert.equal(names.get('aa:bb:cc:00:00:03'), 'Hinted3');
});

test('namesFrom: MACs match case-insensitively', () => {
  const names = namesFrom(new Map([['AA:BB:CC:00:00:01', 'Given']]), new Map([['aa:bb:cc:00:00:01', 'Leased']]), new Map());
  assert.equal(names.size, 1);
  assert.equal(names.get('aa:bb:cc:00:00:01'), 'Given');
});

const mac = 'aa:bb:cc:00:00:09';
const none: Neighbor[] = [];

test('addressNamesFrom: a hint maps its IPv4 and IPv6 addresses to one device', () => {
  const m = addressNamesFrom(
    { [mac.toUpperCase()]: { name: 'Phone.lan', ipaddrs: ['192.168.1.37'], ip6addrs: ['fd12::1a2b', '2001:db8::5'] } },
    [],
    [],
    none,
    new Map([[mac, 'Phone']]),
  );
  for (const a of ['192.168.1.37', 'fd12::1a2b', '2001:db8::5']) assert.deepEqual(m.get(a), { mac, name: 'Phone' });
});

test('addressNamesFrom: a v6 lease maps its addresses to its MAC', () => {
  const v6: Lease6[] = [{ macaddr: mac.toUpperCase(), ip6addrs: ['fd12::7'] }];
  const m = addressNamesFrom({}, [], v6, none, new Map([[mac, 'Phone']]));
  assert.deepEqual(m.get('fd12::7'), { mac, name: 'Phone' });
});

test('addressNamesFrom: a v4 lease and a neighbour fill addresses no hint has', () => {
  const v4: Lease[] = [{ macaddr: mac, ipaddr: '192.168.1.50' }];
  const n: Neighbor[] = [{ ip: '192.168.1.60', mac: 'AA:BB:CC:00:00:0A', dev: 'br-lan', state: 2 }];
  const m = addressNamesFrom({}, v4, [], n, new Map());
  assert.deepEqual(m.get('192.168.1.50'), { mac });
  assert.equal(m.get('192.168.1.60')?.mac, 'aa:bb:cc:00:00:0a');
});

test('addressNamesFrom: an address with no MAC is absent', () => {
  const m = addressNamesFrom({}, [{ macaddr: '', ipaddr: '192.168.1.9' }], [{ ip6addrs: ['fd12::9'] }], none, new Map());
  assert.equal(m.has('192.168.1.9'), false);
  assert.equal(m.has('fd12::9'), false);
});

test('leasesFrom: strips /128, keeps false (never ends) and -1 (expired), folds ip6addr', () => {
  const r = leasesFrom({
    dhcp_leases: [
      { expires: false, macaddr: 'AA:BB:CC:00:00:01', ipaddr: '192.168.1.5' },
      { expires: -1, macaddr: 'AA:BB:CC:00:00:02' },
    ],
    dhcp6_leases: [
      { expires: false, macaddr: 'aa', duid: 'd', iaid: 1, ip6addr: 'fd12::1/128', ip6addrs: ['fd12::1/128', 'fd12::2/128'] },
      { expires: 100, ip6addr: 'fd12::3/128', hostname: 'x' },
    ],
  });
  assert.equal(r.v4[0]?.expires, false);
  assert.equal(r.v4[1]?.expires, -1);
  assert.deepEqual(r.v6[0]?.ip6addrs, ['fd12::1', 'fd12::2']);
  assert.deepEqual(r.v6[1]?.ip6addrs, ['fd12::3']);
  assert.equal(r.v6[1].expires, 100);
});

test('leasesFrom: a missing dhcp6_leases gives an empty v6', () => {
  assert.deepEqual(leasesFrom({ dhcp_leases: [] }), { v4: [], v6: [] });
  assert.deepEqual(leasesFrom({}), { v4: [], v6: [] });
});

test('leasedNames: a nameless IPv6 lease does not erase the IPv4 lease name of the same MAC', () => {
  const v4: Lease[] = [{ macaddr: 'aa:bb:cc:00:00:01', hostname: 'laptop', ipaddr: '192.168.1.5' }];
  const v6: Lease6[] = [
    { macaddr: 'aa:bb:cc:00:00:01', ip6addrs: ['fd12::1'] },
    { macaddr: 'aa:bb:cc:00:00:02', hostname: '', ip6addrs: ['fd12::2'] },
  ];
  const leased = leasedNames(v4, v6);
  assert.equal(leased.get('aa:bb:cc:00:00:01'), 'laptop');
  assert.equal(leased.has('aa:bb:cc:00:00:02'), false);
});
