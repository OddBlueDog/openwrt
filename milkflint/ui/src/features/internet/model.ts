// The Internet page's settings and the UCI changes that make them: the WAN
// interface, the provider's VLAN as an 802.1q device, wan6 under PPPoE, and
// Smart Queue's queue, which goes where PPPoE's packets can be read.
import { ipToInt } from '@/lib/api/network';
import { type Change, type Section, str } from '@/lib/api/uci';
import { isPppoeDevice, pppoeDevice, queueMove } from '../sqm/model';
import { type ClientIdMode, fromStored, toStored } from './client-id';

export interface InternetForm {
  proto: string;
  username: string;
  password: string;
  ipaddr: string;
  netmask: string;
  gateway: string;
  /** Static IP only: the provider's DNS servers. Everything else: the DNS page. */
  staticDns: string;
  ipv6: boolean;
  wan6Exists: boolean;
  /** wan6's device: '@wan' follows wan's connection (PPPoE's link), anything else is a port. */
  wan6Device: string;
  /** The WAN port, under any VLAN. */
  port: string;
  /** The provider's VLAN ID, '' for none. */
  vlan: string;
  /** The 802.1q device section the VLAN is, when it has one. */
  vlanSection: string | undefined;
  clientIdMode: ClientIdMode;
  clientId: string;
  /** Smart Queue's queue for the internet, as sqm has it (../sqm/model.ts); undefined: none, or no sqm */
  sqmQueue: Section | undefined;
}

/**
 * wan's device as a port and a VLAN ID: an 802.1q device section by that
 * name (LuCI's way, and this page's), or a name like eth1.911, which netifd
 * makes into a VLAN device by itself.
 */
export function wanPort(sections: Section[], device: string): Pick<InternetForm, 'port' | 'vlan' | 'vlanSection'> {
  const vlanDev = sections.find((s) => s['.type'] === 'device' && str(s, 'type') === '8021q' && str(s, 'name') === device);
  if (vlanDev !== undefined) return { port: str(vlanDev, 'ifname') ?? device, vlan: str(vlanDev, 'vid') ?? '', vlanSection: vlanDev['.name'] };
  const m = /^(.+)\.(\d+)$/.exec(device);
  return m?.[1] !== undefined && m[2] !== undefined ? { port: m[1], vlan: m[2], vlanSection: undefined } : { port: device, vlan: '', vlanSection: undefined };
}

export function clientIdForm(raw: string): Pick<InternetForm, 'clientIdMode' | 'clientId'> {
  const { mode, value } = fromStored(raw);
  return { clientIdMode: mode, clientId: value };
}

const isIp = (v: string): boolean => ipToInt(v) !== undefined;

export function validate(f: InternetForm): Partial<Record<keyof InternetForm, string>> {
  const e: Partial<Record<keyof InternetForm, string>> = {};
  if (f.proto === 'pppoe' && f.username === '') e.username = 'Your provider gives you this.';
  if (f.proto === 'static') {
    if (!isIp(f.ipaddr)) e.ipaddr = 'Enter an IPv4 address, e.g. 203.0.113.10.';
    if (!isIp(f.netmask)) e.netmask = 'Enter a netmask, e.g. 255.255.255.0.';
    if (!isIp(f.gateway)) e.gateway = 'Enter the gateway your provider gave you.';
  }
  if (f.proto === 'static') {
    const servers = f.staticDns.split(/[\s,]+/).filter((s) => s !== '');
    if (servers.length === 0 || !servers.every(isIp)) e.staticDns = 'Enter one or more IPv4 addresses, separated by commas.';
  }
  if (f.vlan !== '' && !(/^\d{1,4}$/.test(f.vlan) && Number(f.vlan) >= 1 && Number(f.vlan) <= 4094)) {
    e.vlan = 'A number from 1 to 4094.';
  }
  if (f.proto === 'dhcp' && toStored(f.clientIdMode, f.clientId) === undefined) {
    e.clientId = f.clientIdMode === 'hex' ? 'Pairs of hex digits, e.g. 61:62:63 or 616263.' : 'Too long: 255 bytes at most.';
  }
  return e;
}

export function toChanges(f: InternetForm, before: InternetForm): Change[] {
  const values: Record<string, string | string[]> = { proto: f.proto };
  const unset: string[] = [];
  if (f.proto === 'pppoe') {
    values['username'] = f.username;
    values['password'] = f.password;
  } else unset.push('username', 'password');
  if (f.proto === 'static') {
    values['ipaddr'] = f.ipaddr;
    values['netmask'] = f.netmask;
    values['gateway'] = f.gateway;
  } else unset.push('ipaddr', 'netmask', 'gateway');

  // with DHCP or PPPoE the provider's DNS servers are used, unless the DNS page chooses others
  if (f.proto === 'static') {
    values['dns'] = f.staticDns.split(/[\s,]+/).filter((s) => s !== '');
    values['peerdns'] = '0';
  } else unset.push('dns', 'peerdns');

  // only when it was edited: a value OpenWrt can't use stays as it was until then
  if (f.clientId !== before.clientId || f.clientIdMode !== before.clientIdMode) {
    const clientid = toStored(f.clientIdMode, f.clientId);
    if (clientid === '') unset.push('clientid');
    else if (clientid !== undefined) {
      values['clientid'] = clientid;
      // 25.12's sendclientid can swap it for a generated ID; unset means "auto", which sends this one
      unset.push('sendclientid');
    }
  }

  const changes: Change[] = [];
  // The provider's VLAN: an 802.1q device on the WAN port, which wan (and a
  // wan6 on the port) then uses; none puts them back on the port itself.
  const device = f.vlan === '' ? f.port : `${f.port}.${f.vlan}`;
  if (f.vlan !== before.vlan) {
    if (f.vlan !== '') {
      const vlanDev = { type: '8021q', ifname: f.port, vid: f.vlan, name: device };
      changes.push(
        before.vlanSection !== undefined
          ? { op: 'set', config: 'network', section: before.vlanSection, values: vlanDev }
          : { op: 'add', config: 'network', type: 'device', name: 'wan_vlan', values: vlanDev },
      );
    } else if (before.vlanSection !== undefined) {
      changes.push({ op: 'delete', config: 'network', section: before.vlanSection });
    }
    values['device'] = device;
  }

  // PPPoE's IPv6 as OpenWrt sets it up: the link asks for IPv6 (ipv6 1, not
  // auto, which would add an interface of its own), and wan6 runs DHCPv6 on
  // it (@wan), so the IPv6 switch, the IPv6 page and every status read wan6.
  // Leaving PPPoE puts wan6 back on the port, as OpenWrt has it for DHCP.
  let wan6Device = f.wan6Device;
  if (f.proto === 'pppoe') {
    values['ipv6'] = f.ipv6 ? '1' : '0';
    wan6Device = '@wan';
  } else {
    unset.push('ipv6');
    if (before.proto === 'pppoe' || wan6Device !== '@wan') wan6Device = device;
  }

  changes.push(
    { op: 'set', config: 'network', section: 'wan', values },
    { op: 'unset', config: 'network', section: 'wan', options: unset },
  );
  if (f.wan6Exists) {
    const wan6: Record<string, string> = {};
    if (wan6Device !== before.wan6Device) wan6['device'] = wan6Device;
    if (f.ipv6 !== before.ipv6) wan6['disabled'] = f.ipv6 ? '0' : '1';
    if (Object.keys(wan6).length > 0) changes.push({ op: 'set', config: 'network', section: 'wan6', values: wan6 });
  } else if (f.ipv6) {
    changes.push({ op: 'add', config: 'network', type: 'interface', name: 'wan6', values: { device: '@wan', proto: 'dhcpv6' } });
  }

  const queue = before.sqmQueue;
  const to = sqmQueueTo(f, before);
  if (queue !== undefined && to !== undefined) changes.push({ op: 'set', config: 'sqm', section: queue['.name'], values: queueMove(queue, to) });
  return changes;
}

/**
 * Where Smart Queue's queue goes with these changes; undefined: it stays.
 * It goes with PPPoE: onto the session's own device, where CAKE reads the
 * packets inside it (on the port it sees only PPPoE frames), and back onto
 * the port without it. A queue on any other device stays.
 */
export function sqmQueueTo(f: InternetForm, before: InternetForm): string | undefined {
  if (before.sqmQueue === undefined || (f.proto === 'pppoe') === (before.proto === 'pppoe')) return undefined;
  const on = str(before.sqmQueue, 'interface');
  if (f.proto !== 'pppoe') return isPppoeDevice(on) ? f.port : undefined;
  const wasDevice = before.vlan === '' ? before.port : `${before.port}.${before.vlan}`;
  return on === before.port || on === wasDevice ? pppoeDevice('wan') : undefined;
}
