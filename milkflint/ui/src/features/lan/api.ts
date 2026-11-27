// LAN & DHCP's settings as saved: the router's address and network size
// (network.lan) and the DHCP pool on the LAN (dhcp).
import { prefixLength } from '@/lib/api/network';
import { bool, getConfig, str } from '@/lib/api/uci';
import type { LanForm } from './model';

export async function loadLan(): Promise<LanForm> {
  const [network, dhcp] = await Promise.all([getConfig('network'), getConfig('dhcp')]);
  const lan = network.find((s) => s['.name'] === 'lan');
  const pool = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan');
  const raw = str(lan, 'ipaddr') ?? '192.168.1.1';
  const [ip, cidr] = raw.split('/');
  return {
    ipaddr: ip ?? '192.168.1.1',
    prefix: String(cidr !== undefined ? Number(cidr) : prefixLength(str(lan, 'netmask'))),
    dhcp: pool !== undefined && !bool(pool, 'ignore'),
    start: str(pool, 'start') ?? '100',
    limit: str(pool, 'limit') ?? '150',
    leasetime: str(pool, 'leasetime') ?? '12h',
    cidrStyle: cidr !== undefined,
  };
}
