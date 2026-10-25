// WireGuard for the VPN pages: keys and live state from the router
// (milkflint.vpn, source/feed/milkflint-ui/files/features/vpn/), and the
// .conf format (wg-quick's) that the phone apps and VPN providers use.
import { z } from 'zod';
import { call, exec, UbusError, UbusStatus } from '@/lib/ubus';

const peerSchema = z.object({
  public_key: z.string(),
  endpoint: z.string().nullable(),
  allowed_ips: z.array(z.string()),
  /** epoch seconds; 0: never */
  latest_handshake: z.number(),
  rx_bytes: z.number(),
  tx_bytes: z.number(),
  keepalive: z.number().nullable(),
});
export type WgPeer = z.output<typeof peerSchema>;

const ifaceSchema = z.object({
  name: z.string(),
  public_key: z.string(),
  listen_port: z.number().nullable(),
  fwmark: z.string().nullable(),
  peers: z.array(peerSchema),
});
export type WgInterface = z.output<typeof ifaceSchema>;

const statusSchema = z.object({ installed: z.boolean(), now: z.number(), interfaces: z.array(ifaceSchema) });
export type WgStatus = z.output<typeof statusSchema>;

/** Every WireGuard interface that's up and its peers; installed is false without WireGuard (or the plugin). */
export async function getWgStatus(): Promise<WgStatus> {
  try {
    return await call('milkflint.vpn', 'status', {}, statusSchema);
  } catch (err) {
    // an image without the VPN pages' plugin
    if (err instanceof UbusError && err.code === UbusStatus.notFound) return { installed: false, now: Date.now() / 1000, interfaces: [] };
    throw err;
  }
}

export interface Keys {
  privateKey: string;
  publicKey: string;
  presharedKey: string;
}

/** A new key pair and a preshared key, made on the router. */
export async function newKeys(): Promise<Keys> {
  const res = await call(
    'milkflint.vpn',
    'keys',
    {},
    z.object({ private_key: z.string().optional(), public_key: z.string().optional(), preshared_key: z.string().optional(), error: z.string().optional() }),
  );
  if (res.private_key === undefined || res.public_key === undefined || res.preshared_key === undefined) {
    throw new Error(`The router couldn’t make WireGuard keys (${res.error ?? 'no answer'}).`);
  }
  return { privateKey: res.private_key, publicKey: res.public_key, presharedKey: res.preshared_key };
}

/** The public key that goes with a private one; undefined for one that isn't a key. */
export async function publicKeyOf(privateKey: string): Promise<string | undefined> {
  if (!isKey(privateKey)) return undefined;
  const res = await call('milkflint.vpn', 'pubkey', { private_key: privateKey }, z.object({ public_key: z.string().nullable() }));
  return res.public_key ?? undefined;
}

/** The UDP ports something on the router listens on (WireGuard's own included). */
export async function udpPortsInUse(): Promise<number[]> {
  return (await call('milkflint.vpn', 'udp_ports', {}, z.object({ ports: z.array(z.number()) }))).ports;
}

/**
 * netifd's reload doesn't see changes made only to an interface's peers
 * (its wireguard_<name> sections, as LuCI also finds): renewing the
 * interface applies them (wg syncconf), and connected peers stay connected.
 */
export async function renewInterface(name: string): Promise<void> {
  await exec(`network.interface.${name}`, 'renew');
}

/** A WireGuard key: 32 bytes in base64. */
export function isKey(s: string): boolean {
  return /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/.test(s.trim());
}

/**
 * Connected: a handshake in the last 3 minutes. WireGuard renews it every
 * 2 minutes while there's traffic, so an older one means the device went
 * quiet or away.
 */
export function isConnected(peer: WgPeer | undefined, now: number): boolean {
  return peer !== undefined && peer.latest_handshake > 0 && now - peer.latest_handshake < 180;
}

// ---- wg-quick's .conf ----

export interface WgConf {
  privateKey: string;
  addresses: string[];
  dns: string[];
  mtu: string;
  peer: {
    publicKey: string;
    presharedKey: string;
    endpointHost: string;
    endpointPort: string;
    allowedIps: string[];
    keepalive: string;
  };
}

const splitList = (v: string): string[] =>
  v
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');

/** "host:port", "[v6]:port" or "v6" alone -> host and port. */
export function splitEndpoint(endpoint: string): { host: string; port: string } {
  const e = endpoint.trim();
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(e);
  if (v6 !== null) return { host: v6[1] ?? '', port: v6[2] ?? '' };
  const colons = e.split(':').length - 1;
  if (colons === 1) {
    const [host = '', port = ''] = e.split(':');
    return { host, port };
  }
  return { host: e, port: '' };
}

/** "host:port", with an IPv6 address in brackets. */
export function joinEndpoint(host: string, port: string): string {
  return `${host.includes(':') ? `[${host}]` : host}:${port}`;
}

/**
 * A .conf as VPN providers hand them out: one [Interface] and its first
 * [Peer]. Keys are checked; a reason in plain words when it isn't usable.
 */
export function parseConf(text: string): WgConf | { error: string } {
  const conf: WgConf = {
    privateKey: '',
    addresses: [],
    dns: [],
    mtu: '',
    peer: { publicKey: '', presharedKey: '', endpointHost: '', endpointPort: '', allowedIps: [], keepalive: '' },
  };
  let section: 'interface' | 'peer' | 'other' | undefined;
  let peers = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/[#;].*$/, '').trim();
    if (line === '') continue;
    const head = /^\[(\w+)\]$/.exec(line);
    if (head !== null) {
      const name = (head[1] ?? '').toLowerCase();
      if (name === 'peer') peers++;
      section = name === 'interface' ? 'interface' : name === 'peer' && peers === 1 ? 'peer' : 'other';
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (section === 'interface') {
      if (key === 'privatekey') conf.privateKey = value;
      else if (key === 'address') conf.addresses.push(...splitList(value));
      else if (key === 'dns') conf.dns.push(...splitList(value));
      else if (key === 'mtu') conf.mtu = value;
    } else if (section === 'peer') {
      if (key === 'publickey') conf.peer.publicKey = value;
      else if (key === 'presharedkey') conf.peer.presharedKey = value;
      else if (key === 'endpoint') {
        const { host, port } = splitEndpoint(value);
        conf.peer.endpointHost = host;
        conf.peer.endpointPort = port;
      } else if (key === 'allowedips') conf.peer.allowedIps.push(...splitList(value));
      else if (key === 'persistentkeepalive') conf.peer.keepalive = value;
    }
  }
  if (!isKey(conf.privateKey)) return { error: 'It has no [Interface] with a PrivateKey.' };
  if (peers === 0 || !isKey(conf.peer.publicKey)) return { error: 'It has no [Peer] with a PublicKey.' };
  if (conf.peer.endpointHost === '') return { error: 'Its [Peer] has no Endpoint: the server this router connects to.' };
  if (conf.addresses.length === 0) return { error: 'Its [Interface] has no Address.' };
  if (conf.peer.presharedKey !== '' && !isKey(conf.peer.presharedKey)) return { error: 'Its PresharedKey isn’t a WireGuard key.' };
  return conf;
}

/** A config for a phone or laptop's WireGuard app. */
export function formatConf(c: {
  privateKey: string;
  address: string;
  dns: string[];
  peerPublicKey: string;
  presharedKey: string;
  endpoint: string;
  allowedIps: string[];
  keepalive: number;
}): string {
  return [
    '[Interface]',
    `PrivateKey = ${c.privateKey}`,
    `Address = ${c.address}`,
    ...(c.dns.length > 0 ? [`DNS = ${c.dns.join(', ')}`] : []),
    '',
    '[Peer]',
    `PublicKey = ${c.peerPublicKey}`,
    ...(c.presharedKey !== '' ? [`PresharedKey = ${c.presharedKey}`] : []),
    `AllowedIPs = ${c.allowedIps.join(', ')}`,
    `Endpoint = ${c.endpoint}`,
    `PersistentKeepalive = ${String(c.keepalive)}`,
    '',
  ].join('\n');
}
