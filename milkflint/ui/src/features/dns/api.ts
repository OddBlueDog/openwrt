import { z } from 'zod';
import { prefixLength } from '@/lib/api/network';
import { bool, getConfig, list, type Section, str } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import { type AdGuardStatus, getAdGuardStatus } from '../adguardhome/api';
import { SERVER } from '../remote-access/sections';
import { type GuestId, isGuestNetwork } from '../wifi-guest/guest';
import { homeDhcp, readDeviceDns } from './device-dns';
import { INTERCEPT_SECTIONS, interceptOn } from './intercept';
import { cacheRrTypes, DEFAULT_CACHE_SIZE, type DnsData, isHttpsRr } from './model';
import type { OutsideDns } from './programs';
import { isProviderId } from './providers';
import { keepHoursOf, staleHoursOf, suggestBackup } from './upstreams';

const outsideSchema = z.object({
  how: z.enum(['front', 'forward']),
  program: z.string().nullish(),
  addr: z.string(),
  port: z.number(),
  file: z.string().nullish(),
}) satisfies z.ZodType<OutsideDns>;

const statusSchema = z.object({
  installed: z.boolean(),
  running: z.boolean(),
  /** A DNS program set up outside MilkFlint that devices' lookups reach; absent when there's none (and from older routers). */
  outside: outsideSchema.optional(),
});

/** Whether the encrypted-DNS proxy (AdGuard's dnsproxy) is installed and running, and a DNS program from outside MilkFlint. */
export type DnsStatus = z.output<typeof statusSchema>;

export function getDnsStatus(): Promise<DnsStatus> {
  return call('milkflint.dns', 'status', {}, statusSchema);
}

/** AdGuard Home on the router, filtering in front of these settings (a firmware without it: undefined). */
/** AdGuard Home's status; null when it isn't there to ask (a query can't hold undefined). */
export const loadAdGuard = (): Promise<AdGuardStatus | null> => getAdGuardStatus().catch(() => null);

/** The DNS settings as saved, with what the page needs beside them. */
export async function loadDns(): Promise<DnsData> {
  const [dhcp, milkflint, firewall, proxy, network] = await Promise.all([
    getConfig('dhcp'),
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('firewall'),
    getConfig('dnsproxy').catch((): Section[] => []),
    getConfig('network'),
  ]);
  const lanDhcp = homeDhcp(dhcp);
  const lan = network.find((s) => s['.name'] === 'lan');
  const ipaddr = str(lan, 'ipaddr');
  const dnsmasq = dhcp.find((s) => s['.type'] === 'dnsmasq');
  const rf = milkflint.find((s) => s['.name'] === 'dns');
  const mode = str(rf, 'mode');
  const stored = str(rf, 'provider') ?? 'cloudflare';
  const provider = stored === 'custom' || isProviderId(stored) ? stored : 'cloudflare';
  const proto = str(rf, 'proto');
  const backup = str(rf, 'backup');
  const hasBackup = backup === 'custom' || (backup !== undefined && isProviderId(backup));
  // with one server, the second slot starts on a good partner for the first
  const suggestion = suggestBackup({ provider, server: str(rf, 'server') ?? '', custom: '' });
  const cache = proxy.find((s) => s['.name'] === 'cache');
  const cacheRr = cacheRrTypes(list(dnsmasq, 'cache_rr'));
  const stale = str(dnsmasq, 'use_stale_cache');
  return {
    form: {
      mode: mode === 'static' || mode === 'encrypted' ? mode : 'auto',
      provider,
      server: str(rf, 'server') ?? '',
      proto: proto === 'dot' || proto === 'doq' ? proto : 'doh',
      custom: str(rf, 'custom') ?? '',
      pair: hasBackup ? (str(rf, 'backup_use') === 'fallback' ? 'fallback' : 'parallel') : 'one',
      backup: hasBackup ? backup : suggestion.provider,
      backupServer: hasBackup ? (str(rf, 'backup_server') ?? '') : suggestion.server,
      backupCustom: str(rf, 'backup_custom') ?? '',
      cacheOn: str(dnsmasq, 'cachesize') !== '0',
      // off is a size of 0: turning it back on starts from the default
      cacheSize:
        (str(dnsmasq, 'cachesize') ?? '0') === '0' ? DEFAULT_CACHE_SIZE : (str(dnsmasq, 'cachesize') ?? DEFAULT_CACHE_SIZE),
      cacheHttps: cacheRr.some(isHttpsRr),
      // dnsproxy reuses expired answers for encrypted DNS, dnsmasq for the others
      quick: mode === 'encrypted' ? bool(cache, 'enabled') && bool(cache, 'cache_optimistic') : stale !== undefined,
      keepHours: mode === 'encrypted' ? keepHoursOf(str(cache, 'optimistic_max_age')) : staleHoursOf(stale),
      intercept: interceptOn(firewall),
      rebind: bool(dnsmasq, 'rebind_protection', true),
      domain: str(dnsmasq, 'domain') ?? 'lan',
      records: dhcp
        .filter((s) => s['.type'] === 'domain')
        .map((s) => ({ key: s['.name'], section: s['.name'], name: str(s, 'name') ?? '', ip: str(s, 'ip') ?? '' })),
      devices: readDeviceDns(lanDhcp),
    },
    dnsmasq: dnsmasq?.['.name'],
    servers: list(dnsmasq, 'server'),
    cacheRr,
    managed: list(rf, 'managed'),
    hasMilkflintDns: rf !== undefined,
    hasProxyCache: cache !== undefined,
    hasStaleCache: stale !== undefined,
    intercepts: firewall
      .filter((s) => s['.type'] === 'redirect' && INTERCEPT_SECTIONS.includes(s['.name']))
      .map((s) => ({ section: s['.name'], enabled: bool(s, 'enabled', true) })),
    interceptZones: [
      'lan',
      ...firewall.flatMap((s): GuestId[] => {
        const name = str(s, 'name');
        return s['.type'] === 'zone' && isGuestNetwork(name) ? [name] : [];
      }),
      // Remote access's zone while it's on (off, the page turns its redirect off with the rest)
      ...firewall.flatMap((s): (typeof SERVER)[] =>
        s['.type'] === 'zone' && str(s, 'name') === SERVER && bool(s, 'enabled', true) ? [SERVER] : [],
      ),
    ],
    proxyInstalled: proxy.some((s) => s['.name'] === 'global'),
    proxyEnabled: bool(
      proxy.find((s) => s['.name'] === 'global'),
      'enabled',
    ),
    lanDhcp,
    routerIp: ipaddr?.split('/')[0] ?? '192.168.1.1',
    prefix: ipaddr?.includes('/') === true ? Number(ipaddr.split('/')[1]) : prefixLength(str(lan, 'netmask')),
  };
}
