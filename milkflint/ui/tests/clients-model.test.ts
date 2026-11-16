// The All devices page's editor: a name is one thing, a reserved address another.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Device } from '../src/features/clients/api.ts';
import {
  connectionText,
  deviceCounts,
  deviceLabel,
  deviceName,
  editChanges,
  matches,
  nameError,
  reservedIp,
  reserveError,
  UNNAMED_DEVICE,
} from '../src/features/clients/model.ts';
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

// ---- the All devices page's answer, search and checks ----

const device = (over: Partial<Device>): Device => ({
  mac: 'aa:bb:cc:dd:ee:01',
  name: undefined,
  ip: undefined,
  wifi: undefined,
  online: false,
  leaseExpires: undefined,
  reservation: undefined,
  ...over,
});
const wifi = (band: string | undefined, ssid = 'home'): Device['wifi'] => ({
  band,
  ssid,
  signal: -50,
  snr: 40,
  rate: 1e8,
  connected: 60,
});

test('the answer counts online devices, on Wi-Fi by band (lowest first) and wired', () => {
  const counts = deviceCounts([
    device({ online: true, wifi: wifi('5 GHz') }),
    device({ online: true, wifi: wifi('2.4 GHz') }),
    device({ online: true, wifi: wifi('5 GHz') }),
    device({ online: true }),
    device({ online: false }),
  ]);
  assert.deepEqual(counts, {
    known: 5,
    online: 4,
    wifi: 3,
    wired: 1,
    bands: [
      { band: '2.4 GHz', count: 1 },
      { band: '5 GHz', count: 2 },
    ],
  });
  assert.deepEqual(deviceCounts([]), { known: 0, online: 0, wifi: 0, wired: 0, bands: [] });
});

test('how a device is connected, in words', () => {
  assert.equal(connectionText(device({ online: true, wifi: wifi('5 GHz', 'home') })), '5 GHz · home');
  assert.equal(connectionText(device({ online: true, wifi: wifi(undefined, '') })), 'Wi-Fi');
  assert.equal(connectionText(device({ online: true })), 'Wired');
  assert.equal(connectionText(device({})), 'Offline');
});

test('search matches the name, address, MAC or Wi-Fi network, in any case', () => {
  const d = device({ name: 'Pixel-8', ip: '192.168.1.110', wifi: wifi('5 GHz', 'Home') });
  assert.ok(matches(d, ''));
  assert.ok(matches(d, 'pixel'));
  assert.ok(matches(d, '1.110'));
  assert.ok(matches(d, 'EE:01'));
  assert.ok(matches(d, 'home'));
  assert.ok(!matches(d, 'tv'));
});

test('a name and a reserved address are checked before saving', () => {
  assert.equal(nameError(''), undefined);
  assert.equal(nameError('living-room-tv'), undefined);
  assert.ok(nameError('living room') !== undefined);
  const data = {
    devices: [device({ mac: 'aa:bb:cc:dd:ee:02', name: 'nas', reservation: section('host', 'cfg01', { ip: '192.168.1.20' }) })],
    routerIp: '192.168.1.1',
    prefix: 24,
  };
  assert.equal(reserveError('192.168.1.50', 'aa:bb:cc:dd:ee:01', data), undefined);
  assert.match(reserveError('10.0.0.5', 'aa:bb:cc:dd:ee:01', data) ?? '', /in your network/);
  assert.match(reserveError('192.168.1.1', 'aa:bb:cc:dd:ee:01', data) ?? '', /router’s own/);
  assert.match(reserveError('192.168.1.20', 'aa:bb:cc:dd:ee:01', data) ?? '', /reserved for nas/);
  // its own reservation isn't taken by someone else
  assert.equal(reserveError('192.168.1.20', 'aa:bb:cc:dd:ee:02', data), undefined);
});

test('a device has one name on every page: yours, else the one it sent, else the router’s hint', () => {
  assert.equal(deviceName('nas', 'diskstation', 'ds.lan'), 'nas');
  assert.equal(deviceName(undefined, 'diskstation', 'ds.lan'), 'diskstation');
  assert.equal(deviceName(undefined, undefined, 'ds.lan'), 'ds', 'the hint’s first label');
  assert.equal(deviceName(undefined, '', ''), undefined, 'an empty name is none');
  assert.equal(deviceName(undefined, undefined, undefined), undefined);
  // without a name it's called the same everywhere, never by its bare address
  assert.equal(UNNAMED_DEVICE, 'Unnamed device');
  assert.equal(deviceLabel(undefined), 'Unnamed device');
  assert.equal(deviceLabel('nas'), 'nas');
});
