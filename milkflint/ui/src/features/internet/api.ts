// The Internet page's settings as saved: wan, wan6, the WAN port's VLAN and
// Smart Queue's queue for the internet.
import { bool, getConfig, list, str } from '@/lib/api/uci';
import { internetQueue } from '../sqm/model';
import { clientIdForm, type InternetForm, wanPort } from './model';

export async function loadInternet(): Promise<InternetForm> {
  const [sections, sqm] = await Promise.all([getConfig('network'), getConfig('sqm').catch(() => undefined)]);
  const wan = sections.find((s) => s['.name'] === 'wan');
  const wan6 = sections.find((s) => s['.name'] === 'wan6');
  const dns = list(wan, 'dns');
  const device = str(wan, 'device') ?? 'wan';
  return {
    proto: str(wan, 'proto') ?? 'dhcp',
    username: str(wan, 'username') ?? '',
    password: str(wan, 'password') ?? '',
    ipaddr: str(wan, 'ipaddr') ?? '',
    netmask: str(wan, 'netmask') ?? '255.255.255.0',
    gateway: str(wan, 'gateway') ?? '',
    staticDns: dns.join(', '),
    ipv6: wan6 !== undefined && !bool(wan6, 'disabled'),
    wan6Exists: wan6 !== undefined,
    wan6Device: str(wan6, 'device') ?? device,
    ...wanPort(sections, device),
    ...clientIdForm(str(wan, 'clientid') ?? ''),
    sqmQueue: internetQueue(sqm),
  };
}
