// The Clients page's edit dialog: a name is one thing, a reserved address another.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editChanges, reservedIp } from '../src/features/clients/model.ts';
import { applied, section } from './uci-fixture.ts';

const MAC = 'aa:bb:cc:dd:ee:ff';
const IP = '192.168.1.50';

test('naming a device twice never reserves its address', () => {
  // first save: a name and no reservation
  let dhcp = applied({ dhcp: [] }, editChanges(undefined, MAC, 'tv', false, IP));
  const first = dhcp['dhcp']?.[0];
  assert.ok(first !== undefined);
  assert.equal(first['name'], 'tv');
  assert.equal(reservedIp(first), undefined);
  // the dialog opens again with the switch off, as what the section says
  dhcp = applied(dhcp, editChanges(first['.name'], MAC, 'living-room-tv', reservedIp(first) !== undefined, IP));
  const second = dhcp['dhcp']?.[0];
  assert.equal(second?.['name'], 'living-room-tv');
  assert.equal(reservedIp(second), undefined);
});

test('ticked, the address is reserved; unticked, the name stays', () => {
  const named = section('host', 'h1', { mac: MAC, name: 'tv', dns: '1' });
  let dhcp = applied({ dhcp: [named] }, editChanges('h1', MAC, 'tv', true, IP));
  assert.equal(reservedIp(dhcp['dhcp']?.[0]), IP);
  dhcp = applied(dhcp, editChanges('h1', MAC, 'tv', false, IP));
  assert.equal(reservedIp(dhcp['dhcp']?.[0]), undefined);
  assert.equal(dhcp['dhcp']?.[0]?.['name'], 'tv');
});

test('no name and no reservation: the section goes, or none is made', () => {
  assert.deepEqual(editChanges('h1', MAC, '', false, IP), [{ op: 'delete', config: 'dhcp', section: 'h1' }]);
  assert.deepEqual(editChanges(undefined, MAC, '', false, IP), []);
});
