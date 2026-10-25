import { PlusIcon, ServerIcon, ShieldCheckIcon, TagIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
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
import { SERVER } from '../remote-access/sections';
import { type GuestId, isGuestNetwork } from '../wifi-guest/guest';
import { getDnsStatus } from './api';
import { addIntercept, INTERCEPT_SECTIONS, type InterceptZone, interceptOn, interceptSection } from './intercept';
import { type DnsServer, isProviderId, type Proto, protoLabels, protoOf, type ProviderId, providers, urlFor } from './providers';

type Mode = 'auto' | 'static' | 'encrypted';

const modes: Record<Mode, { label: string; hint: string }> = {
  auto: { label: 'Automatic', hint: 'The DNS servers your internet provider hands out.' },
  static: { label: 'Static', hint: 'Plain DNS to the servers you choose. Your internet provider can still see the lookups.' },
  encrypted: { label: 'Encrypted', hint: 'Lookups go encrypted to the provider you choose: your internet provider can’t read or change them.' },
};

/** Where dnsproxy listens for dnsmasq (the stock firmware's port). */
const PROXY = '127.0.0.1#5453';

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
  /** The intercept redirects there are (any zone's), and whether each is on. */
  intercepts: { section: string; enabled: boolean }[];
  /** Where the switch catches devices: the home network and each guest network's zone. */
  interceptZones: InterceptZone[];
  proxyInstalled: boolean;
  proxyEnabled: boolean;
}

let nextKey = 0;

function serversOf(provider: ProviderId | 'custom'): readonly DnsServer[] {
  return provider === 'custom' ? [] : providers[provider].servers;
}

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
  const provider = str(rf, 'provider') ?? 'cloudflare';
  const proto = str(rf, 'proto');
  return {
    form: {
      mode: mode === 'static' || mode === 'encrypted' ? mode : 'auto',
      provider: provider === 'custom' || isProviderId(provider) ? provider : 'cloudflare',
      server: str(rf, 'server') ?? '',
      proto: proto === 'dot' || proto === 'doq' ? proto : 'doh',
      custom: str(rf, 'custom') ?? '',
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

/** The chosen server of a provider (the first if the saved one is gone). */
function serverFor(f: DnsForm): DnsServer | undefined {
  const servers = serversOf(f.provider);
  return servers.find((s) => s.name === f.server) ?? servers[0];
}

const isIpv6 = (v: string): boolean => /^[0-9a-f:]+$/i.test(v) && v.includes(':');
const splitList = (v: string): string[] => v.split(/[\s,]+/).filter((s) => s !== '');

/** What dnsmasq forwards to (static: the servers; encrypted: dnsproxy), and dnsproxy's upstream. */
function plan(f: DnsForm): { dnsmasq: string[]; upstream: string | undefined; bootstrap: string[] } {
  const server = serverFor(f);
  if (f.mode === 'static') {
    return { dnsmasq: f.provider === 'custom' ? splitList(f.custom) : [...(server?.v4 ?? []), ...(server?.v6 ?? [])], upstream: undefined, bootstrap: [] };
  }
  if (f.mode === 'encrypted') {
    const upstream = f.provider === 'custom' ? f.custom.trim() : server === undefined ? undefined : urlFor(server, f.proto);
    // plain DNS servers dnsproxy asks for the encrypted server's own address
    const bootstrap = (f.provider === 'custom' ? ['1.1.1.1', '9.9.9.9'] : (server?.v4 ?? [])).map((ip) => `${ip}:53`);
    return { dnsmasq: [PROXY], upstream, bootstrap };
  }
  return { dnsmasq: [], upstream: undefined, bootstrap: [] };
}

const NAME = /^(?=.{1,253}$)([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

function validate(f: DnsForm): { form: Partial<Record<'custom' | 'domain', string>>; records: Record<string, string> } {
  const form: Partial<Record<'custom' | 'domain', string>> = {};
  const records: Record<string, string> = {};
  if (f.provider === 'custom' && f.mode === 'static') {
    const ips = splitList(f.custom);
    if (ips.length === 0 || !ips.every((ip) => ipToInt(ip) !== undefined || isIpv6(ip))) {
      form.custom = 'One or more IP addresses, separated by commas.';
    }
  }
  if (f.provider === 'custom' && f.mode === 'encrypted' && (protoOf(f.custom.trim()) === undefined || /\s/.test(f.custom.trim()))) {
    form.custom = 'An address starting https://, tls://, quic:// or sdns://.';
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
  const server = serverFor(f);
  const rf = {
    mode: f.mode,
    provider: f.provider,
    server: server?.name ?? '',
    proto: f.proto,
    custom: f.custom.trim(),
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
      },
    });
    const unset = [...(servers.length === 0 ? ['server'] : []), ...(f.mode === 'auto' && data.form.mode !== 'auto' ? ['noresolv'] : [])];
    if (unset.length > 0) changes.push({ op: 'unset', config: 'dhcp', section: data.dnsmasq, options: unset });
  }

  if (data.proxyInstalled) {
    if (f.mode === 'encrypted' && p.upstream !== undefined) {
      changes.push({ op: 'set', config: 'dnsproxy', section: 'global', values: { enabled: '1', listen_addr: ['127.0.0.1'], listen_port: ['5453'] } });
      changes.push({ op: 'set', config: 'dnsproxy', section: 'servers', values: { upstream: [p.upstream], bootstrap: p.bootstrap } });
      // no fallback: it would send lookups to another provider whenever this one is slow
      changes.push({ op: 'unset', config: 'dnsproxy', section: 'servers', options: ['fallback'] });
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
  const server = form === undefined ? undefined : serverFor(form);
  const uses = form === undefined ? undefined : plan(form);

  return (
    <>
      <PageHeader title="DNS" description="Which DNS servers your network uses, protection, and names on your network." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-2">
            <Card className="xl:col-span-2">
              <CardHeading
                icon={ServerIcon}
                title="DNS servers"
                description={modes[form.mode].hint}
                action={
                  data.form.mode === 'encrypted' && (
                    <Badge variant={status?.running === true ? 'success' : 'warning'}>{status?.running === true ? 'Active' : 'Not running'}</Badge>
                  )
                }
              />
              <CardContent className="divide-y">
                <Field id="dns-mode" label="Type">
                  <div role="group" aria-label="DNS type" className="inline-flex w-fit gap-0.5 rounded-md border p-0.5">
                    {(Object.keys(modes) as Mode[]).map((m) => (
                      <Button
                        key={m}
                        type="button"
                        size="sm"
                        variant={form.mode === m ? 'secondary' : 'ghost'}
                        className="h-7 px-3"
                        aria-pressed={form.mode === m}
                        disabled={m === 'encrypted' && !data.proxyInstalled}
                        onClick={() => {
                          set('mode', m);
                        }}
                      >
                        {modes[m].label}
                      </Button>
                    ))}
                  </div>
                  {!data.proxyInstalled && (
                    <p className="text-xs text-muted-foreground">Encrypted needs the dnsproxy package, which isn&apos;t in this firmware.</p>
                  )}
                </Field>
                {form.mode !== 'auto' && (
                  <>
                    <Field id="dns-provider" label="DNS provider">
                      <Select
                        value={form.provider}
                        onValueChange={(v) => {
                          update((f) => {
                            const provider = v === 'custom' || isProviderId(v) ? v : f.provider;
                            const protos = protosOf(provider);
                            return {
                              ...f,
                              provider,
                              server: serversOf(provider)[0]?.name ?? '',
                              proto: protos.includes(f.proto) ? f.proto : 'doh',
                            };
                          });
                        }}
                      >
                        <SelectTrigger id="dns-provider">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(providers) as ProviderId[]).map((id) => (
                            <SelectItem key={id} value={id}>
                              {providers[id].label}
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Custom</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    {form.provider === 'custom' ? (
                      <Field
                        id="dns-custom"
                        label={form.mode === 'static' ? 'DNS servers' : 'Server address'}
                        hint={
                          form.mode === 'static'
                            ? 'IPv4 or IPv6 addresses, separated by commas.'
                            : 'DoH (https://), DoT (tls://), DoQ (quic://), or a DNS stamp (sdns://) for DNSCrypt.'
                        }
                        error={errors.form.custom}
                      >
                        <Input
                          id="dns-custom"
                          className="font-mono"
                          autoComplete="off"
                          spellCheck={false}
                          placeholder={form.mode === 'static' ? '1.1.1.1, 9.9.9.9' : 'https://dns.example/dns-query'}
                          value={form.custom}
                          aria-invalid={errors.form.custom !== undefined}
                          onChange={(e) => {
                            set('custom', e.target.value);
                          }}
                        />
                      </Field>
                    ) : (
                      <>
                        {form.mode === 'encrypted' && (
                          <Field id="dns-proto" label="Encryption type">
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
                          </Field>
                        )}
                        <Field id="dns-server" label="DNS servers" hint={server?.description}>
                          <Select
                            value={server?.name ?? ''}
                            onValueChange={(v) => {
                              set('server', v);
                            }}
                          >
                            <SelectTrigger id="dns-server">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {serversOf(form.provider).map((s) => (
                                <SelectItem key={s.name} value={s.name}>
                                  {s.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                      </>
                    )}
                    {uses !== undefined && errors.form.custom === undefined && (
                      <div className="py-3 text-xs text-muted-foreground">
                        Uses{' '}
                        <span className="font-mono break-all text-foreground">
                          {form.mode === 'static' ? uses.dnsmasq.join(', ') : uses.upstream}
                        </span>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

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
