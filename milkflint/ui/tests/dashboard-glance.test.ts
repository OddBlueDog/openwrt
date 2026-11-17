// Home's status tiles in a word or number: the internet, how responsive it
// is, the Wi-Fi and the devices.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devicesGlance, internetGlance, responsivenessGlance, wifiGlance } from '@/features/dashboard/glance';
import type { Dashboard } from '@/features/dashboard/use-dashboard';
import type { Sample } from '@/features/network-quality/api';

type D = Dashboard;
const dash = (d: unknown): D => d as D;

test('internet: online, offline, not set up, and the main router in access point mode', () => {
  const online = internetGlance(dash({ wan: { up: true } }), false);
  assert.deepEqual(
    { title: online.title, value: online.value, tone: online.tone, route: online.route },
    { title: 'Internet', value: 'Online', tone: 'success', route: 'internet' },
  );
  const offline = internetGlance(dash({ wan: { up: false } }), false);
  assert.deepEqual([offline.value, offline.tone], ['Offline', 'destructive']);
  const none = internetGlance(dash({ wan: undefined }), false);
  assert.deepEqual([none.value, none.tone], ['Not set up', 'off']);
  const lan = { up: true, route: [{ target: '0.0.0.0', mask: 0, nexthop: '192.168.1.1' }] };
  const ap = internetGlance(dash({ lan }), true);
  assert.deepEqual(
    { title: ap.title, value: ap.value, tone: ap.tone, route: ap.route },
    { title: 'Main router', value: 'Connected', tone: 'success', route: 'mode' },
  );
  const apDown = internetGlance(dash({ lan: { up: false } }), true);
  assert.deepEqual([apDown.value, apDown.tone], ['Not connected', 'destructive']);
});

test('wi-fi: off, on, and a band that is down', () => {
  const radio = (off: boolean, up: boolean): unknown => ({ off, up });
  assert.deepEqual(
    [wifiGlance(dash({ radios: [radio(true, false)] })).value, wifiGlance(dash({ radios: [radio(true, false)] })).tone],
    ['Off', 'off'],
  );
  const on = wifiGlance(dash({ radios: [radio(false, true), radio(false, true)] }));
  assert.deepEqual({ value: on.value, tone: on.tone, route: on.route }, { value: 'On', tone: 'success', route: 'wifi' });
  const down = wifiGlance(dash({ radios: [radio(false, true), radio(false, false)] }));
  assert.deepEqual([down.value, down.tone], ['1 band down', 'warning']);
});

test('devices: Wi-Fi and wired together, or Wi-Fi alone when wired is unknown', () => {
  const both = devicesGlance(dash({ clients: [{}, {}, {}], wired: 2 }));
  assert.deepEqual(
    { value: both.value, detail: both.detail, tone: both.tone, route: both.route },
    { value: '5', detail: 'online', tone: undefined, route: 'clients' },
  );
  assert.equal(devicesGlance(dash({ clients: [{}, {}, {}], wired: undefined })).value, '3');
});

test('responsiveness: measuring, unavailable, off, and the recent ping with its word', () => {
  assert.deepEqual(
    [responsivenessGlance({}).value, responsivenessGlance({}).tone, responsivenessGlance({}).route],
    ['Measuring', 'info', 'network-quality'],
  );
  const failed = responsivenessGlance({ error: new Error('no answer') });
  assert.deepEqual([failed.value, failed.tone], ['Unavailable', 'off']);
  const off = responsivenessGlance({ data: { status: { enabled: false, now: 0 }, samples: [] } });
  assert.deepEqual([off.value, off.tone], ['Off', 'off']);
  const now = 10_000;
  const ping = (t: number, internet: number): Sample => ({ t, gateway: null, internet, dns: 5 });
  const samples = Array.from({ length: 720 }, (_, i) => ping(now - 3595 + i * 5, 12));
  const steady = responsivenessGlance({ data: { status: { enabled: true, now }, samples } });
  assert.equal(steady.value, '12 ms');
  assert.equal(steady.detail, 'Steady');
  assert.equal(steady.tone, 'success');
});
