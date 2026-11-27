// Home's Busiest devices (src/features/dashboard/model.ts): wired devices'
// traffic from the bytes of their connections through the router, folded by
// MAC across their IPv4 and IPv6 addresses (the router's own left out), and
// the list for All, Wi-Fi or LAN, busiest first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { busyDevices, wiredSums } from '@/features/dashboard/model';
import type { Client } from '@/features/dashboard/use-dashboard';

const names = new Map([
  ['192.168.1.20', { mac: 'aa:00:00:00:00:20', name: 'desktop' }],
  ['2001:db8::20', { mac: 'aa:00:00:00:00:20', name: 'desktop' }],
  ['192.168.1.30', { mac: 'aa:00:00:00:00:30', name: 'phone' }],
]);

test('wired sums: one device across its addresses, an unknown address by itself, the router left out', () => {
  const sums = wiredSums(
    [
      { addr: 'router', n: 9, bytes: 900, out: 400, in: 500 },
      { addr: '2001:db8::20', n: 2, bytes: 300, out: 100, in: 200 },
      { addr: '192.168.1.20', n: 3, bytes: 3000, out: 1000, in: 2000 },
      { addr: '192.168.1.99', n: 1, bytes: 10, out: 4, in: 6 },
    ],
    names,
  );
  assert.deepEqual(sums, [
    { key: 'aa:00:00:00:00:20', mac: 'aa:00:00:00:00:20', name: 'desktop', ip: '192.168.1.20', received: 2200, sent: 1100 },
    { key: '192.168.1.99', mac: undefined, name: undefined, ip: '192.168.1.99', received: 6, sent: 4 },
  ]);
});

const client = (mac: string, name: string, down: number): Client =>
  ({ mac, name, ip: '192.168.1.30', down, up: 0, signal: -60 }) as Client;

test('All, Wi-Fi or LAN, busiest first; a Wi-Fi device’s connections don’t make it wired too', () => {
  const wifi = [client('aa:00:00:00:00:30', 'phone', 50_000), client('aa:00:00:00:00:31', 'tablet', 0)];
  const wired = [
    { key: 'aa:00:00:00:00:20', mac: 'aa:00:00:00:00:20', name: 'desktop', ip: '192.168.1.20', down: 900_000, up: 1000 },
    // the phone's connections, seen by the router too: it's on the Wi-Fi
    { key: 'aa:00:00:00:00:30', mac: 'aa:00:00:00:00:30', name: 'phone', ip: '192.168.1.30', down: 40_000, up: 0 },
  ];
  assert.deepEqual(
    busyDevices(wifi, wired, 'all').map((d) => [d.name, d.wifi === undefined ? 'cable' : 'wifi']),
    [
      ['desktop', 'cable'],
      ['phone', 'wifi'],
      ['tablet', 'wifi'],
    ],
  );
  assert.deepEqual(
    busyDevices(wifi, wired, 'wifi').map((d) => d.name),
    ['phone', 'tablet'],
  );
  assert.deepEqual(
    busyDevices(wifi, wired, 'lan').map((d) => d.name),
    ['desktop'],
  );
});
