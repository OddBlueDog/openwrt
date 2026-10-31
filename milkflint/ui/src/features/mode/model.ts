// The Operating Mode page's access point settings: the address MilkFlint
// takes on the main router's network (from its DHCP server, or fixed), what
// the router checks before it switches, and the request it gets. Plain
// functions without the app's imports, so ui/tests can run them.

export interface ApForm {
  proto: 'dhcp' | 'static';
  ipaddr: string;
  /** prefix length, as text: what the network size list holds */
  prefix: string;
  gateway: string;
  /** up to three, space or comma separated; empty: the gateway */
  dns: string;
  bridgeOffload: boolean;
}

/** What the router side (milkflint.mode switch) takes for access point mode. */
export interface ApRequest {
  mode: 'ap';
  proto: 'dhcp' | 'static';
  ipaddr?: string;
  netmask?: string;
  gateway?: string;
  dns?: string[];
  bridge_offload: boolean;
}

/** The main router's network as router mode's WAN port has it, if it has an address. */
export interface Uplink {
  ipaddr?: string | null | undefined;
  prefix?: number | null | undefined;
  gateway?: string | null | undefined;
}

export const prefixes = ['24', '23', '22', '21', '20', '16'] as const;

export function ipToInt(ip: string): number | undefined {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim());
  if (m === null) return undefined;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return undefined;
  return ((parts[0] ?? 0) * 16777216 + (parts[1] ?? 0) * 65536 + (parts[2] ?? 0) * 256 + (parts[3] ?? 0)) >>> 0;
}

export function intToIp(n: number): string {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function netmaskOf(prefix: number): string {
  return intToIp(prefix === 0 ? 0 : (2 ** 32 - 2 ** (32 - prefix)) >>> 0);
}

export function dnsList(text: string): string[] {
  return text.split(/[\s,]+/).filter((s) => s !== '');
}

/** The form to start from: automatic, and a fixed address prefilled from the main router's network. */
export function initialForm(uplink: Uplink | null | undefined, bridgeOffload: boolean): ApForm {
  const prefix = uplink?.prefix;
  return {
    proto: 'dhcp',
    ipaddr: '',
    prefix: prefix !== null && prefix !== undefined && prefix >= 8 && prefix <= 30 ? String(prefix) : '24',
    gateway: uplink?.gateway ?? '',
    dns: '',
    bridgeOffload,
  };
}

/** What's wrong with a fixed address, field by field (the router checks the same). */
export function validate(f: ApForm): Partial<Record<'ipaddr' | 'gateway' | 'dns', string>> {
  const e: Partial<Record<'ipaddr' | 'gateway' | 'dns', string>> = {};
  if (f.proto !== 'static') return e;
  const ip = ipToInt(f.ipaddr);
  const prefix = Number(f.prefix);
  const size = 2 ** (32 - prefix);
  const network = (n: number): number => Math.floor(n / size);
  if (ip === undefined) e.ipaddr = 'Enter an IPv4 address on your main router’s network, e.g. 192.168.0.2.';
  else if (ip % size === 0 || ip % size === size - 1) e.ipaddr = 'That’s the network’s own or broadcast address.';
  const gw = ipToInt(f.gateway);
  if (gw === undefined) e.gateway = 'Enter your main router’s address, e.g. 192.168.0.1.';
  else if (ip !== undefined && network(gw) !== network(ip)) e.gateway = 'Your main router has to be on the same network as this address.';
  else if (gw === ip) e.gateway = 'That’s the address you picked for MilkFlint.';
  const dns = dnsList(f.dns);
  if (dns.length > 3) e.dns = 'Up to three.';
  else if (dns.some((d) => ipToInt(d) === undefined)) e.dns = 'IPv4 addresses, separated by spaces.';
  return e;
}

export function toRequest(f: ApForm): ApRequest {
  if (f.proto === 'dhcp') return { mode: 'ap', proto: 'dhcp', bridge_offload: f.bridgeOffload };
  const dns = dnsList(f.dns);
  return {
    mode: 'ap',
    proto: 'static',
    ipaddr: f.ipaddr.trim(),
    netmask: netmaskOf(Number(f.prefix)),
    gateway: f.gateway.trim(),
    dns: dns.length > 0 ? dns : [f.gateway.trim()],
    bridge_offload: f.bridgeOffload,
  };
}

/** Where to open MilkFlint once it has switched to access point mode: its fixed address, if it has one. */
export function apAddress(f: ApForm): string | undefined {
  return f.proto === 'static' ? f.ipaddr.trim() : undefined;
}
