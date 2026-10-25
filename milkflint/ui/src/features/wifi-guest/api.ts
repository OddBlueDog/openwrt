// What the Guest Wi-Fi page reads: OpenWrt's own config (UCI) for each
// guest network's parts, MilkFlint's for their labels, and the access
// points' connected devices.
import { getInterfaces, getLeases, ipToInt, type NetworkInterface, prefixLength } from '@/lib/api/network';
import { bool, getConfig, list, type Section, str } from '@/lib/api/uci';
import { bandOf, getAccessPoints } from '@/lib/api/wireless';
import { interceptOn } from '../dns/intercept';
import { type FirewallConfig, lanZone, parseFirewall, wanZone } from '../firewall/model';
import { defaultGuestLabel, GUEST_IDS, type GuestId, guestBridge, isGuestIface, isGuestNetwork } from './guest';
import { type Access, type Creds, credsOf, freeAddress, generateKey, type GuestData, type NetData, PREFIX, type Radio, type Range } from './model';

function firstAddress(s: Section | undefined): { ip: string; prefix: number } | undefined {
  const raw = list(s, 'ipaddr')[0];
  if (raw === undefined) return undefined;
  const [ip = '', cidr] = raw.split('/');
  return { ip, prefix: cidr !== undefined ? Number(cidr) : prefixLength(str(s, 'netmask')) };
}

/**
 * Where a guest zone's devices may start connections, as fw4 decides it: a
 * zone's forward policy only covers traffic within the zone, so traffic to
 * another zone needs a forwarding or falls to the global forward policy.
 */
function accessOf(id: GuestId, cfg: FirewallConfig): Access {
  const zone = cfg.zones.find((z) => z.name === id && z.enabled);
  const lan = lanZone(cfg)?.name ?? 'lan';
  const wan = wanZone(cfg)?.name ?? 'wan';
  const reaches = (from: string, to: string): boolean => cfg.defaults.forward === 'ACCEPT' || cfg.forwardings.some((f) => f.enabled && f.src === from && f.dest === to);
  return {
    internet: reaches(id, wan),
    lan: reaches(id, lan),
    // with no zone, the global input policy
    router: (zone?.input ?? cfg.defaults.input) === 'ACCEPT',
    guests: GUEST_IDS.filter((other) => other !== id && cfg.zones.some((z) => z.name === other) && reaches(id, other)),
    fromLan: reaches(lan, id),
  };
}

function sameCreds(a: Creds, b: Creds): boolean {
  return a.ssid === b.ssid && a.encryption === b.encryption && a.cipher === b.cipher && (a.encryption === 'none' || a.key === b.key);
}

export async function loadGuest(): Promise<GuestData> {
  const [wireless, network, dhcp, firewall, sqm, milkflint, interfaces] = await Promise.all([
    getConfig('wireless'),
    getConfig('network'),
    getConfig('dhcp'),
    getConfig('firewall'),
    getConfig('sqm').catch(() => undefined),
    getConfig('milkflint').catch((): Section[] => []),
    getInterfaces().catch((): NetworkInterface[] => []),
  ]);
  const isAp = (s: Section): boolean => s['.type'] === 'wifi-iface' && (str(s, 'mode') ?? 'ap') === 'ap';
  // as on Radios & SSIDs: a radio that's off with no access point (unused, or lent to something else) isn't offered
  const radios = wireless
    .filter((s) => s['.type'] === 'wifi-device' && (!bool(s, 'disabled') || wireless.some((i) => isAp(i) && str(i, 'device') === s['.name'])))
    .map((s): Radio => ({ name: s['.name'], band: str(s, 'band') ?? '', on: !bool(s, 'disabled') }))
    .sort((a, b) => ['2g', '5g', '6g'].indexOf(a.band) - ['2g', '5g', '6g'].indexOf(b.band));
  const mainAps = wireless.filter((s) => isAp(s) && !isGuestIface(s));
  const wanZone = firewall.find((s) => s['.type'] === 'zone' && list(s, 'network').includes('wan'));
  const lanAddr = firstAddress(network.find((s) => s['.name'] === 'lan'));
  const lanIp = lanAddr === undefined ? undefined : ipToInt(lanAddr.ip);
  const lan = lanIp === undefined || lanAddr === undefined ? undefined : { ip: lanIp, prefix: lanAddr.prefix };
  // every other network's live addresses: the internet port's, a VPN's…
  const taken = interfaces.flatMap((i) =>
    i.interface === 'lan' || i.interface === 'loopback' || isGuestNetwork(i.interface)
      ? []
      : (i['ipv4-address'] ?? []).flatMap((a): (Range & { name: string })[] => {
          const ip = ipToInt(a.address);
          return ip === undefined ? [] : [{ ip, prefix: a.mask, name: i.interface }];
        }),
  );
  const sqmOn = sqm !== undefined;
  const cfg = parseFirewall(firewall);

  const nets = GUEST_IDS.flatMap((id: GuestId): NetData[] => {
    const bridge = guestBridge(id);
    const guestAps = wireless.filter((s) => isAp(s) && list(s, 'network').includes(id));
    const aps: Record<string, Section> = {};
    for (const s of guestAps) {
      const radio = str(s, 'device');
      if (radio !== undefined && !(radio in aps)) aps[radio] = s;
    }
    const iface = network.find((s) => s['.type'] === 'interface' && s['.name'] === id);
    const device = network.find((s) => s['.type'] === 'device' && str(s, 'name') === bridge);
    const pool = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === id);
    const zone = firewall.find((s) => s['.type'] === 'zone' && str(s, 'name') === id);
    if (guestAps.length === 0 && iface === undefined && device === undefined && pool === undefined && zone === undefined) return [];
    const meta = milkflint.find((s) => s['.type'] === 'guest_network' && s['.name'] === id);
    const addr = firstAddress(iface);
    // on its bridge the egress is what its devices download, the ingress what they upload
    const shaper = sqm === undefined ? undefined : (sqm.find((s) => s['.type'] === 'queue' && str(s, 'interface') === bridge) ?? null);
    const limited = shaper !== undefined && shaper !== null && bool(shaper, 'enabled');
    const mbit = (option: string): string => {
      const kbit = Number(str(shaper ?? undefined, option) ?? '0');
      return limited && kbit > 0 ? String(kbit / 1000) : '';
    };
    const fresh: Creds = { ssid: 'Guest', encryption: 'sae-mixed', cipher: '', key: generateKey() };
    const first = guestAps[0];
    const shared = credsOf(first, fresh);
    // a band with no access point yet starts from the others' settings
    const own = Object.fromEntries(radios.map((r) => [r.name, credsOf(aps[r.name], shared)]));
    const enabled = guestAps.some((s) => !bool(s, 'disabled'));
    const touches = (s: Section): boolean => str(s, 'src') === id || str(s, 'dest') === id;
    return [
      {
        id,
        aps,
        iface,
        device,
        dhcp: pool,
        zone,
        forwardings: firewall.filter((s) => s['.type'] === 'forwarding' && touches(s)),
        rules: firewall.filter((s) => s['.type'] === 'rule' && touches(s)),
        redirects: firewall.filter((s) => s['.type'] === 'redirect' && touches(s)),
        meta,
        addressFixed: iface !== undefined && (str(iface, 'proto') !== 'static' || addr?.prefix !== PREFIX),
        shaper,
        access: accessOf(id, cfg),
        form: {
          id,
          label: str(meta, 'label') ?? defaultGuestLabel(id),
          enabled,
          // while it's off every access point is, so it goes back on the bands it has one on
          bands: Object.fromEntries(radios.map((r) => [r.name, aps[r.name] !== undefined && (!enabled || !bool(aps[r.name], 'disabled'))])),
          same: Object.values(aps).every((s) => sameCreds(credsOf(s, shared), shared)),
          shared,
          own,
          isolate: first === undefined || bool(first, 'isolate'),
          ipaddr: addr?.ip ?? '',
          downMbit: mbit('upload'),
          upMbit: mbit('download'),
          leasetime: str(pool, 'leasetime') ?? '1h',
        },
      },
    ];
  });

  const data: GuestData = {
    radios,
    nets,
    wanZone: str(wanZone, 'name') ?? 'wan',
    lan,
    taken,
    dtim: str(mainAps[0], 'dtim_period'),
    sqm: sqmOn,
    mainSsid: str(mainAps[0], 'ssid'),
    dnsIntercept: interceptOn(firewall),
  };
  // one with no address yet (its interface deleted in LuCI) gets a free range again
  for (const n of nets) {
    if (n.form.ipaddr === '' && !n.addressFixed) n.form.ipaddr = freeAddress(data, nets.filter((o) => o !== n).map((o) => o.form));
  }
  return data;
}

export interface Guest {
  mac: string;
  name: string | undefined;
  ip: string | undefined;
  band: string | undefined;
  signal: number | undefined;
  connected: number | undefined;
}

/** The devices connected to a guest network now, strongest first. */
export async function loadGuests(id: GuestId): Promise<Guest[]> {
  const [aps, leases] = await Promise.all([getAccessPoints(), getLeases().catch(() => [])]);
  const byMac = new Map(leases.map((l) => [l.macaddr.toLowerCase(), l]));
  return aps
    .filter((ap) => ap.networks.includes(id))
    .flatMap((ap) =>
      ap.stations.map((s): Guest => {
        const lease = byMac.get(s.mac.toLowerCase());
        return {
          mac: s.mac.toLowerCase(),
          name: lease?.hostname,
          ip: lease?.ipaddr,
          band: bandOf(ap.info?.frequency),
          signal: s.signal_avg ?? s.signal,
          connected: s.connected_time,
        };
      }),
    )
    .sort((a, b) => (b.signal ?? -200) - (a.signal ?? -200));
}
