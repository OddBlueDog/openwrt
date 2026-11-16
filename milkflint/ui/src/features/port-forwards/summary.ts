// The Port forwards page's answer: which ports are open to which devices
// (port forwards that are on, and ports devices opened themselves through
// UPnP), and whether anything on the internet can reach the router at all.
import { wanBehindNat } from '../firewall/api';
import { isDmz, isInternetForward, type FirewallConfig, type Redirect } from '../firewall/model';
import { plural } from '../firewall/summary';

/** One open port (or range) as the summary lists it. */
export interface OpenPort {
  /** "tcp 25565", "udp 27015–27030", "tcp 8080 → 80", "every port" */
  text: string;
  name: string;
  /** opened by the device itself (UPnP) */
  upnp: boolean;
}

/** A device (or the router) the internet can reach, and on which ports. */
export interface Destination {
  /** its address; undefined is the router itself */
  ip: string | undefined;
  ports: OpenPort[];
  /** every port goes to it (DMZ) */
  dmz: boolean;
}

/**
 * public: the router has an internet address of its own; private: it's
 * behind another router; cgnat: the provider shares the address; none: no
 * IPv4 internet address right now.
 */
export type Reach = 'public' | 'private' | 'cgnat' | 'none';

export interface ForwardsSummary {
  /** port forwards from the internet that are on */
  forwards: number;
  /** and those that are off */
  off: number;
  /** ports devices opened themselves; undefined while UPnP is off or not installed */
  upnp: number | undefined;
  destinations: Destination[];
  reach: Reach;
  address: string | undefined;
}

/** The subset of the UPnP feature's mapping the summary reads. */
export interface Mapping {
  proto: string;
  ext_port: number;
  int_addr: string;
  int_port: number;
  description: string;
}

const dash = (p: string): string => p.replace(/[-:]/, '–');

function protoShort(r: Redirect): string {
  return r.proto.includes('all') ? 'any' : r.proto.join('/');
}

/** "tcp 25565", "tcp/udp 27015–27030", "tcp 8080 → 80", "every port". */
export function portText(r: Redirect): string {
  if (isDmz(r)) return 'every port';
  const ext = r.srcDport === undefined ? '' : dash(r.srcDport);
  const int = r.destPort === undefined ? ext : dash(r.destPort);
  return `${protoShort(r)} ${ext}${int !== ext && int !== '' ? ` → ${int}` : ''}`.trim();
}

export function forwardsSummary(
  cfg: FirewallConfig,
  wanAddress: string | undefined,
  upnpOn: boolean | undefined,
  mappings: readonly Mapping[] | undefined,
): ForwardsSummary {
  const internet = cfg.redirects.filter((r) => r.target === 'DNAT' && isInternetForward(r, cfg));
  const on = internet.filter((r) => r.enabled);
  const byIp = new Map<string, Destination>();
  const at = (ip: string | undefined): Destination => {
    const key = ip ?? '';
    let d = byIp.get(key);
    if (d === undefined) {
      d = { ip, ports: [], dmz: false };
      byIp.set(key, d);
    }
    return d;
  };
  for (const r of on) {
    const d = at(r.destIp);
    d.ports.push({ text: portText(r), name: r.name ?? r.label, upnp: false });
    if (isDmz(r)) d.dmz = true;
  }
  const upnp = upnpOn === true ? (mappings ?? []) : [];
  for (const m of upnp) {
    const port = m.int_port === m.ext_port ? String(m.ext_port) : `${String(m.ext_port)} → ${String(m.int_port)}`;
    at(m.int_addr).ports.push({ text: `${m.proto.toLowerCase()} ${port}`, name: m.description, upnp: true });
  }
  const kind = wanBehindNat(wanAddress);
  return {
    forwards: on.length,
    off: internet.length - on.length,
    upnp: upnpOn === true && mappings !== undefined ? mappings.length : undefined,
    destinations: [...byIp.values()],
    reach: wanAddress === undefined ? 'none' : (kind ?? 'public'),
    address: wanAddress,
  };
}

/** The page's headline: "No ports open", "3 ports open to 2 devices", "Every port open to one device". */
export function headline(s: ForwardsSummary): string {
  const ports = s.destinations.reduce((n, d) => n + d.ports.length, 0);
  if (ports === 0) return 'No ports open';
  const devices = s.destinations.filter((d) => d.ip !== undefined).length;
  const router = s.destinations.some((d) => d.ip === undefined);
  const dmz = s.destinations.filter((d) => d.dmz).length;
  if (dmz > 0) return `Every port open to ${dmz === 1 ? 'one device' : plural(dmz, 'device')}`;
  const to = [devices > 0 ? plural(devices, 'device') : undefined, router ? 'the router' : undefined]
    .filter((x) => x !== undefined)
    .join(' and ');
  return `${plural(ports, 'port')} open to ${to}`;
}
