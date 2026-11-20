// The router's Ethernet ports, for Home's widget: which have a link and at
// what speed, the networks each carries, and its traffic now. The ports are
// the board's own list (as LuCI's port status reads it), else the switch's
// ports and the WAN port; their state is netifd's. Plain data, so the tests
// check it.
import type { BuiltinPort, NetworkDevice, NetworkInterface } from '@/lib/api/network';

export interface Port {
  device: string;
  /** "WAN", "LAN 1"… */
  label: string;
  wan: boolean;
  /** A cable is in and the link is up. */
  link: boolean;
  /** The link's speed, Mbit/s; undefined without a link (or when the port can't say). */
  mbit: number | undefined;
  /** A half-duplex link: usually a cable or device fault. */
  half: boolean;
  /** The fastest the port can go, Mbit/s. */
  maxMbit: number | undefined;
  /** The networks it carries, as the pages name them ("Internet", "LAN", "guest"); none for a port that isn't used. */
  networks: string[];
  /** Its traffic now, bit/s, as the household sees it: towards the devices (from the internet, on the WAN port), and back. */
  down: number | undefined;
  up: number | undefined;
}

/** "1000F" (netifd's) as Mbit/s and duplex; undefined for anything else. */
export function linkSpeed(speed: string | undefined): { mbit: number; half: boolean } | undefined {
  const m = /^(\d+)([FH])$/.exec(speed ?? '');
  if (m === null || Number(m[1]) <= 0) return undefined;
  return { mbit: Number(m[1]), half: m[2] === 'H' };
}

/** The fastest of a port's speeds ("2500baseT-F", "1000baseT-F"…), Mbit/s. */
export function fastest(supported: readonly string[] | undefined): number | undefined {
  const all = (supported ?? []).flatMap((s) => {
    const m = /^(\d+)base/.exec(s);
    return m === null ? [] : [Number(m[1])];
  });
  return all.length === 0 ? undefined : Math.max(...all);
}

/** "1 Gbit/s", "2.5 Gbit/s", "100 Mbit/s" */
export function speedText(mbit: number): string {
  return mbit >= 1000 ? `${String(mbit / 1000)} Gbit/s` : `${String(mbit)} Mbit/s`;
}

/** "WAN" for the internet port, "LAN 1" for lan1, else the device's own name. */
export function portLabel(p: BuiltinPort): string {
  if (p.role === 'wan') return 'WAN';
  const lan = /^lan(\d+)$/.exec(p.device);
  return lan === null ? p.device : `LAN ${lan[1] ?? ''}`;
}

const NETWORK_NAMES: Record<string, string> = { wan: 'Internet', wan6: 'Internet', wan_6: 'Internet', lan: 'LAN' };

/**
 * The networks a port carries: an interface on the port itself, on one of its
 * VLANs (eth1.911), or on a bridge it's in (br-lan). In the pages' words, each once.
 */
export function portNetworks(
  device: string,
  interfaces: readonly NetworkInterface[],
  devices: Readonly<Record<string, NetworkDevice>>,
): string[] {
  const onPort = (dev: string | undefined): boolean => dev === device || (dev?.startsWith(`${device}.`) ?? false);
  const names = interfaces
    .filter((i) => i.interface !== 'loopback')
    .filter((i) => onPort(i.device) || (devices[i.device ?? '']?.['bridge-members'] ?? []).some(onPort))
    .map((i) => NETWORK_NAMES[i.interface] ?? i.interface);
  return [...new Set(names)];
}

/**
 * The ports to show: the board's list when the router gives it, else the
 * switch's ports (devtype dsa) and the WAN interface's port. The WAN port
 * first, then the rest in the board's order.
 */
export function portList(
  builtin: readonly BuiltinPort[] | undefined,
  devices: Readonly<Record<string, NetworkDevice>>,
  wan: NetworkInterface | undefined,
): BuiltinPort[] {
  let list: BuiltinPort[];
  if (builtin !== undefined && builtin.length > 0) list = [...builtin];
  else {
    const wanPort = wan?.device?.split('.')[0];
    const switchPorts = Object.entries(devices)
      .filter(([name, d]) => d.devtype === 'dsa' && name !== wanPort)
      .map(([name]) => name)
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    list = [
      ...(wanPort !== undefined && devices[wanPort] !== undefined ? [{ role: 'wan', device: wanPort }] : []),
      ...switchPorts.map((device) => ({ role: 'lan', device })),
    ];
  }
  return [...list.filter((p) => p.role === 'wan'), ...list.filter((p) => p.role !== 'wan')];
}

/** Each port's state now. `rate` is the device's rx or tx since the last sample, bit/s. */
export function portsOf(
  list: readonly BuiltinPort[],
  devices: Readonly<Record<string, NetworkDevice>>,
  interfaces: readonly NetworkInterface[],
  rate: (device: string, dir: 'rx' | 'tx') => number | undefined,
): Port[] {
  return list.map((p): Port => {
    const d = devices[p.device];
    const link = d?.carrier === true;
    const speed = link ? linkSpeed(d.speed) : undefined;
    const wan = p.role === 'wan';
    return {
      device: p.device,
      label: portLabel(p),
      wan,
      link,
      mbit: speed?.mbit,
      half: speed?.half ?? false,
      maxMbit: fastest(d?.['link-supported']),
      networks: portNetworks(p.device, interfaces, devices),
      // the WAN port receives what the household downloads; a LAN port sends it to the devices
      down: rate(p.device, wan ? 'rx' : 'tx'),
      up: rate(p.device, wan ? 'tx' : 'rx'),
    };
  });
}
