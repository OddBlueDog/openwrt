// What the VPN client page reads: OpenWrt's config for the WireGuard
// interface, its peer, its routing rules, its firewall sections and its
// Smart Queue; the guest networks there are; and the devices the router
// knows, to pick from.
import { getHostHints, getInterfaces, getLeases, ipToInt, type NetworkInterface, prefixLength } from '@/lib/api/network';
import { bool, getConfig, list, type Section, str } from '@/lib/api/uci';
import { getWgStatus } from '@/lib/api/wireguard';
import { lanZone, parseFirewall, wanZone } from '../firewall/model';
import { GUEST_IDS, type GuestId, guestLabels, isGuestShaper } from '../wifi-guest/guest';
import { type AdGuardStatus, getAdGuardStatus } from '../adguardhome/api';
import { blankForm, type ClientData, DEFAULT_KEEPALIVE, DEFAULT_PORT, homeDevices } from './model';

/** Which way the VPN's devices' lookups go with AdGuard Home on (its monitor sends them through the tunnel when the DNS page has servers of its own). */
function aghPath(agh: AdGuardStatus | undefined, milkflint: readonly Section[]): ClientData['adguard'] {
  if (agh?.installed !== true || agh.enabled !== true || agh.mode === 'ap') return undefined;
  const mode = str(
    milkflint.find((s) => s['.name'] === 'dns'),
    'mode',
  );
  return mode === 'static' || mode === 'encrypted' ? 'tunnel' : 'automatic';
}
import {
  CLIENT,
  CLIENT_META,
  CLIENT_PEER,
  CLIENT_PEER_TYPE,
  CLIENT_QUEUE,
  CLIENT_SKIP,
  isVpnShaper,
  markSection,
} from './sections';

export async function loadClient(): Promise<ClientData> {
  const [network, firewall, sqm, milkflint, interfaces, status, leases, hints, agh] = await Promise.all([
    getConfig('network'),
    getConfig('firewall'),
    getConfig('sqm').catch(() => undefined),
    getConfig('milkflint').catch((): Section[] => []),
    getInterfaces().catch((): NetworkInterface[] => []),
    getWgStatus().catch(() => ({ installed: false, now: 0, interfaces: [] })),
    getLeases().catch(() => []),
    getHostHints().catch(() => ({})),
    getAdGuardStatus().catch(() => undefined),
  ]);
  const cfg = parseFirewall(firewall);
  const iface = network.find((s) => s['.type'] === 'interface' && s['.name'] === CLIENT);
  const peer = network.find((s) => s['.type'] === CLIENT_PEER_TYPE);
  const on = iface !== undefined && !bool(iface, 'disabled');
  // while it's on, a part turned off elsewhere counts as not there; while it's off, the page turned them all off
  const hasFw = (name: string): boolean => {
    const s = firewall.find((x) => x['.name'] === name);
    return s !== undefined && (!on || bool(s, 'enabled', true));
  };
  const hasRule = (name: string): boolean => {
    const s = network.find((x) => x['.name'] === name);
    return s !== undefined && (!on || !bool(s, 'disabled'));
  };

  // the internet port's queue, for the tunnel's rates
  const wanQueue = sqm?.find(
    (s) => s['.type'] === 'queue' && !isGuestShaper(str(s, 'interface')) && !isVpnShaper(str(s, 'interface')),
  );
  const mbit = (s: Section | undefined, option: string): number => Number(str(s, option) ?? '0') / 1000;
  const wanRates =
    wanQueue !== undefined && bool(wanQueue, 'enabled') && mbit(wanQueue, 'download') > 0 && mbit(wanQueue, 'upload') > 0
      ? { down: mbit(wanQueue, 'download'), up: mbit(wanQueue, 'upload') }
      : undefined;
  const queue = sqm?.find((s) => s['.type'] === 'queue' && s['.name'] === CLIENT_QUEUE);

  const labels = guestLabels(milkflint);
  const guestZones = GUEST_IDS.filter((id) => cfg.zones.some((z) => z.name === id)).map((id) => ({ id, label: labels[id] }));

  const lanSection = network.find((s) => s['.type'] === 'interface' && s['.name'] === 'lan');
  const [lanIp = '', lanCidr] = (list(lanSection, 'ipaddr')[0] ?? '').split('/');
  const lanInt = ipToInt(lanIp);
  const taken = interfaces.flatMap((i) =>
    i.interface === 'lan' || i.interface === 'loopback' || i.interface === CLIENT
      ? []
      : (i['ipv4-address'] ?? []).flatMap((a) => {
          const ip = ipToInt(a.address);
          return ip === undefined ? [] : [{ ip, prefix: a.mask, name: i.interface }];
        }),
  );

  const lan =
    lanInt === undefined
      ? undefined
      : { ip: lanInt, prefix: lanCidr !== undefined ? Number(lanCidr) : prefixLength(str(lanSection, 'netmask')) };
  // every address the router has, to leave its own bridges and internet port out of the devices
  const own = [
    ...(lanInt === undefined ? [] : [lanInt]),
    ...interfaces.flatMap((i) => (i['ipv4-address'] ?? []).flatMap((a) => ipToInt(a.address) ?? [])),
  ];

  const data: ClientData = {
    installed: status.installed,
    exists: iface !== undefined,
    form: blankForm({ wanRates, sqm: sqm !== undefined }),
    peerSection: peer?.['.name'] ?? CLIENT_PEER,
    present: { network, firewall, sqm, milkflint },
    wanZone: wanZone(cfg)?.name ?? 'wan',
    lanZone: lanZone(cfg)?.name ?? 'lan',
    guestZones,
    devices: homeDevices(leases, hints, lan, own),
    sqm: sqm !== undefined,
    wanRates,
    lan,
    taken,
    adguard: aghPath(agh, milkflint),
  };
  if (iface !== undefined) {
    const markLan = firewall.find((s) => s['.name'] === markSection('lan'));
    const skip = firewall.find((s) => s['.name'] === CLIENT_SKIP);
    const meta = milkflint.find((s) => s['.name'] === CLIENT_META);
    const onlyMacs = list(markLan, 'src_mac').map((m) => m.toLowerCase());
    const who = !hasFw(markSection('lan')) ? 'none' : onlyMacs.length > 0 ? 'only' : hasFw(CLIENT_SKIP) ? 'except' : 'all';
    data.form = {
      ...data.form,
      enabled: on,
      privateKey: str(iface, 'private_key') ?? '',
      addresses: list(iface, 'addresses'),
      mtu: str(iface, 'mtu') ?? '',
      publicKey: str(peer, 'public_key') ?? '',
      presharedKey: str(peer, 'preshared_key') ?? '',
      endpointHost: str(peer, 'endpoint_host') ?? '',
      endpointPort: str(peer, 'endpoint_port') ?? DEFAULT_PORT,
      keepalive: str(peer, 'persistent_keepalive') ?? DEFAULT_KEEPALIVE,
      who,
      macs: who === 'only' ? onlyMacs : who === 'except' ? list(skip, 'src_mac').map((m) => m.toLowerCase()) : [],
      guests: guestZones.map((g) => g.id).filter((id: GuestId) => hasFw(markSection(id))),
      killSwitch: hasRule(`${CLIENT}_kill`),
      // an existing tunnel created before this setting existed has no milkflint.vpn_client yet
      useVpnDns: meta !== undefined && bool(meta, 'use_vpn_dns', true),
      dns: list(meta, 'dns'),
      shaper: queue !== undefined && (!on || bool(queue, 'enabled')),
      downMbit: queue === undefined ? data.form.downMbit : String(mbit(queue, 'download')),
      upMbit: queue === undefined ? data.form.upMbit : String(mbit(queue, 'upload')),
    };
  }
  return data;
}
