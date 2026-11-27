// The IPv6 page's settings as saved: wan6, the LAN's DHCP server and the
// ULA prefix.
import { bool, getConfig, str } from '@/lib/api/uci';
import { dhcpv6Mode } from '@/lib/dhcpv6';
import type { Ipv6Data, Mode } from './model';

export async function loadIpv6(): Promise<Ipv6Data> {
  const [network, dhcp] = await Promise.all([getConfig('network'), getConfig('dhcp')]);
  const wan6 = network.find((s) => s['.name'] === 'wan6');
  const globals = network.find((s) => s['.type'] === 'globals');
  const lan = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan');
  const mode: Mode = wan6 === undefined || bool(wan6, 'disabled') ? 'off' : str(lan, 'ra') === 'relay' ? 'relay' : 'native';
  const slaac = bool(lan, 'ra_slaac', true);
  const dhcpv6 = dhcpv6Mode(str(lan, 'dhcpv6')) === 'server';
  return {
    form: {
      mode,
      addressing: slaac && dhcpv6 ? 'both' : slaac ? 'slaac' : 'dhcpv6',
      ula: str(globals, 'ula_prefix') ?? '',
    },
    wan6Exists: wan6 !== undefined,
    dhcpWan6Exists: dhcp.some((s) => s['.name'] === 'wan6'),
  };
}
