// Remote access as the page edits it, and the sections that make it. The
// server is OpenWrt's own WireGuard interface (wg_in) with a peer for each
// device, in a firewall zone of its own; everything is read back from those
// sections, so a change made in LuCI shows here. Its devices get DNS from
// the router, and, as set, the internet through home, the home network, the
// router's settings and each other. Off keeps every part (LuCI shows them
// turned off) and closes the port; Remove deletes them.
import { intToIp, ipToInt } from '@/lib/api/network';
import { type Owned, reconcile, type Wanted } from '@/lib/api/owned';
import type { Section } from '@/lib/api/uci';
import { formatConf, isKey, joinEndpoint } from '@/lib/api/wireguard';
import { addIntercept, interceptSection } from '../dns/intercept';
import { overlaps } from '../wifi-guest/model';
import { PEER_TYPE, SERVER, SERVER_FIREWALL, SERVER_META } from './sections';

export const DEFAULT_PORT = '51820';
/** A new tunnel's network: the router is x.y.z.1, its devices .2 to .254. */
export const PREFIX = 24;
/** How often a device's app says hello while it's quiet, so mobile networks keep its way in open. */
export const KEEPALIVE = 25;

export interface PeerForm {
  /** its section in /etc/config/network (named when this page made it, cfg… when LuCI did) */
  section: string;
  name: string;
  /** its address in the tunnel */
  ip: string;
  /** more of its allowed IPs, set in LuCI (a network behind it, say): kept as they are */
  otherIps: string[];
  enabled: boolean;
  publicKey: string;
  /** kept on the router for its QR code, as LuCI does; '' for one set up elsewhere with only its public key */
  privateKey: string;
  presharedKey: string;
}

export interface ServerForm {
  enabled: boolean;
  /** the router's address in the tunnel */
  address: string;
  /** its network's size: 24 here, kept as it is for one set up in LuCI */
  prefix: number;
  /** more addresses set in LuCI (an IPv6 one, say): kept as they are */
  extraAddresses: string[];
  port: string;
  /** what devices connect to: a hostname or address, '' for the internet port's own address */
  endpoint: string;
  /** a forwarding to the internet */
  internet: boolean;
  /** a forwarding to the home network */
  lan: boolean;
  /** the zone's input policy: the router's settings pages, SSH and the rest */
  admin: boolean;
  /** the zone's forward policy: devices reach each other */
  between: boolean;
  /** '' until it's first turned on: the router makes one then */
  privateKey: string;
  peers: PeerForm[];
}

export interface Range {
  ip: number;
  prefix: number;
}

export interface Wan {
  ipv4: string | undefined;
  ipv6: string | undefined;
  /** its gateway: the upstream router, or the provider's */
  gateway: string | undefined;
}

export interface ServerData {
  /** WireGuard is in the image (and the VPN pages' plugin) */
  installed: boolean;
  /** network.wg_in exists */
  exists: boolean;
  form: ServerForm;
  /** the server's public key, which devices' configs carry */
  publicKey: string | undefined;
  present: { network: Section[]; firewall: Section[]; milkflint: Section[] };
  wanZone: string;
  lanZone: string;
  lan: Range | undefined;
  /** other networks' addresses, so the tunnel isn't put on one */
  taken: (Range & { name: string })[];
  wan: Wan;
  /** the DNS page catches devices that use their own DNS: the zone gets its redirect too */
  dnsIntercept: boolean;
  /** UDP ports something else on the router listens on */
  portsInUse: number[];
  /** port forwards from the internet, so the server's port isn't one of them */
  forwards: { name: string; port: string }[];
}

export type Errors = Partial<Record<string, string>>;

// ---- addresses ----

function isPrivate(ip: number): boolean {
  const a = Math.floor(ip / 2 ** 24);
  const b = Math.floor(ip / 2 ** 16) % 256;
  return a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
}

function networkOf(ip: number, prefix: number): number {
  const size = 2 ** (32 - prefix);
  return Math.floor(ip / size) * size;
}

function lastOf(ip: number, prefix: number): number {
  return networkOf(ip, prefix) + 2 ** (32 - prefix) - 1;
}

/** "10.42.17.0/24" for a router address of 10.42.17.1. */
export function subnetOf(address: string, prefix: number): string {
  const ip = ipToInt(address);
  return ip === undefined ? '' : `${intToIp(networkOf(ip, prefix))}/${String(prefix)}`;
}

function clashes(ip: number, prefix: number, d: ServerData): string | undefined {
  if (d.lan !== undefined && overlaps(ip, prefix, d.lan.ip, d.lan.prefix)) return 'your home network';
  return d.taken.find((t) => overlaps(ip, prefix, t.ip, t.prefix))?.name;
}

/**
 * A /24 in 10.0.0.0/8 nothing here uses, picked at random so it's unlikely
 * to be the network a phone is on (a café's, an office's): the router's
 * address in it.
 */
export function freeAddress(d: ServerData): string {
  const rnd = new Uint8Array(2);
  for (let i = 0; i < 200; i++) {
    crypto.getRandomValues(rnd);
    const a = 16 + ((rnd[0] ?? 0) % 230);
    const ip = ((10 * 256 + a) * 256 + (rnd[1] ?? 0)) * 256 + 1;
    if (clashes(ip, PREFIX, d) === undefined) return intToIp(ip);
  }
  return '10.77.0.1';
}

/** The next address for a new device: .2 up, skipping the router's and the others'. */
export function nextPeerIp(f: ServerForm): string | undefined {
  const ip = ipToInt(f.address);
  if (ip === undefined) return undefined;
  const base = networkOf(ip, f.prefix);
  const used = new Set([ip, ...f.peers.map((p) => ipToInt(p.ip) ?? -1)]);
  for (let n = base + 1; n < lastOf(ip, f.prefix); n++) if (!used.has(n)) return intToIp(n);
  return undefined;
}

/** wg_in_device1, wg_in_device2…: a name no section has. */
export function newPeerSection(f: ServerForm, d: ServerData): string {
  const names = new Set([...f.peers.map((p) => p.section), ...d.present.network.map((s) => s['.name'])]);
  for (let n = 1; ; n++) if (!names.has(`${SERVER}_device${String(n)}`)) return `${SERVER}_device${String(n)}`;
}

/** Peers keep their host numbers when the tunnel moves to another /24. */
export function moveTo(f: ServerForm, address: string): ServerForm {
  const from = ipToInt(f.address);
  const to = ipToInt(address);
  if (from === undefined || to === undefined) return { ...f, address };
  const peers = f.peers.map((p) => {
    const ip = ipToInt(p.ip);
    return ip === undefined ? p : { ...p, ip: intToIp(networkOf(to, f.prefix) + (ip - networkOf(ip, f.prefix))) };
  });
  return { ...f, address, peers };
}

export type Reach = 'public' | 'private' | 'shared' | 'none';

/**
 * How the internet reaches this router: its own public address; a private
 * one, behind another router, which needs a port forward there; a
 * provider's shared one (100.64.0.0/10, CGNAT), which nothing outside can
 * start a connection to.
 */
export function reachOf(wan: Wan): Reach {
  const ip = wan.ipv4 === undefined ? undefined : ipToInt(wan.ipv4);
  if (ip === undefined) return 'none';
  if (isPrivate(ip)) return 'private';
  if (Math.floor(ip / 2 ** 22) === (100 * 256 + 64) / 4) return 'shared';
  return 'public';
}

// ---- checks ----

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function isIpv6(v: string): boolean {
  return v.includes(':') && /^[0-9a-f:.]+$/i.test(v);
}

/** Whether fw4's port spec ("51820", "8000-8100", "80 443") covers `port`. */
function covers(spec: string, port: number): boolean {
  return spec.split(/\s+/).some((part) => {
    const [lo = '', hi] = part.split(/[-:]/);
    return hi === undefined ? Number(lo) === port : port >= Number(lo) && port <= Number(hi);
  });
}

/** A device's name, or its address for one set up in LuCI without a name. */
export function peerLabel(p: PeerForm): string {
  const name = p.name.trim();
  return name !== '' ? name : `Device ${p.ip}`;
}

export function validate(f: ServerForm, d: ServerData): Errors {
  const e: Errors = {};
  const port = Number(f.port);
  if (!/^\d+$/.test(f.port) || port < 1 || port > 65535) e['port'] = 'A port from 1 to 65535.';
  else if (d.portsInUse.includes(port)) e['port'] = 'Something on the router already uses this UDP port.';
  else {
    const fwd = d.forwards.find((x) => covers(x.port, port));
    if (fwd !== undefined) e['port'] = `The port forward “${fwd.name}” already sends this port to a device.`;
  }
  const ip = ipToInt(f.address);
  if (ip === undefined) e['address'] = 'An IPv4 address, like 10.42.17.1.';
  else if (!isPrivate(ip)) e['address'] = 'A private address: 10.x.x.x, 172.16–31.x.x or 192.168.x.x.';
  else if (ip === networkOf(ip, f.prefix) || ip === lastOf(ip, f.prefix)) e['address'] = `Not the first or last address of its /${String(f.prefix)}.`;
  else {
    const c = clashes(ip, f.prefix, d);
    if (c !== undefined) e['address'] = `It overlaps ${c === 'your home network' ? c : `the ${c} network`}: pick another.`;
  }
  const endpoint = f.endpoint.trim();
  if (endpoint !== '' && ipToInt(endpoint) === undefined && !isIpv6(endpoint) && !HOSTNAME.test(endpoint)) e['endpoint'] = 'A hostname (home.example.com) or an address.';
  const names = new Set<string>();
  const ips = new Set<number>();
  for (const p of f.peers) {
    const at = `peer-${p.section}`;
    const name = p.name.trim().toLowerCase();
    if (name !== '' && names.has(name)) e[`${at}-name`] = 'Another device has this name.';
    names.add(name);
    const pip = ipToInt(p.ip);
    if (pip === undefined || ip === undefined || networkOf(pip, f.prefix) !== networkOf(ip, f.prefix) || pip === ip || pip === networkOf(ip, f.prefix) || pip === lastOf(ip, f.prefix)) {
      e[`${at}-ip`] = 'An address in the tunnel’s network.';
    }
    else if (ips.has(pip)) e[`${at}-ip`] = 'Another device has this address.';
    if (pip !== undefined) ips.add(pip);
    if (!isKey(p.publicKey)) e[`${at}-key`] = 'Its public key isn’t a WireGuard key.';
  }
  return e;
}

// ---- the sections ----

function owned(d: ServerData): Owned[] {
  return [
    { config: 'network', name: SERVER },
    ...d.present.network.filter((s) => s['.type'] === PEER_TYPE).map((s) => ({ config: 'network', name: s['.name'] })),
    ...SERVER_FIREWALL.map((name) => ({ config: 'firewall', name })),
    { config: 'firewall', name: interceptSection(SERVER) },
    { config: 'milkflint', name: SERVER_META },
  ];
}

/** Every section the settings need, as they need it. */
export function wanted(f: ServerForm, d: ServerData): Wanted[] {
  const on = f.enabled;
  // fw4's default is on: unset rather than '1', as LuCI does
  const enabled = on ? undefined : '0';
  const w: Wanted[] = [
    {
      config: 'network',
      type: 'interface',
      name: SERVER,
      values: { proto: 'wireguard', private_key: f.privateKey, listen_port: f.port, addresses: [`${f.address}/${String(f.prefix)}`, ...f.extraAddresses], disabled: on ? undefined : '1' },
    },
    ...f.peers.map(
      (p): Wanted => ({
        config: 'network',
        type: PEER_TYPE,
        name: p.section,
        values: {
          description: p.name.trim() === '' ? undefined : p.name.trim(),
          public_key: p.publicKey,
          private_key: p.privateKey === '' ? undefined : p.privateKey,
          preshared_key: p.presharedKey === '' ? undefined : p.presharedKey,
          allowed_ips: [`${p.ip}/32`, ...p.otherIps],
          disabled: p.enabled ? undefined : '1',
        },
      }),
    ),
    {
      config: 'firewall',
      type: 'zone',
      name: SERVER,
      values: {
        name: SERVER,
        network: [SERVER],
        input: f.admin ? 'ACCEPT' : 'REJECT',
        output: 'ACCEPT',
        forward: f.between ? 'ACCEPT' : 'REJECT',
        mtu_fix: '1',
        enabled,
      },
    },
    {
      config: 'firewall',
      type: 'rule',
      name: `${SERVER}_port`,
      values: { name: 'Allow-WireGuard-Remote-Access', src: d.wanZone, proto: 'udp', dest_port: f.port, target: 'ACCEPT', enabled },
    },
    {
      config: 'firewall',
      type: 'rule',
      name: `${SERVER}_dns`,
      values: { name: 'Allow-DNS-Remote-Access', src: SERVER, proto: ['tcp', 'udp'], dest_port: '53', target: 'ACCEPT', enabled },
    },
  ];
  if (f.internet) w.push({ config: 'firewall', type: 'forwarding', name: `${SERVER}_wan`, values: { src: SERVER, dest: d.wanZone, enabled } });
  if (f.lan) w.push({ config: 'firewall', type: 'forwarding', name: `${SERVER}_lan`, values: { src: SERVER, dest: d.lanZone, enabled } });
  // the DNS page's: devices that ask another DNS server get the router's answer, as at home
  if (d.dnsIntercept) {
    const add = addIntercept(SERVER);
    if (add.op === 'add') w.push({ config: 'firewall', type: add.type, name: interceptSection(SERVER), values: { ...add.values, enabled } });
  }
  const endpoint = f.endpoint.trim();
  if (endpoint !== '') w.push({ config: 'milkflint', type: 'remote_access', name: SERVER_META, values: { endpoint } });
  return w;
}

export function toChanges(f: ServerForm, d: ServerData): ReturnType<typeof reconcile> {
  return reconcile(wanted(f, d), owned(d), d.present);
}

/** Everything remote access is made of, for Remove. */
export function removal(d: ServerData): ReturnType<typeof reconcile> {
  return reconcile([], owned(d), d.present);
}

/** What saving now would change although the settings didn't: someone edited its sections elsewhere. */
export function drift(d: ServerData): ReturnType<typeof reconcile> {
  return d.exists ? toChanges(d.form, d) : [];
}

// ---- in words ----

export interface Line {
  ok: boolean;
  text: string;
}

/** What the settings set up, one line per part, for "What this sets up". */
export function describe(f: ServerForm, d: ServerData): Line[] {
  if (!f.enabled) return [{ ok: false, text: 'Off: no port is open on the internet side, and no device can connect.' }];
  return [
    {
      ok: true,
      text: `Opens UDP port ${f.port} on the internet side, to the router only. WireGuard answers nothing without a device’s key, so the router still looks closed to scans.`,
    },
    {
      ok: f.internet,
      text: f.internet ? 'Devices that send all their traffic home use the internet through your connection.' : 'Devices can’t use the internet through home.',
    },
    { ok: f.lan, text: f.lan ? 'Devices can reach your home network.' : 'Devices can’t reach your home network.' },
    { ok: f.admin, text: f.admin ? 'Devices can open this router’s settings and SSH.' : 'Devices can’t open this router’s settings or SSH.' },
    { ok: f.between, text: f.between ? 'Devices can reach each other.' : 'Devices can’t reach each other.' },
    {
      ok: true,
      text: d.dnsIntercept
        ? 'Devices ask this router for names (DNS), so the DNS page’s settings cover them, even ones set to use their own DNS.'
        : 'Devices ask this router for names (DNS), so the DNS page’s settings cover them.',
    },
  ];
}

/** What a save did, compared with before, in the past tense. */
export function summary(before: ServerForm | undefined, after: ServerForm): string[] {
  const out: string[] = [];
  if (after.enabled && before?.enabled !== true) out.push(`Opened UDP port ${after.port} on the internet side, to the router only.`);
  if (before?.enabled === true && !after.enabled) out.push(`Closed UDP port ${before.port}: no device can connect until you turn it back on.`);
  if (before?.enabled === true && after.enabled && before.port !== after.port) {
    out.push(`Moved the open port from UDP ${before.port} to ${after.port}: every device needs its config again.`);
  }
  if (before !== undefined && before.address !== after.address && before.peers.length > 0) {
    out.push(`Moved the tunnel to ${subnetOf(after.address, after.prefix)}: every device needs its config again.`);
  }
  const flag = (key: 'internet' | 'lan' | 'admin' | 'between', yes: string, no: string): void => {
    if (before !== undefined && before[key] !== after[key]) out.push(after[key] ? yes : no);
  };
  flag('internet', 'Devices can now use the internet through home.', 'Devices can no longer use the internet through home.');
  flag('lan', 'Devices can now reach your home network.', 'Devices can no longer reach your home network.');
  flag('admin', 'Devices can now open this router’s settings and SSH.', 'Devices can no longer open this router’s settings or SSH.');
  flag('between', 'Devices can now reach each other.', 'Devices can no longer reach each other.');
  for (const p of after.peers) {
    const old = before?.peers.find((x) => x.section === p.section);
    if (old === undefined) out.push(`Added ${peerLabel(p)}: show its QR code to connect it.`);
    else if (old.enabled !== p.enabled) out.push(p.enabled ? `${peerLabel(p)} can connect again.` : `Paused ${peerLabel(p)}: it can’t connect.`);
  }
  for (const p of before?.peers ?? []) if (!after.peers.some((x) => x.section === p.section)) out.push(`Removed ${peerLabel(p)}: its key no longer works.`);
  if (out.length === 0) out.push('Saved.');
  return out;
}

// ---- a device's config ----

/** What devices connect to: the hostname set, or the internet port's address. */
export function endpointHost(f: ServerForm, d: ServerData): string | undefined {
  const set = f.endpoint.trim();
  return set !== '' ? set : d.wan.ipv4;
}

/**
 * The config a device's WireGuard app imports: everything through home, or
 * only the home network (and the tunnel) with the rest going out directly.
 */
export function peerConfig(p: PeerForm, f: ServerForm, d: ServerData, everything: boolean): string | undefined {
  const host = endpointHost(f, d);
  if (p.privateKey === '' || d.publicKey === undefined || host === undefined) return undefined;
  const home = [subnetOf(f.address, f.prefix), ...(d.lan === undefined ? [] : [`${intToIp(d.lan.ip - (d.lan.ip % 2 ** (32 - d.lan.prefix)))}/${String(d.lan.prefix)}`])];
  return formatConf({
    privateKey: p.privateKey,
    address: `${p.ip}/32`,
    dns: [f.address],
    peerPublicKey: d.publicKey,
    presharedKey: p.presharedKey,
    endpoint: joinEndpoint(host, f.port),
    allowedIps: everything ? ['0.0.0.0/0', '::/0'] : home,
    keepalive: KEEPALIVE,
  });
}

/** A file name for the config: its device's name, as the apps show it. */
export function confFileName(p: PeerForm): string {
  const base = peerLabel(p).replace(/[^A-Za-z0-9_=+.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 15);
  return `${base === '' ? 'home' : base}.conf`;
}
