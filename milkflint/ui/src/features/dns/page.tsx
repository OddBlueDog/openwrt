import {
  ArrowDownIcon,
  LockIcon,
  LockOpenIcon,
  type LucideIcon,
  PlusIcon,
  ServerIcon,
  ShieldCheckIcon,
  TagIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
  ZapIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { ipToInt } from '@/lib/api/network';
import { bool, type Change, getConfig, list, type Section, str } from '@/lib/api/uci';
import { Choice, Segmented } from '../firewall/parts';
import { SERVER } from '../remote-access/sections';
import { type GuestId, isGuestNetwork } from '../wifi-guest/guest';
import { getDnsStatus } from './api';
import { addIntercept, INTERCEPT_SECTIONS, type InterceptZone, interceptOn, interceptSection } from './intercept';
import { isProviderId, type Proto, protoLabels, protoOf, type ProviderId, providers } from './providers';
import {
  backupDnssecWarning,
  type BackupUse,
  DEFAULT_KEEP_HOURS,
  describe,
  dnssecWarning,
  filterWarning,
  KEEP_HOURS,
  keepHoursOf,
  matchingServer,
  type Pair,
  plainServers,
  protoNote,
  type ProxyServers,
  proxyServers,
  type ServerPick,
  serverHint,
  serverOf,
  serversOf,
  shortName,
  suggestBackup,
  TIMEOUT_S,
} from './upstreams';

type Mode = 'auto' | 'static' | 'encrypted';

// How lookups are sent: the page's first choice. 'static' is plain DNS
// (the stock firmware's name for it, kept in milkflint.dns.mode).
const modes: Record<Mode, { label: string; hint: string; icon: LucideIcon }> = {
  auto: {
    label: 'Automatic',
    hint: 'Your internet provider’s DNS servers. Nothing to set up, but your provider sees every lookup.',
    icon: WandSparklesIcon,
  },
  static: {
    label: 'Plain DNS',
    hint: 'Servers you choose, unencrypted: your internet provider can still see and change lookups.',
    icon: LockOpenIcon,
  },
  encrypted: {
    label: 'Encrypted DNS',
    hint: 'Servers you choose, encrypted: your internet provider can’t see or change lookups. Recommended.',
    icon: LockIcon,
  },
};

// One server or two, and how two work together: under the type, for plain
// and encrypted DNS alike.
const pairs: Record<Pair, { label: string; hint: (mode: Mode) => string }> = {
  one: { label: 'One server', hint: () => 'Every lookup goes to one provider.' },
  parallel: {
    label: 'Fastest of two',
    hint: () =>
      'Each lookup goes to both servers and the first answer is used, so nothing waits when one is slow or down. Both providers see your lookups.',
  },
  fallback: {
    label: 'Main + backup',
    hint: (mode) =>
      mode === 'encrypted'
        ? `Lookups go to the main server. The backup is asked only when it fails or hasn’t answered in ${String(TIMEOUT_S)} seconds: it sees few lookups, but during an outage each one waits those seconds first.`
        : 'Lookups go to the main server. The backup is asked only when it doesn’t answer: it sees few lookups, but during an outage each one waits first.',
  },
};

/** Where dnsproxy listens for dnsmasq (the stock firmware's port). */
const PROXY = '127.0.0.1#5453';

/** dnsproxy's cache size when instant answers are on, in bytes (its default, 64 KB, holds only a few hundred names). */
const CACHE_BYTES = '4194304';

interface DnsRecord {
  key: string;
  section: string | undefined;
  name: string;
  ip: string;
}

interface DnsForm {
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
  /** dnsproxy's optimistic cache: expired names answered at once and refreshed behind. */
  quick: boolean;
  /** how long after expiring an answer may still be given out, in hours (optimistic_max_age) */
  keepHours: string;
  intercept: boolean;
  rebind: boolean;
  domain: string;
  records: DnsRecord[];
}

interface DnsData {
  form: DnsForm;
  dnsmasq: string | undefined;
  servers: string[];
  managed: string[];
  hasMilkflintDns: boolean;
  hasProxyCache: boolean;
  /** The intercept redirects there are (any zone's), and whether each is on. */
  intercepts: { section: string; enabled: boolean }[];
  /** Where the switch catches devices: the home network and each guest network's zone. */
  interceptZones: InterceptZone[];
  proxyInstalled: boolean;
  proxyEnabled: boolean;
}

let nextKey = 0;

function protosOf(provider: ProviderId | 'custom'): readonly Proto[] {
  return provider === 'custom' ? [] : providers[provider].protos;
}

async function loadDns(): Promise<DnsData> {
  const [dhcp, milkflint, firewall, proxy] = await Promise.all([
    getConfig('dhcp'),
    getConfig('milkflint').catch((): Section[] => []),
    getConfig('firewall'),
    getConfig('dnsproxy').catch((): Section[] => []),
  ]);
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
      quick: bool(cache, 'enabled') && bool(cache, 'cache_optimistic'),
      keepHours: keepHoursOf(str(cache, 'optimistic_max_age')),
      intercept: interceptOn(firewall),
      rebind: bool(dnsmasq, 'rebind_protection', true),
      domain: str(dnsmasq, 'domain') ?? 'lan',
      records: dhcp
        .filter((s) => s['.type'] === 'domain')
        .map((s) => ({ key: s['.name'], section: s['.name'], name: str(s, 'name') ?? '', ip: str(s, 'ip') ?? '' })),
    },
    dnsmasq: dnsmasq?.['.name'],
    servers: list(dnsmasq, 'server'),
    managed: list(rf, 'managed'),
    hasMilkflintDns: rf !== undefined,
    hasProxyCache: cache !== undefined,
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
      ...firewall.flatMap((s): (typeof SERVER)[] => (s['.type'] === 'zone' && str(s, 'name') === SERVER && bool(s, 'enabled', true) ? [SERVER] : [])),
    ],
    proxyInstalled: proxy.some((s) => s['.name'] === 'global'),
    proxyEnabled: bool(proxy.find((s) => s['.name'] === 'global'), 'enabled'),
  };
}

const mainPick = (f: DnsForm): ServerPick => ({ provider: f.provider, server: f.server, custom: f.custom });

const backupPick = (f: DnsForm): ServerPick | undefined =>
  f.pair === 'one' ? undefined : { provider: f.backup, server: f.backupServer, custom: f.backupCustom };

const backupUseOf = (pair: Pair): BackupUse => (pair === 'fallback' ? 'fallback' : 'parallel');

const isIpv6 = (v: string): boolean => /^[0-9a-f:]+$/i.test(v) && v.includes(':');
const splitList = (v: string): string[] => v.split(/[\s,]+/).filter((s) => s !== '');
const isEncryptedUrl = (v: string): boolean => protoOf(v.trim()) !== undefined && !/\s/.test(v.trim());
const isAddressList = (v: string): boolean => {
  const ips = splitList(v);
  return ips.length > 0 && ips.every((ip) => ipToInt(ip) !== undefined || isIpv6(ip));
};

/** What dnsmasq forwards to (plain: the servers; encrypted: dnsproxy), and what dnsproxy uses. */
function plan(f: DnsForm): { dnsmasq: string[]; proxy: ProxyServers | undefined } {
  if (f.mode === 'static') return { dnsmasq: plainServers(mainPick(f), backupPick(f)), proxy: undefined };
  if (f.mode === 'encrypted') return { dnsmasq: [PROXY], proxy: proxyServers(mainPick(f), f.proto, backupPick(f), backupUseOf(f.pair)) };
  return { dnsmasq: [], proxy: undefined };
}

const NAME = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

type FormErrors = Partial<Record<'custom' | 'backup' | 'backupCustom' | 'domain', string>>;

const ADDRESS_LIST = 'One or more IP addresses, separated by commas.';
const ENCRYPTED_URL = 'An address starting https://, tls://, quic:// or sdns://.';

function validate(f: DnsForm): { form: FormErrors; records: Record<string, string> } {
  const form: FormErrors = {};
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
  for (const r of f.records) {
    if (!NAME.test(r.name)) records[r.key] = 'Enter a host name, e.g. nas or printer.home.';
    else if (ipToInt(r.ip) === undefined) records[r.key] = 'Enter an IPv4 address.';
  }
  return { form, records };
}

function toChanges(f: DnsForm, data: DnsData): Change[] {
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
    changes.push({
      op: 'set',
      config: 'dhcp',
      section: data.dnsmasq,
      values: {
        rebind_protection: f.rebind ? '1' : '0',
        domain: f.domain,
        local: `/${f.domain}/`,
        ...(servers.length > 0 ? { server: servers } : {}),
        ...(f.mode === 'auto' ? {} : { noresolv: '1' }),
        ...(two ? (f.pair === 'parallel' ? { allservers: '1' } : { strictorder: '1' }) : {}),
      },
    });
    const unset = [
      ...(servers.length === 0 ? ['server'] : []),
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
      const cache = {
        enabled: f.quick ? '1' : '0',
        cache_optimistic: f.quick ? '1' : '0',
        ...(f.quick ? { size: CACHE_BYTES, optimistic_max_age: `${f.keepHours}h` } : {}),
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

  // one redirect per zone: the home network's and each guest network's
  const wanted = f.intercept ? data.interceptZones : [];
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

// ---- the servers section --------------------------------------------------

/**
 * A part of the DNS servers card: a heading with its choice beside it (below
 * on narrow screens), then what the choice means, then the rest.
 */
function Part({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h3 className="text-sm font-medium">{title}</h3>
          {action}
        </div>
        {hint !== undefined && <p className="max-w-2xl text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

/** One server: its provider and level (or a custom address), and what it blocks and checks. */
function ServerSlot({
  id,
  title,
  mode,
  pick,
  providerIds,
  error,
  onProvider,
  onServer,
  onCustom,
}: {
  id: string;
  title: string;
  mode: Mode;
  pick: ServerPick;
  providerIds: readonly ProviderId[];
  error: string | undefined;
  onProvider: (v: ProviderId | 'custom') => void;
  onServer: (v: string) => void;
  onCustom: (v: string) => void;
}): ReactElement {
  const server = serverOf(pick);
  const custom = pick.provider === 'custom';
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <span className="text-xs font-medium text-muted-foreground uppercase">{title}</span>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={pick.provider}
          onValueChange={(v) => {
            if (v === 'custom' || isProviderId(v)) onProvider(v);
          }}
        >
          <SelectTrigger id={`${id}-provider`} aria-label={`${title}: provider`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {providerIds.map((p) => (
              <SelectItem key={p} value={p}>
                {providers[p].label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        {custom ? (
          <Input
            id={`${id}-custom`}
            aria-label={`${title}: ${mode === 'static' ? 'addresses' : 'address'}`}
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
            placeholder={mode === 'static' ? '192.0.2.53, 198.51.100.53' : 'https://dns.example/dns-query'}
            value={pick.custom}
            aria-invalid={error !== undefined}
            onChange={(e) => {
              onCustom(e.target.value);
            }}
          />
        ) : (
          <Select value={server?.name ?? ''} onValueChange={onServer}>
            <SelectTrigger id={`${id}-server`} aria-label={`${title}: filtering`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {serversOf(pick.provider).map((s) => (
                <SelectItem key={s.name} value={s.name}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {custom
          ? mode === 'static'
            ? 'IPv4 or IPv6 addresses, separated by commas.'
            : 'DoH (https://), DoT (tls://), DoQ (quic://), or a DNS stamp (sdns://) for DNSCrypt.'
          : server === undefined
            ? ''
            : serverHint(server)}
      </p>
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Between two servers: how the second relates to the first. */
function Connector({ pair, mode, main }: { pair: Pair; mode: Mode; main: string }): ReactElement {
  return (
    <div className="flex items-center gap-2 py-0.5 pl-4 text-xs text-muted-foreground" aria-hidden>
      <span className="h-5 border-l border-dashed" />
      {pair === 'parallel' ? <ZapIcon className="size-3.5" /> : <ArrowDownIcon className="size-3.5" />}
      {pair === 'parallel' ? 'Asked at the same time' : `Only if ${main} ${mode === 'encrypted' ? 'fails or is slow' : 'doesn’t answer'}`}
    </div>
  );
}

const WarningBox = ({ title, children }: { title: string; children: ReactNode }): ReactElement => (
  <Alert variant="warning">
    <TriangleAlertIcon />
    <AlertTitle>{title}</AlertTitle>
    <AlertDescription>{children}</AlertDescription>
  </Alert>
);

const slotTitles: Record<Pair, [string, string]> = {
  one: ['Server', ''],
  parallel: ['Server 1', 'Server 2'],
  fallback: ['Main server', 'Backup server'],
};

export function DnsPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadDns);
  const status = usePoll(getDnsStatus, 5000).data;
  const [edit, setEdit] = useState<DnsForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data?.form;
  const update = (fn: (f: DnsForm) => DnsForm): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : fn(base);
    });
  };
  const set = <K extends keyof DnsForm>(key: K, value: DnsForm[K]): void => {
    update((f) => ({ ...f, [key]: value }));
  };
  const errors = form === undefined ? { form: {}, records: {} } : validate(form);
  const invalid = Object.keys(errors.form).length > 0 || Object.keys(errors.records).length > 0;
  // on, but a guest network has no redirect of its own yet (made before the switch covered them)
  const uncovered =
    form?.intercept === true &&
    data?.form.intercept === true &&
    data.interceptZones.some((z) => !data.intercepts.some((x) => x.section === interceptSection(z) && x.enabled));
  const dirty = (edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form)) || uncovered;

  // the main server's provider: a backup from it swaps places with the old main one; with one
  // server, the second slot's suggestion follows the new main one
  const setProvider = (v: ProviderId | 'custom'): void => {
    update((f) => {
      const protos = protosOf(v);
      const server = serversOf(v)[0]?.name ?? '';
      const next = { ...f, provider: v, server, proto: protos.includes(f.proto) ? f.proto : 'doh' };
      if (f.pair === 'one') {
        const s = suggestBackup({ provider: v, server, custom: '' });
        return { ...next, backup: s.provider, backupServer: s.server };
      }
      if (v === 'custom' || f.backup !== v) return next;
      return f.provider === 'custom'
        ? { ...next, backup: 'custom', backupCustom: f.custom }
        : { ...next, backup: f.provider, backupServer: matchingServer(f.provider, serverOf({ provider: v, server, custom: '' })?.blocks) };
    });
  };
  const setBackup = (v: ProviderId | 'custom'): void => {
    update((f) => ({
      ...f,
      backup: v,
      backupServer: v === 'custom' ? '' : matchingServer(v, f.provider === 'custom' ? undefined : serverOf(mainPick(f))?.blocks),
    }));
  };

  return (
    <>
      <PageHeader title="DNS" description="How your devices look up names, protection, and names on your network." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          (() => {
            const main = mainPick(form);
            const backup = backupPick(form);
            const use = backupUseOf(form.pair);
            const planned = plan(form);
            const chosen = form.mode !== 'auto';
            const filter = chosen && backup !== undefined ? filterWarning(main, backup, use) : undefined;
            // the router doesn't check DNSSEC itself: say when a chosen server doesn't either
            const dnssec = chosen ? dnssecWarning(main) : undefined;
            const backupDnssec = chosen && backup !== undefined ? backupDnssecWarning(backup, use) : undefined;
            // the second server can't use the chosen encryption type: it falls back to DNS over HTTPS
            const protoFallback = form.mode === 'encrypted' ? protoNote(main, backup, form.proto) : undefined;
            const sends = form.mode === 'static' ? planned.dnsmasq : [...(planned.proxy?.upstream ?? []), ...(planned.proxy?.fallback ?? [])];
            const ids = Object.keys(providers) as ProviderId[];
            const [mainTitle, backupTitle] = slotTitles[form.pair];
            return (
              <div className="grid items-start gap-4 xl:grid-cols-2">
                <Card className="xl:col-span-2">
                  <CardHeading
                    icon={ServerIcon}
                    title="DNS servers"
                    description={describe(form.mode, main, backup, form.pair)}
                    action={
                      data.form.mode === 'encrypted' && (
                        <Badge variant={status?.running === true ? 'success' : 'warning'}>{status?.running === true ? 'Active' : 'Not running'}</Badge>
                      )
                    }
                  />
                  <CardContent className="flex flex-col gap-6">
                    <Part title="How lookups are sent">
                      <Choice
                        label="How lookups are sent"
                        columns={3}
                        value={form.mode}
                        options={(Object.keys(modes) as Mode[])
                          .filter((m) => m !== 'encrypted' || data.proxyInstalled)
                          .map((m) => ({ value: m, label: modes[m].label, hint: modes[m].hint, icon: modes[m].icon }))}
                        onChange={(m) => {
                          set('mode', m);
                        }}
                      />
                      {!data.proxyInstalled && (
                        <p className="text-xs text-muted-foreground">Encrypted DNS needs the dnsproxy package, which isn&apos;t in this firmware.</p>
                      )}
                    </Part>

                    {chosen && (
                      <Part
                        title="Servers"
                        hint={pairs[form.pair].hint(form.mode)}
                        action={
                          <Segmented
                            label="Servers"
                            value={form.pair}
                            options={(Object.keys(pairs) as Pair[]).map((p) => ({ value: p, label: pairs[p].label }))}
                            onChange={(p) => {
                              update((f) => {
                                // a second server from the main one's provider (left from earlier): a fresh suggestion
                                const fresh = p !== 'one' && f.backup !== 'custom' && f.backup === f.provider;
                                const s = fresh ? suggestBackup(mainPick(f)) : undefined;
                                return { ...f, pair: p, ...(s === undefined ? {} : { backup: s.provider, backupServer: s.server }) };
                              });
                            }}
                          />
                        }
                      >
                        <div className="flex flex-col">
                          <ServerSlot
                            id="dns"
                            title={mainTitle}
                            mode={form.mode}
                            pick={main}
                            providerIds={ids}
                            error={errors.form.custom}
                            onProvider={setProvider}
                            onServer={(v) => {
                              set('server', v);
                            }}
                            onCustom={(v) => {
                              set('custom', v);
                            }}
                          />
                          {backup !== undefined && (
                            <>
                              <Connector pair={form.pair} mode={form.mode} main={shortName(main)} />
                              <ServerSlot
                                id="dns-backup"
                                title={backupTitle}
                                mode={form.mode}
                                pick={backup}
                                providerIds={ids.filter((p) => p !== form.provider || p === form.backup)}
                                error={errors.form.backup ?? errors.form.backupCustom}
                                onProvider={setBackup}
                                onServer={(v) => {
                                  set('backupServer', v);
                                }}
                                onCustom={(v) => {
                                  set('backupCustom', v);
                                }}
                              />
                            </>
                          )}
                        </div>
                        {form.mode === 'encrypted' && form.provider !== 'custom' && (
                          <Field
                            id="dns-proto"
                            label="Encryption"
                            className="pb-0"
                            hint={
                              backup === undefined
                                ? 'All three keep lookups private; DNS over HTTPS is the hardest for a network to block.'
                                : 'Used for both servers.'
                            }
                          >
                            <Select
                              value={form.proto}
                              onValueChange={(v) => {
                                set('proto', v as Proto);
                              }}
                            >
                              <SelectTrigger id="dns-proto">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {protosOf(form.provider).map((p) => (
                                  <SelectItem key={p} value={p}>
                                    {protoLabels[p]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {protoFallback !== undefined && <p className="text-xs text-muted-foreground">{protoFallback}</p>}
                          </Field>
                        )}
                        {filter !== undefined && <WarningBox title="They don’t filter the same">{filter}</WarningBox>}
                        {dnssec !== undefined && <WarningBox title="Doesn’t check DNSSEC">{dnssec}</WarningBox>}
                        {backupDnssec !== undefined && <WarningBox title="The second server doesn’t check DNSSEC">{backupDnssec}</WarningBox>}
                        {sends.length > 0 && Object.keys(errors.form).every((k) => k === 'domain') && (
                          <p className="text-xs text-muted-foreground">
                            Sends to <span className="font-mono break-all text-foreground">{sends.join(', ')}</span>
                          </p>
                        )}
                      </Part>
                    )}
                  </CardContent>
                </Card>

                {form.mode === 'encrypted' && (
                  <Card className="xl:col-span-2">
                    <CardHeading icon={ZapIcon} title="Speed" description="Answers from the router’s memory, so devices wait less." />
                    <CardContent className="divide-y">
                      <Field
                        id="dns-quick"
                        label="Instant answers"
                        hint="The router remembers each answer for as long as the site allows, often only a few minutes. With this on, it keeps using an answer after that, straight away instead of making the device wait, and fetches a fresh one in the background. Rarely, a site that has just changed its address won't load on the first try; reloading fixes it."
                      >
                        <Switch
                          id="dns-quick"
                          checked={form.quick}
                          onCheckedChange={(v) => {
                            set('quick', v);
                          }}
                        />
                      </Field>
                      {form.quick && (
                        <Field
                          id="dns-keep"
                          label="Use old answers for up to"
                          hint="Sites your devices keep using are refreshed long before this. It's for ones they come back to later: after this long, the old answer is dropped and the next visit waits for a fresh one as usual."
                        >
                          <Select
                            value={form.keepHours}
                            onValueChange={(v) => {
                              set('keepHours', v);
                            }}
                          >
                            <SelectTrigger id="dns-keep">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {KEEP_HOURS.map((h) => (
                                <SelectItem key={h} value={h}>
                                  {h === '1' ? '1 hour' : h === '24' ? '1 day' : h === '48' ? '2 days' : `${h} hours`}
                                  {h === DEFAULT_KEEP_HOURS ? ' (default)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeading icon={ShieldCheckIcon} title="Protection" />
                  <CardContent className="divide-y">
                    <Field
                      id="dns-intercept"
                      label="Catch devices with their own DNS"
                      hint="Devices on your home and guest networks set to use another DNS server are answered by the router instead. Apps that encrypt DNS themselves get past it."
                    >
                      <Switch
                        id="dns-intercept"
                        checked={form.intercept}
                        onCheckedChange={(v) => {
                          set('intercept', v);
                        }}
                      />
                      {uncovered && <p className="text-xs text-muted-foreground">Not on every guest network yet: save to add it there.</p>}
                    </Field>
                    <Field
                      id="dns-rebind"
                      label="Rebinding protection"
                      hint="Stops websites from pointing names at addresses inside your network (DNS rebinding attacks)."
                    >
                      <Switch
                        id="dns-rebind"
                        checked={form.rebind}
                        onCheckedChange={(v) => {
                          set('rebind', v);
                        }}
                      />
                    </Field>
                    <Field id="dns-domain" label="Local domain" hint={`Devices are reachable as name.${form.domain}`} error={errors.form.domain}>
                      <Input
                        id="dns-domain"
                        className="font-mono"
                        value={form.domain}
                        aria-invalid={errors.form.domain !== undefined}
                        onChange={(e) => {
                          set('domain', e.target.value.trim());
                        }}
                      />
                    </Field>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeading
                    icon={TagIcon}
                    title="Custom names"
                    description="Names the router answers itself, for every device on your network."
                    action={
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          update((f) => ({ ...f, records: [...f.records, { key: `new-${String(nextKey++)}`, section: undefined, name: '', ip: '' }] }));
                        }}
                      >
                        <PlusIcon /> Add
                      </Button>
                    }
                  />
                  <CardContent className="flex flex-col gap-2">
                    {form.records.length === 0 && <p className="text-sm text-muted-foreground">None yet. Example: nas → 192.168.1.20.</p>}
                    {form.records.map((r) => (
                      <div key={r.key} className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <Input
                            aria-label="Name"
                            placeholder="nas"
                            className="font-mono"
                            value={r.name}
                            aria-invalid={errors.records[r.key] !== undefined}
                            onChange={(e) => {
                              const name = e.target.value.trim();
                              update((f) => ({ ...f, records: f.records.map((x) => (x.key === r.key ? { ...x, name } : x)) }));
                            }}
                          />
                          <span className="text-muted-foreground">→</span>
                          <Input
                            aria-label="IP address"
                            placeholder="192.168.1.20"
                            className="font-mono"
                            value={r.ip}
                            aria-invalid={errors.records[r.key] !== undefined}
                            onChange={(e) => {
                              const ip = e.target.value.trim();
                              update((f) => ({ ...f, records: f.records.map((x) => (x.key === r.key ? { ...x, ip } : x)) }));
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Remove"
                            onClick={() => {
                              update((f) => ({ ...f, records: f.records.filter((x) => x.key !== r.key) }));
                            }}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                        {errors.records[r.key] !== undefined && <p className="text-xs text-destructive">{errors.records[r.key]}</p>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>
            );
          })()
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          if (form !== undefined && data !== undefined) void apply(toChanges(form, data));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
