// What the Remote access page reads: OpenWrt's config for the WireGuard
// interface, its peers and its firewall sections, MilkFlint's for the
// address devices use, and from the router itself the server's public key,
// the internet port's addresses and the UDP ports in use.
import { getInterfaces, ipToInt, type NetworkInterface, prefixLength } from '@/lib/api/network';
import { bool, getConfig, list, type Section, str } from '@/lib/api/uci';
import { getWgStatus, publicKeyOf, udpPortsInUse, type WgStatus } from '@/lib/api/wireguard';
import { interceptOn } from '../dns/intercept';
import { lanZone, parseFirewall, wanZone } from '../firewall/model';
import { DEFAULT_PORT, freeAddress, type PeerForm, PREFIX, type Range, type ServerData, subnetOf } from './model';
import { PEER_TYPE, SERVER, SERVER_META } from './sections';

function inSubnet(ip: string, subnet: string): boolean {
  const [base = '', bits = '32'] = subnet.split('/');
  const a = ipToInt(ip);
  const b = ipToInt(base);
  if (a === undefined || b === undefined) return false;
  const size = 2 ** (32 - Number(bits));
  return Math.floor(a / size) === Math.floor(b / size);
}

function peerOf(s: Section, subnet: string): PeerForm {
  const ips = list(s, 'allowed_ips');
  // its own address: the first allowed IP in the tunnel's network (a /32)
  const own = ips.find((x) => inSubnet(x.split('/')[0] ?? '', subnet) && (x.split('/')[1] ?? '32') === '32');
  return {
    section: s['.name'],
    name: str(s, 'description') ?? '',
    ip: own?.split('/')[0] ?? '',
    otherIps: ips.filter((x) => x !== own),
    enabled: !bool(s, 'disabled'),
    publicKey: str(s, 'public_key') ?? '',
    privateKey: str(s, 'private_key') ?? '',
    presharedKey: str(s, 'preshared_key') ?? '',
  };
}

export async function loadServer(): Promise<ServerData> {
  const noStatus: WgStatus = { installed: false, now: Date.now() / 1000, interfaces: [] };
  const [network, firewall, milkflint, interfaces, status, ports] = await Promise.all([
    getConfig('network'),
    getConfig('firewall'),
    getConfig('milkflint').catch((): Section[] => []),
    getInterfaces().catch((): NetworkInterface[] => []),
    getWgStatus().catch(() => noStatus),
    udpPortsInUse().catch((): number[] => []),
  ]);
  const cfg = parseFirewall(firewall);
  const iface = network.find((s) => s['.type'] === 'interface' && s['.name'] === SERVER);
  const zone = firewall.find((s) => s['.type'] === 'zone' && s['.name'] === SERVER);
  const meta = milkflint.find((s) => s['.name'] === SERVER_META);
  const on = iface !== undefined && !bool(iface, 'disabled');
  // while it's on, a part turned off elsewhere counts as not there; while it's off, the page turned them all off
  const has = (name: string): boolean => {
    const s = firewall.find((x) => x['.name'] === name);
    return s !== undefined && (!on || bool(s, 'enabled', true));
  };
  const running = status.interfaces.find((i) => i.name === SERVER);

  const lanSection = network.find((s) => s['.type'] === 'interface' && s['.name'] === 'lan');
  const [lanIp = '', lanCidr] = (list(lanSection, 'ipaddr')[0] ?? '').split('/');
  const lanInt = ipToInt(lanIp);
  const lan: Range | undefined = lanInt === undefined ? undefined : { ip: lanInt, prefix: lanCidr !== undefined ? Number(lanCidr) : prefixLength(str(lanSection, 'netmask')) };
  // every other network's live addresses: the internet port's, the guest networks', another VPN's…
  const taken = interfaces.flatMap((i) =>
    i.interface === 'lan' || i.interface === 'loopback' || i.interface === SERVER
      ? []
      : (i['ipv4-address'] ?? []).flatMap((a): (Range & { name: string })[] => {
          const ip = ipToInt(a.address);
          return ip === undefined ? [] : [{ ip, prefix: a.mask, name: i.interface }];
        }),
  );
  const wanIf = interfaces.find((i) => i.interface === 'wan');
  const wan6If = interfaces.find((i) => i.interface === 'wan6');
  const wanName = wanZone(cfg)?.name ?? 'wan';

  const port = str(iface, 'listen_port') ?? DEFAULT_PORT;
  const privateKey = str(iface, 'private_key') ?? '';
  // its IPv4 address; the rest (an IPv6 one, a second) are kept as they are
  const addresses = list(iface, 'addresses');
  const v4 = addresses.find((a) => ipToInt(a.split('/')[0] ?? '') !== undefined);
  const [address = '', bits] = (v4 ?? '').split('/');
  const data: ServerData = {
    installed: status.installed,
    exists: iface !== undefined,
    form: {
      enabled: on,
      address,
      prefix: bits !== undefined && /^\d+$/.test(bits) ? Number(bits) : PREFIX,
      extraAddresses: addresses.filter((a) => a !== v4),
      port,
      endpoint: str(meta, 'endpoint') ?? '',
      // a new server starts with both ways out
      internet: iface === undefined || has(`${SERVER}_wan`),
      lan: iface === undefined || has(`${SERVER}_lan`),
      admin: str(zone, 'input') === 'ACCEPT',
      between: str(zone, 'forward') === 'ACCEPT',
      privateKey,
      peers: [],
    },
    publicKey: running?.public_key ?? (privateKey === '' ? undefined : await publicKeyOf(privateKey).catch(() => undefined)),
    present: { network, firewall, milkflint },
    wanZone: wanName,
    lanZone: lanZone(cfg)?.name ?? 'lan',
    lan,
    taken,
    wan: {
      ipv4: wanIf?.['ipv4-address']?.[0]?.address,
      ipv6: wan6If?.['ipv6-address']?.[0]?.address ?? wanIf?.['ipv6-address']?.[0]?.address,
      gateway: wanIf?.route?.find((r) => r.target === '0.0.0.0' && r.mask === 0)?.nexthop,
    },
    dnsIntercept: interceptOn(firewall),
    // its own socket isn't in the way
    portsInUse: ports.filter((p) => p !== running?.listen_port),
    forwards: firewall
      .filter((s) => s['.type'] === 'redirect' && str(s, 'src') === wanName && bool(s, 'enabled', true) && str(s, 'src_dport') !== undefined)
      .filter((s) => {
        const proto = list(s, 'proto').map((p) => p.toLowerCase());
        return proto.length === 0 || proto.some((p) => p === 'udp' || p === 'all' || p === 'tcpudp');
      })
      .map((s) => ({ name: str(s, 'name') ?? s['.name'], port: str(s, 'src_dport') ?? '' })),
  };
  if (data.form.address === '') data.form.address = freeAddress(data);
  const subnet = subnetOf(data.form.address, data.form.prefix);
  data.form.peers = network.filter((s) => s['.type'] === PEER_TYPE).map((s) => peerOf(s, subnet));
  return data;
}
