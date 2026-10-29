// The guest networks' settings as the page edits them, and the UCI changes
// that make them. Each network is its own interface (guest, guest2, guest3)
// with a bridge, a DHCP pool, a firewall zone out to the internet only, an
// optional speed limit (SQM) and an access point per band; a band can share
// the network's name, security and password or have its own. What the page
// calls a network ("Guests", "Smart home") is MilkFlint's own setting
// (milkflint.<id>.label): OpenWrt has nowhere for it.
import { ipToInt } from '@/lib/api/network';
import { bool, type Change, list, type Section, str } from '@/lib/api/uci';
import { addIntercept, interceptSection } from '../dns/intercept';
import { keyError } from '../wifi/security';
import { defaultGuestLabel, type GuestId, guestBridge } from './guest';

/** Where a new guest network's addresses start. */
export const ADDRESSES = ['192.168.9.1', '192.168.10.1', '192.168.20.1', '192.168.99.1', '10.99.0.1', '10.98.0.1'];
export const PREFIX = 24;

/** What a network is for decides what it starts with; after that, it's all settings. */
export type Kind = 'visitors' | 'devices';

export const kinds: Record<Kind, { label: string; suffix: string; encryption: string; isolate: boolean; leasetime: string; only2g: boolean }> = {
  // phones and laptops: WPA3 where they can, kept from each other
  visitors: { label: 'Guests', suffix: 'Guest', encryption: 'sae-mixed', isolate: true, leasetime: '1h', only2g: false },
  // plugs, bulbs, cameras: mostly 2.4 GHz only and WPA2 only (some won't join a WPA2/WPA3 network), and
  // they stay for good; they may talk to each other (a hub and its bulbs, a phone casting to a speaker)
  devices: { label: 'Smart home', suffix: 'IoT', encryption: 'psk2', isolate: false, leasetime: '12h', only2g: true },
};

export interface Radio {
  name: string;
  band: string;
  /** Turned on in Radios & SSIDs: a guest network on it only runs while it is. */
  on: boolean;
}

/** A band's network name, security and password. */
export interface Creds {
  ssid: string;
  /** OpenWrt's `encryption` up to its first '+'. */
  encryption: string;
  /** A cipher set in LuCI (the rest of `encryption`), kept as it is. */
  cipher: string;
  key: string;
}

export interface NetForm {
  id: GuestId;
  /** What the page calls it, e.g. "Smart home". */
  label: string;
  enabled: boolean;
  /** radio -> the network runs on it */
  bands: Record<string, boolean>;
  /** One name, security and password on every band (`shared`), or each band its own (`own`). */
  same: boolean;
  shared: Creds;
  /** radio -> that band's own */
  own: Record<string, Creds>;
  /** Devices on it can't reach each other (ap_isolate, and bridge port isolation between bands). */
  isolate: boolean;
  /** The router's address on it (a /24). */
  ipaddr: string;
  /** The speed limit for all its devices together, Mbit/s; '' is none. */
  downMbit: string;
  upMbit: string;
  /** For a new network's DHCP pool. */
  leasetime: string;
}

export interface Range {
  ip: number;
  prefix: number;
}

/**
 * Who may start connections where, as the firewall has it now: what the
 * page sets up, unless the Firewall page (or LuCI) changed it since.
 */
export interface Access {
  /** a forwarding out to the internet that's on */
  internet: boolean;
  /** the home network: a forwarding there, or the global forward policy */
  lan: boolean;
  /** the router's own services (web pages, SSH): the zone's input policy */
  router: boolean;
  /** the other guest networks it may reach */
  guests: GuestId[];
  /** the home network may start connections to it */
  fromLan: boolean;
}

/** What a network the page sets up may do. */
export const freshAccess: Access = { internet: true, lan: false, router: false, guests: [], fromLan: false };

/** A guest network's parts as they are on the router; all missing for one being added. */
export interface NetData {
  id: GuestId;
  /** radio -> its access point on this network */
  aps: Record<string, Section>;
  iface: Section | undefined;
  device: Section | undefined;
  dhcp: Section | undefined;
  zone: Section | undefined;
  /** The firewall's forwardings, rules and redirects to or from its zone. */
  forwardings: Section[];
  rules: Section[];
  redirects: Section[];
  /** milkflint.<id>: its label */
  meta: Section | undefined;
  /** The interface isn't a plain static /24 (set in LuCI): its address is left as it is. */
  addressFixed: boolean;
  /** SQM is installed: the speed limit is a queue of its own (null until there is one). */
  shaper: Section | null | undefined;
  access: Access;
  form: NetForm;
}

export interface GuestData {
  radios: Radio[];
  /** The networks set up, in GUEST_IDS order. */
  nets: NetData[];
  /** The zone guests go out to the internet through. */
  wanZone: string;
  lan: Range | undefined;
  /** Other networks' addresses (the internet port's, a VPN's…), so a guest network isn't put on one. */
  taken: (Range & { name: string })[];
  /** Copied from the main access points (MilkFlint sets 1). */
  dtim: string | undefined;
  /** SQM is installed. */
  sqm: boolean;
  /** The main network's name, for new networks' names. */
  mainSsid: string | undefined;
  /** The DNS page catches devices that use their own DNS: each guest network gets its redirect too. */
  dnsIntercept: boolean;
}

export function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

/** Easy to read out and type on a phone: three groups of four, no look-alike characters. */
export function generateKey(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  const s = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => chars[b % chars.length] ?? 'a').join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}

/** Whether two networks share addresses. */
export function overlaps(a: number, aPrefix: number, b: number, bPrefix: number): boolean {
  const block = 2 ** (32 - Math.min(aPrefix, bPrefix));
  return Math.floor(a / block) === Math.floor(b / block);
}

export function labelOf(f: NetForm): string {
  return f.label.trim() === '' ? defaultGuestLabel(f.id) : f.label.trim();
}

export function credsOf(s: Section | undefined, fallback: Creds): Creds {
  if (s === undefined) return fallback;
  const [encryption = 'none', ...cipher] = (str(s, 'encryption') ?? 'none').split('+');
  return { ssid: str(s, 'ssid') ?? '', encryption, cipher: cipher.join('+'), key: str(s, 'key') ?? '' };
}

/** What each band that's on broadcasts. */
export function bandCreds(f: NetForm, radios: readonly Radio[]): { radio: Radio; creds: Creds }[] {
  return radios.filter((r) => f.bands[r.name] === true).map((radio) => ({ radio, creds: f.same ? f.shared : (f.own[radio.name] ?? f.shared) }));
}

/** The first of the addresses that's free: not the LAN's, another network's, or a guest network's. */
export function freeAddress(d: GuestData, others: readonly NetForm[]): string {
  const used: Range[] = [
    ...(d.lan === undefined ? [] : [d.lan]),
    ...d.taken,
    ...others.flatMap((f) => {
      const ip = ipToInt(f.ipaddr);
      return ip === undefined ? [] : [{ ip, prefix: PREFIX }];
    }),
  ];
  return ADDRESSES.find((a) => !used.some((u) => overlaps(ipToInt(a) ?? 0, PREFIX, u.ip, u.prefix))) ?? ADDRESSES[0] ?? '192.168.9.1';
}

/** A new network's settings, by what it's for; `others` are the networks it joins. */
export function newForm(id: GuestId, kind: Kind, d: GuestData, others: readonly NetForm[]): NetForm {
  const k = kinds[kind];
  const labels = new Set(others.map(labelOf));
  let label = k.label;
  for (let n = 2; labels.has(label); n++) label = `${k.label} ${String(n)}`;
  const names = new Set(others.flatMap((f) => [f.shared.ssid, ...Object.values(f.own).map((c) => c.ssid)]));
  const base = d.mainSsid === undefined || new TextEncoder().encode(`${d.mainSsid}-${k.suffix}`).length > 30 ? k.suffix : `${d.mainSsid}-${k.suffix}`;
  let ssid = base;
  for (let n = 2; names.has(ssid); n++) ssid = `${base}${String(n)}`;
  const shared: Creds = { ssid, encryption: k.encryption, cipher: '', key: generateKey() };
  // on every band that's on; devices that need 2.4 GHz only see that one
  const on = d.radios.filter((r) => r.on);
  const twoG = on.filter((r) => r.band === '2g');
  const chosen = k.only2g && twoG.length > 0 ? twoG : on.length > 0 ? on : d.radios;
  return {
    id,
    label,
    enabled: true,
    bands: Object.fromEntries(d.radios.map((r) => [r.name, chosen.includes(r)])),
    same: true,
    shared,
    own: Object.fromEntries(d.radios.map((r) => [r.name, { ...shared }])),
    isolate: k.isolate,
    ipaddr: freeAddress(d, others),
    downMbit: '',
    upMbit: '',
    leasetime: k.leasetime,
  };
}

/** The parts of a network not set up yet. */
export function blankNet(form: NetForm, d: GuestData): NetData {
  return {
    id: form.id,
    aps: {},
    iface: undefined,
    device: undefined,
    dhcp: undefined,
    zone: undefined,
    forwardings: [],
    rules: [],
    redirects: [],
    meta: undefined,
    addressFixed: false,
    shaper: d.sqm ? null : undefined,
    access: freshAccess,
    form,
  };
}

export type Errors = Partial<Record<string, string>>;

/** A speed limit as typed: '' (none) or Mbit/s, to a tenth. */
export function speedOk(v: string): boolean {
  return v === '' || (/^\d+(\.\d)?$/.test(v) && Number(v) >= 0.5 && Number(v) <= 10000);
}

function credsErrors(c: Creds, at: string, e: Errors): void {
  const bytes = new TextEncoder().encode(c.ssid).length;
  if (bytes < 1 || bytes > 32) e[`${at}-ssid`] = 'Use 1 to 32 characters.';
  const keyBad = keyError(c.encryption, c.key);
  if (keyBad !== undefined) e[`${at}-key`] = keyBad;
}

/**
 * What's wrong with a network's settings, by field id (`<id>-ssid`,
 * `<id>-radio0-key`…). `others` are the other networks, as they'll be.
 */
export function validate(f: NetForm, net: NetData, d: GuestData, others: readonly NetForm[]): Errors {
  const e: Errors = {};
  const id = f.id;
  if (new TextEncoder().encode(f.label).length > 32) e[`${id}-label`] = 'Use up to 32 characters.';
  if (f.same) credsErrors(f.shared, id, e);
  else for (const { radio, creds } of bandCreds(f, d.radios)) credsErrors(creds, `${id}-${radio.name}`, e);
  // while it's off, having no band doesn't stop a save
  if (f.enabled && !Object.values(f.bands).some(Boolean)) e[`${id}-bands`] = 'Pick at least one band.';
  if (!net.addressFixed) {
    const ip = ipToInt(f.ipaddr);
    const first = ip === undefined ? 0 : Math.floor(ip / 16777216);
    const second = ip === undefined ? 0 : Math.floor(ip / 65536) % 256;
    const host = ip === undefined ? 0 : ip % 256;
    const clash = ip === undefined ? undefined : d.taken.find((t) => overlaps(ip, PREFIX, t.ip, t.prefix));
    const sibling = ip === undefined ? undefined : others.find((o) => overlaps(ip, PREFIX, ipToInt(o.ipaddr) ?? -1, PREFIX));
    if (ip === undefined) e[`${id}-ip`] = 'Enter an IPv4 address, e.g. 192.168.9.1.';
    else if (!(first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)))
      e[`${id}-ip`] = 'Use a private address (10.x, 172.16–31.x or 192.168.x).';
    else if (host === 0 || host === 255) e[`${id}-ip`] = 'End it in 1 to 254.';
    else if (d.lan !== undefined && overlaps(ip, PREFIX, d.lan.ip, d.lan.prefix)) e[`${id}-ip`] = 'That’s inside your main network (LAN): pick another range.';
    else if (clash !== undefined) e[`${id}-ip`] = `That’s the range of another network on the router (${clash.name}): pick another.`;
    else if (sibling !== undefined) e[`${id}-ip`] = `${labelOf(sibling)} uses that range: pick another.`;
  }
  if (!speedOk(f.downMbit) || !speedOk(f.upMbit)) e[`${id}-speed`] = 'Use 0.5 to 10,000 Mbit/s, or leave it empty for no limit.';
  return e;
}

function encryptionOf(c: Creds): string {
  return c.cipher === '' ? c.encryption : `${c.encryption}+${c.cipher}`;
}

/** Everything a network needs to be what its settings say. */
export function toChanges(f: NetForm, net: NetData, d: GuestData): Change[] {
  const changes: Change[] = [];
  const id = f.id;
  const bridge = guestBridge(id);
  // one added and turned off again before it was ever saved: nothing to make yet
  if (!f.enabled && net.iface === undefined && Object.keys(net.aps).length === 0) return changes;
  // its label, where OpenWrt has none; a network's own default isn't written
  const label = f.label.trim();
  if (label !== (str(net.meta, 'label') ?? '')) {
    if (net.meta === undefined) {
      if (label !== '' && label !== defaultGuestLabel(id)) changes.push({ op: 'add', config: 'milkflint', type: 'guest_network', name: id, values: { label } });
    } else if (label === '') {
      changes.push({ op: 'unset', config: 'milkflint', section: net.meta['.name'], options: ['label'] });
    } else {
      changes.push({ op: 'set', config: 'milkflint', section: net.meta['.name'], values: { label } });
    }
  }

  // off: the access points stop, the rest stays (and stays in LuCI) for next time
  if (!f.enabled) {
    for (const s of Object.values(net.aps)) changes.push({ op: 'set', config: 'wireless', section: s['.name'], values: { disabled: '1' } });
    return changes;
  }

  // a bridge of its own, so the bands' access points share one network; up
  // even while they're down, so the address and DHCP don't come and go
  if (net.device === undefined) {
    changes.push({ op: 'add', config: 'network', type: 'device', name: `${id}_dev`, values: { name: bridge, type: 'bridge', bridge_empty: '1' } });
  }
  const cidr = `${f.ipaddr}/${String(PREFIX)}`;
  if (net.iface === undefined) {
    changes.push({ op: 'add', config: 'network', type: 'interface', name: id, values: { proto: 'static', device: bridge, ipaddr: [cidr] } });
  } else if (!net.addressFixed && f.ipaddr !== net.form.ipaddr) {
    changes.push({ op: 'set', config: 'network', section: net.iface['.name'], values: { ipaddr: [cidr] } });
    changes.push({ op: 'unset', config: 'network', section: net.iface['.name'], options: ['netmask'] });
  }
  if (net.dhcp === undefined) {
    changes.push({ op: 'add', config: 'dhcp', type: 'dhcp', name: id, values: { interface: id, start: '100', limit: '150', leasetime: f.leasetime } });
  }
  // it may only go out to the internet; of the router, it gets DNS and DHCP
  if (net.zone === undefined) {
    changes.push({ op: 'add', config: 'firewall', type: 'zone', name: id, values: { name: id, network: [id], input: 'REJECT', output: 'ACCEPT', forward: 'REJECT' } });
  }
  if (!net.forwardings.some((s) => str(s, 'src') === id && str(s, 'dest') === d.wanZone)) {
    changes.push({ op: 'add', config: 'firewall', type: 'forwarding', name: `${id}_wan`, values: { src: id, dest: d.wanZone } });
  }
  const allows = (port: string): boolean =>
    net.rules.some(
      (s) => str(s, 'src') === id && list(s, 'dest_port').includes(port) && (str(s, 'target') ?? '').toUpperCase() === 'ACCEPT' && bool(s, 'enabled', true),
    );
  // Allow-DNS-Guest, Allow-DNS-Guest2…
  const suffix = `${id.charAt(0).toUpperCase()}${id.slice(1)}`;
  if (!allows('53')) {
    changes.push({
      op: 'add',
      config: 'firewall',
      type: 'rule',
      name: `${id}_dns`,
      values: { name: `Allow-DNS-${suffix}`, src: id, dest_port: '53', proto: ['tcp', 'udp'], target: 'ACCEPT' },
    });
  }
  if (!allows('67')) {
    changes.push({
      op: 'add',
      config: 'firewall',
      type: 'rule',
      name: `${id}_dhcp`,
      values: { name: `Allow-DHCP-${suffix}`, src: id, dest_port: '67', proto: ['udp'], family: 'ipv4', target: 'ACCEPT' },
    });
  }
  // its devices' own DNS servers answered by the router, as on the home network (goes with the zone on Remove)
  if (d.dnsIntercept && !net.redirects.some((s) => s['.name'] === interceptSection(id))) changes.push(addIntercept(id));

  // the speed limit: CAKE on its bridge, shared evenly between its devices
  if (net.shaper !== undefined) {
    const kbit = (v: string): string => (v === '' ? '0' : String(Math.round(Number(v) * 1000)));
    // egress on the bridge is what its devices download, ingress what they upload; 0 leaves that way alone
    const rates = { upload: kbit(f.downMbit), download: kbit(f.upMbit) };
    if (f.downMbit !== '' || f.upMbit !== '') {
      changes.push(
        net.shaper === null
          ? {
              op: 'add',
              config: 'sqm',
              type: 'queue',
              name: id,
              values: {
                enabled: '1',
                interface: bridge,
                ...rates,
                qdisc: 'cake',
                script: 'piece_of_cake.qos',
                linklayer: 'none',
                qdisc_advanced: '1',
                qdisc_really_really_advanced: '1',
                // fair per device: by where it comes from on the way in, where it goes on the way out
                iqdisc_opts: 'dual-srchost',
                eqdisc_opts: 'dual-dsthost',
              },
            }
          : // one set up in LuCI keeps its own settings
            { op: 'set', config: 'sqm', section: net.shaper['.name'], values: { enabled: '1', ...rates } },
      );
    } else if (net.shaper !== null && bool(net.shaper, 'enabled')) {
      changes.push({ op: 'set', config: 'sqm', section: net.shaper['.name'], values: { enabled: '0' } });
    }
  }

  for (const r of d.radios) {
    const on = f.bands[r.name] === true;
    const ap = net.aps[r.name];
    const creds = f.same ? f.shared : (f.own[r.name] ?? f.shared);
    // a band that's off keeps the name and password it had (checked only while it's on)
    if (!on) {
      if (ap !== undefined) changes.push({ op: 'set', config: 'wireless', section: ap['.name'], values: { disabled: '1' } });
      continue;
    }
    const values = {
      ssid: creds.ssid,
      encryption: encryptionOf(creds),
      isolate: f.isolate ? '1' : '0',
      bridge_isolate: f.isolate ? '1' : '0',
      ...(creds.encryption === 'none' ? {} : { key: creds.key }),
    };
    if (ap !== undefined) {
      changes.push({ op: 'set', config: 'wireless', section: ap['.name'], values: { ...values, disabled: '0' } });
      if (creds.encryption === 'none' && str(ap, 'key') !== undefined) changes.push({ op: 'unset', config: 'wireless', section: ap['.name'], options: ['key'] });
    } else {
      changes.push({
        op: 'add',
        config: 'wireless',
        type: 'wifi-iface',
        name: `${id}_${r.name}`,
        values: { device: r.name, mode: 'ap', network: id, ...values, ...(d.dtim === undefined ? {} : { dtim_period: d.dtim }), disabled: '0' },
      });
    }
  }
  return changes;
}

/** Everything a network is made of, for Remove. */
export function removal(net: NetData): Change[] {
  const del = (config: string, s: Section | null | undefined): Change[] => (s === undefined || s === null ? [] : [{ op: 'delete', config, section: s['.name'] }]);
  return [
    ...Object.values(net.aps).flatMap((s) => del('wireless', s)),
    ...del('network', net.iface),
    ...del('network', net.device),
    ...del('dhcp', net.dhcp),
    ...del('firewall', net.zone),
    ...[...net.forwardings, ...net.rules, ...net.redirects].flatMap((s) => del('firewall', s)),
    ...del('sqm', net.shaper),
    ...del('milkflint', net.meta),
  ];
}
