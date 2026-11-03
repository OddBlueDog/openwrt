// The DNS server the home network's devices are told to use: the router, or
// another server on the network (a Pi-hole, AdGuard Home). Kept in OpenWrt's
// own options on the home network's DHCP section, the ones LuCI's DHCP
// server tabs edit, so either side reads what the other wrote:
// - dhcp_option '6,<addresses>' (LuCI: DHCP-Options) for IPv4 devices, from
//   dnsmasq;
// - dns (LuCI: Announced IPv6 DNS servers) for IPv6 devices, from odhcpd. Or,
//   when the server has no IPv6 address, dns_service '0' (LuCI: Local IPv6 DNS
//   server off): otherwise odhcpd announces the router, and devices that
//   prefer IPv6 skip the other server.
// Other DHCP options, and DNS options with a tag (tag:guest,6,…), stay.
import { inSubnet, ipToInt } from '@/lib/api/network';
import { type Change, list, type Section, str } from '@/lib/api/uci';

export interface DeviceDns {
  /** Devices are told to use another server, not the router. */
  own: boolean;
  /** Its IPv4 addresses, as typed: separated by commas or spaces. */
  ipv4: string;
  /** Its IPv6 addresses, as typed: optional. */
  ipv6: string;
}

/** An untagged DNS server option, as dnsmasq takes it: 6,a,b or option:dns-server,a,b. */
const DNS_OPTION = /^\s*(?:6|option:dns-server)\s*,(.*)$/i;

export const splitAddresses = (v: string): string[] => v.split(/[\s,]+/).filter((s) => s !== '');

const isIpv6 = (v: string): boolean => /^[0-9a-f:.]+$/i.test(v) && v.includes(':');

/** The DHCP section that serves the home network (interface lan). */
export function homeDhcp(dhcp: readonly Section[]): Section | undefined {
  return dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan') ?? dhcp.find((s) => s['.name'] === 'lan' && s['.type'] === 'dhcp');
}

export function readDeviceDns(lan: Section | undefined): DeviceDns {
  const ipv4 = list(lan, 'dhcp_option').flatMap((o) => {
    const m = DNS_OPTION.exec(o);
    return m === null ? [] : splitAddresses(m[1] ?? '');
  });
  const ipv6 = list(lan, 'dns');
  return { own: ipv4.length > 0 || ipv6.length > 0, ipv4: [...new Set(ipv4)].join(', '), ipv6: ipv6.join(', ') };
}

export function validateDeviceDns(d: DeviceDns, routerIp: string, prefix: number): Partial<Record<'ipv4' | 'ipv6', string>> {
  if (!d.own) return {};
  const e: Partial<Record<'ipv4' | 'ipv6', string>> = {};
  const v4 = splitAddresses(d.ipv4);
  const v6 = splitAddresses(d.ipv6);
  if (v4.length === 0 && v6.length === 0) e.ipv4 = 'Enter your DNS server’s address.';
  else if (v4.some((ip) => ipToInt(ip) === undefined)) e.ipv4 = 'IPv4 addresses, separated by commas.';
  else if (v4.includes(routerIp)) e.ipv4 = 'That’s the router: choose This router above instead.';
  else if (!v4.every((ip) => inSubnet(ip, routerIp, prefix))) {
    e.ipv4 = `An address on your home network (the router is ${routerIp}). For a DNS service on the internet, use DNS servers above.`;
  }
  if (v6.some((ip) => !isIpv6(ip))) e.ipv6 = 'IPv6 addresses, separated by commas.';
  return e;
}

/** What to change in the home network's DHCP section (`name`) to go from `lan` to `d`. */
export function deviceDnsChanges(name: string, lan: Section | undefined, d: DeviceDns): Change[] {
  // left on the router: nothing to write, whatever LuCI set
  if (!d.own && !readDeviceDns(lan).own) return [];
  const v4 = d.own ? [...new Set(splitAddresses(d.ipv4))] : [];
  const v6 = d.own ? [...new Set(splitAddresses(d.ipv6))] : [];
  const changes: Change[] = [];
  const set: { dhcp_option?: string[]; dns?: string[]; dns_service?: string } = {};
  const unset: string[] = [];

  const before = list(lan, 'dhcp_option');
  const options = [...before.filter((o) => !DNS_OPTION.test(o)), ...(v4.length > 0 ? [`6,${v4.join(',')}`] : [])];
  if (JSON.stringify(options) !== JSON.stringify(before)) {
    // an empty list can't be set: rpcd rejects it
    if (options.length > 0) set.dhcp_option = options;
    else unset.push('dhcp_option');
  }

  if (JSON.stringify(v6) !== JSON.stringify(list(lan, 'dns'))) {
    if (v6.length > 0) set.dns = v6;
    else unset.push('dns');
  }

  // announced over IPv6: the server's own IPv6 addresses (dns_service then
  // doesn't matter), else nothing; back on the router, the router again
  const service = d.own && v6.length === 0 ? '0' : undefined;
  if (str(lan, 'dns_service') !== service) {
    if (service !== undefined) set.dns_service = service;
    else unset.push('dns_service');
  }

  if (Object.keys(set).length > 0) changes.push({ op: 'set', config: 'dhcp', section: name, values: set });
  if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section: name, options: unset });
  return changes;
}

/** The router's plain DNS servers include the other server: with that server asking the router, lookups would go round in circles. */
export function loops(d: DeviceDns, routerServers: readonly string[]): boolean {
  if (!d.own) return false;
  const own = new Set([...splitAddresses(d.ipv4), ...splitAddresses(d.ipv6)]);
  return routerServers.some((s) => own.has(s.split('#')[0] ?? ''));
}
