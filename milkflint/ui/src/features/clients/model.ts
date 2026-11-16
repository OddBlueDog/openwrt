// A device's entry in dhcp: a host section can hold just a name, and only one
// with an address is a reservation. And what the All devices page says about
// them: how many are online and how, and what's wrong with an edit. And a
// device's name, the same on every page that lists devices (All devices,
// Data usage, Home).
import { inSubnet } from '@/lib/api/network';
import { type Change, type Section, str } from '@/lib/api/uci';
import type { Device } from './api';

/** What a device without a name is called, wherever devices are listed; its address goes beside or under it. */
export const UNNAMED_DEVICE = 'Unnamed device';

/** A device's name, or that it has none. */
export const deviceLabel = (name: string | undefined): string => name ?? UNNAMED_DEVICE;

/**
 * A device's name, as All devices finds it: the one you gave it there (its
 * dhcp host section), else the one it sent when it asked for an address,
 * else the router's host hint (its first label). Undefined when none.
 */
export function deviceName(given: string | undefined, lease: string | undefined, hint: string | undefined): string | undefined {
  return [given, lease, hint?.split('.')[0]].find((n) => n !== undefined && n !== '');
}

/** The address reserved for a device; a section that only names it has none. */
export const reservedIp = (host: Section | undefined): string | undefined => str(host, 'ip');

/** The changes for saving the editor; `section` is the device's host section, if it has one. */
export function editChanges(section: string | undefined, mac: string, name: string, reserve: boolean, ip: string): Change[] {
  if (!reserve && name === '') return section === undefined ? [] : [{ op: 'delete', config: 'dhcp', section }];
  const values = { ...(name === '' ? {} : { name }), ...(reserve ? { ip } : {}) };
  if (section === undefined) return [{ op: 'add', config: 'dhcp', type: 'host', values: { mac, dns: '1', ...values } }];
  const changes: Change[] = [{ op: 'set', config: 'dhcp', section, values }];
  const unset = [...(name === '' ? ['name'] : []), ...(reserve ? [] : ['ip'])];
  if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section, options: unset });
  return changes;
}

export interface DeviceCounts {
  known: number;
  online: number;
  wifi: number;
  wired: number;
  /** Wi-Fi devices by band, lowest band first */
  bands: { band: string; count: number }[];
}

const BAND_ORDER = ['2.4 GHz', '5 GHz', '6 GHz'];

/** How many devices are online, and how: on Wi-Fi (by band) or wired. */
export function deviceCounts(devices: readonly Pick<Device, 'online' | 'wifi'>[]): DeviceCounts {
  const bands = new Map<string, number>();
  let online = 0;
  let wifi = 0;
  for (const d of devices) {
    if (!d.online) continue;
    online += 1;
    if (d.wifi === undefined) continue;
    wifi += 1;
    const band = d.wifi.band ?? 'Wi-Fi';
    bands.set(band, (bands.get(band) ?? 0) + 1);
  }
  const rank = (b: string): number => {
    const i = BAND_ORDER.indexOf(b);
    return i === -1 ? BAND_ORDER.length : i;
  };
  return {
    known: devices.length,
    online,
    wifi,
    wired: online - wifi,
    bands: [...bands].map(([band, count]) => ({ band, count })).sort((a, b) => rank(a.band) - rank(b.band)),
  };
}

/** How it's connected now, in a few words: "5 GHz · Home", "Wired", "Offline". */
export function connectionText(d: Pick<Device, 'online' | 'wifi'>): string {
  if (d.wifi !== undefined) return [d.wifi.band ?? 'Wi-Fi', d.wifi.ssid].filter((x) => x !== undefined && x !== '').join(' · ');
  return d.online ? 'Wired' : 'Offline';
}

/** Whether a device matches what's typed in the search: its name, address, MAC or Wi-Fi network. */
export function matches(d: Pick<Device, 'name' | 'ip' | 'mac' | 'wifi'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || [d.name, d.ip, d.mac, d.wifi?.ssid].some((v) => v?.toLowerCase().includes(q) === true);
}

/** A name a device can have: it becomes its local name on the network. */
export function nameError(name: string): string | undefined {
  return name !== '' && !/^[A-Za-z0-9-]{1,63}$/.test(name)
    ? 'Letters, digits and hyphens only (it becomes the device’s local name).'
    : undefined;
}

/** What's wrong with reserving `ip` for the device `mac`, if anything. */
export function reserveError(
  ip: string,
  mac: string,
  data: { devices: readonly Pick<Device, 'mac' | 'name' | 'reservation'>[]; routerIp: string; prefix: number },
): string | undefined {
  if (!inSubnet(ip, data.routerIp, data.prefix))
    return `Use an address in your network (${data.routerIp}/${String(data.prefix)}).`;
  if (ip === data.routerIp) return 'That’s the router’s own address.';
  const takenBy = data.devices.find((d) => d.mac !== mac && reservedIp(d.reservation) === ip);
  return takenBy === undefined ? undefined : `Already reserved for ${takenBy.name ?? takenBy.mac}.`;
}
