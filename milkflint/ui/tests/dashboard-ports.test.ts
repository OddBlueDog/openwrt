// Home's Ethernet ports (src/features/dashboard/ports.ts): netifd's speed and
// the port's own, the board's list or a guess at it, and the networks each
// port carries, through a bridge or a VLAN.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NetworkDevice, NetworkInterface } from '@/lib/api/network';
import { fastest, linkSpeed, portLabel, portList, portNetworks, portsOf, speedText } from '@/features/dashboard/ports';

const iface = (name: string, device: string, over: Partial<NetworkInterface> = {}): NetworkInterface => ({
  interface: name,
  up: true,
  proto: 'static',
  device,
  ...over,
});

// the Flint 2 as netifd sees it: lan1-lan5 in br-lan, the WAN port eth1
const devices: Record<string, NetworkDevice> = {
  eth0: { type: 'Network device', up: true, carrier: true, speed: '10000F' },
  eth1: { type: 'Network device', up: true, carrier: true, speed: '1000F', 'link-supported': ['1000baseT-F', '2500baseT-F'] },
  lan1: { devtype: 'dsa', carrier: true, speed: '1000F', 'link-supported': ['10baseT-H', '1000baseT-F'] },
  lan2: { devtype: 'dsa', carrier: false, speed: '-1F' },
  lan3: { devtype: 'dsa', carrier: true, speed: '100H' },
  lan5: { devtype: 'dsa', carrier: true, speed: '2500F' },
  'br-lan': { type: 'bridge', 'bridge-members': ['lan1', 'lan2', 'lan3', 'lan5'] },
};
const interfaces = [iface('loopback', 'lo'), iface('lan', 'br-lan'), iface('wan', 'eth1'), iface('wan6', 'eth1')];

test('netifd’s speed as Mbit/s and duplex; no speed without a real one', () => {
  assert.deepEqual(linkSpeed('1000F'), { mbit: 1000, half: false });
  assert.deepEqual(linkSpeed('100H'), { mbit: 100, half: true });
  for (const s of [undefined, '', '-1F', '0F', 'F', '1000', 'fast']) assert.equal(linkSpeed(s), undefined, String(s));
});

test('the fastest a port goes, and speeds in words', () => {
  assert.equal(fastest(['10baseT-H', '2500baseT-F', '1000baseT-F']), 2500);
  assert.equal(fastest(['autoneg']), undefined);
  assert.equal(fastest(undefined), undefined);
  assert.equal(speedText(2500), '2.5 Gbit/s');
  assert.equal(speedText(1000), '1 Gbit/s');
  assert.equal(speedText(10_000), '10 Gbit/s');
  assert.equal(speedText(100), '100 Mbit/s');
});

test('labels: WAN for the internet port, LAN n for lann, else the device', () => {
  assert.equal(portLabel({ role: 'wan', device: 'eth1' }), 'WAN');
  assert.equal(portLabel({ role: 'lan', device: 'lan3' }), 'LAN 3');
  assert.equal(portLabel({ role: 'lan', device: 'eth0' }), 'eth0');
});

test('the board’s list, the WAN port first; without it, the switch’s ports and the WAN interface’s', () => {
  const board = [
    { role: 'lan', device: 'lan1' },
    { role: 'lan', device: 'lan2' },
    { role: 'wan', device: 'eth1' },
  ];
  assert.deepEqual(
    portList(board, devices, undefined).map((p) => p.device),
    ['eth1', 'lan1', 'lan2'],
  );
  const wan = iface('wan', 'eth1.911');
  assert.deepEqual(portList(undefined, devices, wan), [
    { role: 'wan', device: 'eth1' },
    { role: 'lan', device: 'lan1' },
    { role: 'lan', device: 'lan2' },
    { role: 'lan', device: 'lan3' },
    { role: 'lan', device: 'lan5' },
  ]);
  assert.deepEqual(portList([], devices, undefined).length, 4);
});

test('the networks a port carries: on it, on a VLAN of it, or through a bridge', () => {
  assert.deepEqual(portNetworks('eth1', interfaces, devices), ['Internet']);
  assert.deepEqual(portNetworks('lan1', interfaces, devices), ['LAN']);
  assert.deepEqual(portNetworks('lan4', interfaces, devices), []);
  // a provider's VLAN on the WAN port, a guest network on a port of its own
  const more = [iface('wan', 'eth1.911'), iface('guest', 'lan4')];
  assert.deepEqual(portNetworks('eth1', more, devices), ['Internet']);
  assert.deepEqual(portNetworks('lan4', more, devices), ['guest']);
  // access point mode: the WAN port in the LAN's bridge; "eth10" isn't eth1
  const ap = { ...devices, 'br-lan': { 'bridge-members': ['eth1', 'lan1'] }, eth10: {} };
  assert.deepEqual(portNetworks('eth1', [iface('lan', 'br-lan')], ap), ['LAN']);
  assert.deepEqual(portNetworks('eth10', [iface('lan', 'br-lan')], ap), []);
});

test('each port’s state: a link and its speed, and traffic as the household sees it', () => {
  const rates: Record<string, { rx: number; tx: number }> = { eth1: { rx: 300, tx: 20 }, lan1: { rx: 5, tx: 90 } };
  const list = portList(
    [
      { role: 'lan', device: 'lan1' },
      { role: 'lan', device: 'lan2' },
      { role: 'lan', device: 'lan3' },
      { role: 'wan', device: 'eth1' },
    ],
    devices,
    undefined,
  );
  const ports = portsOf(list, devices, interfaces, (dev, dir) => rates[dev]?.[dir]);
  assert.deepEqual(
    ports.map((p) => [p.label, p.link, p.mbit, p.half, p.maxMbit, p.down, p.up]),
    [
      // the WAN port receives what's downloaded; a LAN port sends it on
      ['WAN', true, 1000, false, 2500, 300, 20],
      ['LAN 1', true, 1000, false, 1000, 90, 5],
      ['LAN 2', false, undefined, false, undefined, undefined, undefined],
      ['LAN 3', true, 100, true, undefined, undefined, undefined],
    ],
  );
});
