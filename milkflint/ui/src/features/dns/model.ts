// The DNS page's settings and the UCI changes that make them: what dnsmasq
// and dnsproxy forward to, the devices' DNS server, and the redirects that
// catch devices with their own DNS.
import { ipToInt } from '@/lib/api/network';
import type { Change, Section } from '@/lib/api/uci';
import { type DeviceDns, deviceDnsChanges, validateDeviceDns } from './device-dns';
import { addIntercept, type InterceptZone, interceptSection } from './intercept';
import { protoOf, type Proto, type ProviderId } from './providers';
import { type BackupUse, type Pair, plainServers, type ProxyServers, proxyServers, type ServerPick, serverOf, TIMEOUT_S } from './upstreams';

/** How lookups are sent: 'static' is plain DNS (the stock firmware's name for it, kept in milkflint.dns.mode). */
export type Mode = 'auto' | 'static' | 'encrypted';

/** Where dnsproxy listens for dnsmasq (the stock firmware's port). */
const PROXY = '127.0.0.1#5453';

/** dnsproxy's cache size when reusing expired answers, in bytes (its default, 64 KB, holds only a few hundred names). */
const CACHE_BYTES = '4194304';

/** How many answers dnsmasq keeps unless told otherwise on this page. */
export const DEFAULT_CACHE_SIZE = '1000';
const MAX_CACHE_SIZE = 100_000;

/** The record types in dnsmasq's cache_rr list, whose entries may be comma lists. */
export const cacheRrTypes = (values: readonly string[]): string[] => values.flatMap((v) => v.split(',')).filter((t) => t !== '');
export const isHttpsRr = (type: string): boolean => type.toLowerCase() === 'https' || type === '65';

export interface DnsRecord {
  key: string;
  section: string | undefined;
  name: string;
  ip: string;
}

export interface DnsForm {
  mode: Mode;
  provider: ProviderId | 'custom';
  server: string;
  proto: Proto;
  custom: string;
  /** One server, or two and how they're used (milkflint.dns.backup 'none', else backup_use). */
  pair: Pair;
  /** The second server: from another provider, or custom; a suggestion while there's one server. */
  backup: ProviderId | 'custom';
  backupServer: string;
  backupCustom: string;
  /** Whether the router caches at all: off is dnsmasq's size 0, and no dnsproxy cache. */
  cacheOn: boolean;
  /** dnsmasq's cache, in answers; empty for the default. */
  cacheSize: string;
  /** Whether dnsmasq keeps HTTPS records too (cache_rr). */
  cacheHttps: boolean;
  /** Expired answers given out at once and refreshed behind: dnsproxy's optimistic cache for encrypted DNS, dnsmasq's use_stale_cache otherwise. */
  quick: boolean;
  /** how long after expiring an answer may still be given out, in hours (optimistic_max_age; use_stale_cache is in seconds) */
  keepHours: string;
  intercept: boolean;
  rebind: boolean;
  domain: string;
  records: DnsRecord[];
  /** The DNS server the home network's devices are told to use. */
  devices: DeviceDns;
}

export interface DnsData {
  form: DnsForm;
  dnsmasq: string | undefined;
  servers: string[];
  /** What dnsmasq's cache_rr holds now: any others, set in LuCI, are kept. */
  cacheRr: string[];
  managed: string[];
  hasMilkflintDns: boolean;
  hasProxyCache: boolean;
  /** Whether dnsmasq has use_stale_cache now, so turning it off knows to take it out. */
  hasStaleCache: boolean;
  /** The intercept redirects there are (any zone's), and whether each is on. */
  intercepts: { section: string; enabled: boolean }[];
  /** Where the switch catches devices: the home network and each guest network's zone. */
  interceptZones: InterceptZone[];
  proxyInstalled: boolean;
  proxyEnabled: boolean;
  /** The home network's DHCP section, where the devices' DNS server is set. */
  lanDhcp: Section | undefined;
  routerIp: string;
  prefix: number;
}

export const mainPick = (f: DnsForm): ServerPick => ({ provider: f.provider, server: f.server, custom: f.custom });

export const backupPick = (f: DnsForm): ServerPick | undefined =>
  f.pair === 'one' ? undefined : { provider: f.backup, server: f.backupServer, custom: f.backupCustom };

export const backupUseOf = (pair: Pair): BackupUse => (pair === 'fallback' ? 'fallback' : 'parallel');

const isIpv6 = (v: string): boolean => /^[0-9a-f:]+$/i.test(v) && v.includes(':');
const splitList = (v: string): string[] => v.split(/[\s,]+/).filter((s) => s !== '');
const isEncryptedUrl = (v: string): boolean => protoOf(v.trim()) !== undefined && !/\s/.test(v.trim());
const isAddressList = (v: string): boolean => {
  const ips = splitList(v);
  return ips.length > 0 && ips.every((ip) => ipToInt(ip) !== undefined || isIpv6(ip));
};

/** What dnsmasq forwards to (plain: the servers; encrypted: dnsproxy), and what dnsproxy uses. */
export function plan(f: DnsForm): { dnsmasq: string[]; proxy: ProxyServers | undefined } {
  if (f.mode === 'static') return { dnsmasq: plainServers(mainPick(f), backupPick(f)), proxy: undefined };
  if (f.mode === 'encrypted') return { dnsmasq: [PROXY], proxy: proxyServers(mainPick(f), f.proto, backupPick(f), backupUseOf(f.pair)) };
  return { dnsmasq: [], proxy: undefined };
}

const NAME = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

type FormErrors = Partial<Record<'custom' | 'backup' | 'backupCustom' | 'domain' | 'cacheSize' | 'ownIpv4' | 'ownIpv6', string>>;

const ADDRESS_LIST = 'One or more IP addresses, separated by commas.';
const ENCRYPTED_URL = 'An address starting https://, tls://, quic:// or sdns://.';

export function validate(f: DnsForm, data: DnsData): { form: FormErrors; records: Record<string, string> } {
  const own = validateDeviceDns(f.devices, data.routerIp, data.prefix);
  const form: FormErrors = { ...(own.ipv4 === undefined ? {} : { ownIpv4: own.ipv4 }), ...(own.ipv6 === undefined ? {} : { ownIpv6: own.ipv6 }) };
  const records: Record<string, string> = {};
  if (f.mode !== 'auto') {
    const ok = f.mode === 'static' ? isAddressList : isEncryptedUrl;
    const message = f.mode === 'static' ? ADDRESS_LIST : ENCRYPTED_URL;
    if (f.provider === 'custom' && !ok(f.custom)) form.custom = message;
    if (f.pair !== 'one') {
      if (f.backup === 'custom' && !ok(f.backupCustom)) form.backupCustom = message;
      if (f.backup !== 'custom' && f.backup === f.provider) {
        form.backup = 'Pick another provider: an outage usually takes all of one provider’s servers down together.';
      }
    }
  }
  if (!/^[A-Za-z0-9-]{1,63}$/.test(f.domain)) form.domain = 'One word: letters, digits and hyphens.';
  if (f.cacheOn && f.cacheSize !== '' && (!/^\d+$/.test(f.cacheSize) || Number(f.cacheSize) < 1 || Number(f.cacheSize) > MAX_CACHE_SIZE)) {
    form.cacheSize = `A whole number from 1 to ${String(MAX_CACHE_SIZE)}, or empty for ${DEFAULT_CACHE_SIZE}.`;
  }
  for (const r of f.records) {
    if (!NAME.test(r.name)) records[r.key] = 'Enter a host name, e.g. nas or printer.home.';
    else if (ipToInt(r.ip) === undefined) records[r.key] = 'Enter an IPv4 address.';
  }
  return { form, records };
}

export function toChanges(f: DnsForm, data: DnsData): Change[] {
  const changes: Change[] = [];
  const p = plan(f);
  const rf = {
    mode: f.mode,
    provider: f.provider,
    server: serverOf(mainPick(f))?.name ?? '',
    proto: f.proto,
    custom: f.custom.trim(),
    backup: f.pair === 'one' ? 'none' : f.backup,
    backup_server: f.backup === 'custom' ? '' : (serverOf({ provider: f.backup, server: f.backupServer, custom: '' })?.name ?? ''),
    backup_custom: f.backupCustom.trim(),
    backup_use: backupUseOf(f.pair),
    // the dnsmasq servers this page added, so it can take them out again
    // (an empty list can't be set: rpcd rejects it, so it's unset below)
    ...(p.dnsmasq.length > 0 ? { managed: p.dnsmasq } : {}),
  };
  changes.push(
    data.hasMilkflintDns
      ? { op: 'set', config: 'milkflint', section: 'dns', values: rf }
      : { op: 'add', config: 'milkflint', type: 'dns', name: 'dns', values: rf },
  );
  if (p.dnsmasq.length === 0) changes.push({ op: 'unset', config: 'milkflint', section: 'dns', options: ['managed'] });

  if (data.dnsmasq !== undefined) {
    const others = data.servers.filter((s) => !data.managed.includes(s));
    const servers = [...others, ...p.dnsmasq];
    // plain DNS with two servers: dnsmasq asks them all at once (allservers)
    // or strictly in order, the backup's last (strictorder)
    const two = f.mode === 'static' && f.pair !== 'one';
    const hadTwo = data.form.mode === 'static' && data.form.pair !== 'one';
    const cacheRr = [...data.cacheRr.filter((t) => !isHttpsRr(t)), ...(f.cacheHttps ? ['HTTPS'] : [])];
    // with encrypted DNS, dnsproxy reuses expired answers (below); dnsmasq doing it too would answer from older ones still
    const stale = f.cacheOn && f.quick && f.mode !== 'encrypted';
    changes.push({
      op: 'set',
      config: 'dhcp',
      section: data.dnsmasq,
      values: {
        rebind_protection: f.rebind ? '1' : '0',
        domain: f.domain,
        local: `/${f.domain}/`,
        cachesize: !f.cacheOn ? '0' : f.cacheSize === '' ? DEFAULT_CACHE_SIZE : String(Number(f.cacheSize)),
        ...(cacheRr.length > 0 ? { cache_rr: cacheRr } : {}),
        ...(stale ? { use_stale_cache: String(Number(f.keepHours) * 3600) } : {}),
        ...(servers.length > 0 ? { server: servers } : {}),
        ...(f.mode === 'auto' ? {} : { noresolv: '1' }),
        ...(two ? (f.pair === 'parallel' ? { allservers: '1' } : { strictorder: '1' }) : {}),
      },
    });
    const unset = [
      ...(servers.length === 0 ? ['server'] : []),
      ...(cacheRr.length === 0 && data.cacheRr.length > 0 ? ['cache_rr'] : []),
      ...(!stale && data.hasStaleCache ? ['use_stale_cache'] : []),
      ...(f.mode === 'auto' && data.form.mode !== 'auto' ? ['noresolv'] : []),
      ...(two ? [f.pair === 'parallel' ? 'strictorder' : 'allservers'] : hadTwo ? ['allservers', 'strictorder'] : []),
    ];
    if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section: data.dnsmasq, options: unset });
  }

  if (data.proxyInstalled) {
    const proxy = p.proxy;
    if (proxy !== undefined && proxy.upstream.length > 0) {
      changes.push({
        op: 'set',
        config: 'dnsproxy',
        section: 'global',
        values: {
          enabled: '1',
          listen_addr: ['127.0.0.1'],
          listen_port: ['5453'],
          // dnsproxy's default is 10 s: a connection the server dropped held lookups that long
          timeout: `${String(TIMEOUT_S)}s`,
          ...(proxy.mode === undefined ? {} : { upstream_mode: proxy.mode }),
        },
      });
      if (proxy.mode === undefined) changes.push({ op: 'unset', config: 'dnsproxy', section: 'global', options: ['upstream_mode'] });
      changes.push({
        op: 'set',
        config: 'dnsproxy',
        section: 'servers',
        values: { upstream: proxy.upstream, bootstrap: proxy.bootstrap, ...(proxy.fallback.length > 0 ? { fallback: proxy.fallback } : {}) },
      });
      // a fallback only when the backup is set to be one (any other, say from LuCI, would send lookups elsewhere)
      if (proxy.fallback.length === 0) changes.push({ op: 'unset', config: 'dnsproxy', section: 'servers', options: ['fallback'] });
      const quick = f.cacheOn && f.quick;
      const cache = {
        enabled: quick ? '1' : '0',
        cache_optimistic: quick ? '1' : '0',
        ...(quick ? { size: CACHE_BYTES, optimistic_max_age: `${f.keepHours}h` } : {}),
      };
      changes.push(
        data.hasProxyCache
          ? { op: 'set', config: 'dnsproxy', section: 'cache', values: cache }
          : { op: 'add', config: 'dnsproxy', type: 'dnsproxy', name: 'cache', values: cache },
      );
    } else if (data.proxyEnabled) {
      changes.push({ op: 'set', config: 'dnsproxy', section: 'global', values: { enabled: '0' } });
    }
  }

  if (data.lanDhcp !== undefined) changes.push(...deviceDnsChanges(data.lanDhcp['.name'], data.lanDhcp, f.devices));

  // one redirect per zone: the home network's and each guest network's; none
  // while devices use another server, whose own lookups it would catch too
  const wanted = f.intercept && !f.devices.own ? data.interceptZones : [];
  for (const zone of wanted) {
    const s = data.intercepts.find((x) => x.section === interceptSection(zone));
    if (s === undefined) changes.push(addIntercept(zone));
    else if (!s.enabled) changes.push({ op: 'set', config: 'firewall', section: s.section, values: { enabled: '1' } });
  }
  // turned off, or its guest network is gone
  const keep = new Set(wanted.map(interceptSection));
  for (const s of data.intercepts) if (!keep.has(s.section)) changes.push({ op: 'delete', config: 'firewall', section: s.section });

  const kept = new Set(f.records.flatMap((r) => (r.section === undefined ? [] : [r.section])));
  for (const r of data.form.records) if (r.section !== undefined && !kept.has(r.section)) changes.push({ op: 'delete', config: 'dhcp', section: r.section });
  for (const r of f.records) {
    changes.push(
      r.section === undefined
        ? { op: 'add', config: 'dhcp', type: 'domain', values: { name: r.name, ip: r.ip } }
        : { op: 'set', config: 'dhcp', section: r.section, values: { name: r.name, ip: r.ip } },
    );
  }
  return changes;
}
