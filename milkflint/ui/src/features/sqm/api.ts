// Smart Queue's settings as saved: sqm's queues, with what the page shows
// beside them (the firewall's offloading, the internet connection's device,
// the router's devices, milkflint's CAKE options).
import { getDevices, getInterfaces } from '@/lib/api/network';
import { getConfig } from '@/lib/api/uci';
import { type SqmData, sqmData } from './model';

export async function loadSqm(): Promise<SqmData> {
  const [sqm, firewall, interfaces, devices, milkflint] = await Promise.all([
    getConfig('sqm').catch(() => undefined),
    getConfig('firewall'),
    getInterfaces(),
    getDevices(),
    getConfig('milkflint').catch(() => undefined),
  ]);
  const wan = interfaces.find((i) => i.interface === 'wan');
  return sqmData({
    sqm,
    firewall,
    milkflint,
    wanDevice: wan?.l3_device ?? wan?.device,
    wanProto: wan?.proto,
    devices: Object.keys(devices),
  });
}
