// The DNS page: how the router looks names up for your devices. It opens on
// the answer (who your devices ask, where the router sends their lookups,
// what the cache and protection do), from the saved settings; then the
// servers (the everyday choice), your devices' DNS server with the rarer
// settings folded under More settings, and the DNS cache with what happens
// to each answer over time. Everything is read and written through UCI
// (dnsmasq in dhcp, dnsproxy, milkflint.dns, the firewall's intercept
// redirects), as LuCI does.
import { Link } from '@tanstack/react-router';
import {
  ArrowRightIcon,
  LockIcon,
  LockOpenIcon,
  type LucideIcon,
  PlusIcon,
  RouterIcon,
  ServerCogIcon,
  ShieldBanIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
} from 'lucide-react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { evaluate } from '@tanstack/react-form';
import { type ReactElement, useMemo } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { PageBoundary } from '@/components/page-boundary';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { pageLink } from '@/lib/router';
import { Segmented } from '../firewall/parts';
import { Answer, AnswerCell, ChoiceCards, Figure, GoLink } from '@/components/page-kit';
import { explain } from '@/components/explain';
import { MoreSettings } from '@/components/more-settings';
import { dnsAnswer, moreSummary, outsideNote } from './answer';
import { CacheCard } from './cache-card';
import { loops } from './device-dns';
import { INTERCEPT, interceptSection } from './intercept';
import {
  backupPick,
  backupUseOf,
  dnsErrors,
  type DnsForm,
  dnsFormKeys,
  dnsFormSchema,
  mainPick,
  type Mode,
  plan,
  toChanges,
} from './model';
import { dnsQueries } from './queries';
import { isProviderId, type Proto, protoLabels, type ProviderId, providers } from './providers';
import {
  backupDnssecWarning,
  describe,
  dnssecWarning,
  filterWarning,
  matchingServer,
  type Pair,
  protoNote,
  type ServerPick,
  serverHint,
  serverOf,
  serversOf,
  shortName,
  suggestBackup,
  TIMEOUT_S,
} from './upstreams';

const DNSMASQ = 'dhcp.@dnsmasq[0]';

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
    hint: 'Servers you choose, encrypted: your internet provider can’t see or change lookups.',
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
      'Each lookup goes to both servers and the first answer is used. Nothing waits when one is slow or down, but both providers see your lookups.',
  },
  fallback: {
    label: 'Main + backup',
    hint: (mode) =>
      mode === 'encrypted'
        ? `Lookups go to the main server, and to the backup only when the main one fails or is slow. Slow means no answer in ${String(TIMEOUT_S)} seconds. The backup sees few lookups, but during an outage each one waits those seconds first.`
        : 'Lookups go to the main server, and to the backup only when the main one doesn’t answer. The backup sees few lookups, but during an outage each one waits first.',
  },
};

/** What each server slot is called, and the line under it, for one server or two. */
function slotTitles(pair: Pair): [string, string] {
  return pair === 'one' ? ['Server', ''] : pair === 'parallel' ? ['Server 1', 'Server 2'] : ['Main server', 'Backup server'];
}

function slotHints(pair: Pair, mode: Mode, main: string): [string, string] {
  if (pair === 'one') return ['Every lookup goes here.', ''];
  if (pair === 'parallel') return ['Asked at the same time as server 2.', `Asked at the same time as ${main}.`];
  return [
    'Every lookup goes here first.',
    `Asked only if ${main} ${mode === 'encrypted' ? 'fails or is slow' : 'doesn’t answer'}.`,
  ];
}

let nextKey = 0;

function protosOf(provider: ProviderId | 'custom'): readonly Proto[] {
  return provider === 'custom' ? [] : providers[provider].protos;
}

// ---- the servers ------------------------------------------------------------

/** One server: its provider and level (or a custom address), what it blocks and checks, and what it's for. */
function ServerSlot({
  id,
  title,
  hint,
  uci,
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
  hint: string;
  uci: readonly string[];
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
    <Field id={`${id}-provider`} label={title} {...explain(hint, uci)} error={error}>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select
          value={pick.provider}
          onValueChange={(v) => {
            if (v === 'custom' || isProviderId(v)) onProvider(v);
          }}
        >
          <SelectTrigger id={`${id}-provider`}>
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
            aria-describedby={error === undefined ? undefined : `${id}-provider-error`}
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
    </Field>
  );
}

const warn = <TriangleAlertIcon />;

/** The UCI options a server slot writes, for its "Why?". */
function slotUci(slot: 'main' | 'backup', mode: Mode, pair: Pair): string[] {
  const own =
    slot === 'main'
      ? ['milkflint.dns.provider', 'milkflint.dns.server', 'milkflint.dns.custom']
      : ['milkflint.dns.backup', 'milkflint.dns.backup_server', 'milkflint.dns.backup_custom'];
  const out =
    mode === 'static'
      ? [`${DNSMASQ}.server`]
      : slot === 'backup' && pair === 'fallback'
        ? ['dnsproxy.servers.fallback']
        : ['dnsproxy.servers.upstream', 'dnsproxy.servers.bootstrap'];
  return [...own, ...out];
}

export function DnsPage(): ReactElement {
  return (
    <>
      <PageHeader title="DNS" description="How your devices look up names, protection, and names on your network." />
      <PageBoundary>
        <DnsSettings />
      </PageBoundary>
    </>
  );
}

const noErrors: ReturnType<typeof dnsErrors> = { form: {}, records: {} };

function DnsSettings(): ReactElement {
  const { data } = useSuspenseQuery(dnsQueries.settings());
  const status = useLive(dnsQueries.status()).data;
  // AdGuard Home on the router, filtering in front of these settings (a firmware without it: nothing)
  const agh = useQuery(dnsQueries.adguard()).data ?? undefined;
  const aghOn = agh?.installed === true && agh.enabled === true && agh.mode !== 'ap';
  const { state, apply } = useApply();
  const schema = useMemo(() => dnsFormSchema(data), [data]);
  const settings = useSettingsForm({ schema, saved: data.form, onSave: (values) => apply(toChanges(values, data)) });
  const { form: formApi } = settings;
  const form = useFormValues(formApi);
  // several fields at once (a provider brings its server and protocol): each one that changes, as typed
  const update = (fn: (f: DnsForm) => DnsForm): void => {
    const next = fn(form);
    for (const key of dnsFormKeys) if (!evaluate(form[key], next[key])) formApi.setFieldValue(key, next[key]);
  };
  const set = <K extends keyof DnsForm>(key: K, value: DnsForm[K]): void => {
    update((f) => ({ ...f, [key]: value }));
  };
  // errors once a change or a save has checked the form
  const errors = settings.dirty || settings.invalid ? dnsErrors(form, data) : noErrors;
  const invalid = Object.keys(errors.form).length > 0 || Object.keys(errors.records).length > 0;
  // on, but a guest network has no redirect of its own yet (made before the switch covered them)
  const uncovered =
    form.intercept &&
    !form.devices.own &&
    data.form.intercept &&
    data.interceptZones.some((z) => !data.intercepts.some((x) => x.section === interceptSection(z) && x.enabled));
  const dirty = settings.dirty || uncovered;

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
        : {
            ...next,
            backup: f.provider,
            backupServer: matchingServer(f.provider, serverOf({ provider: v, server, custom: '' })?.blocks),
          };
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
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {(() => {
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
          const sends =
            form.mode === 'static' ? planned.dnsmasq : [...(planned.proxy?.upstream ?? []), ...(planned.proxy?.fallback ?? [])];
          const ids = Object.keys(providers) as ProviderId[];
          const [mainTitle, backupTitle] = slotTitles(form.pair);
          const [mainHint, backupHint] = slotHints(form.pair, form.mode, shortName(main));
          // a DNS program set up outside MilkFlint (ctrld, ...) that devices' lookups reach
          const outside = status?.outside;
          const now = dnsAnswer(data.form, data.routerIp, aghOn, outside);
          const outsideWarning = outside === undefined ? undefined : outsideNote(outside, data.form.mode);
          const notRunning = data.form.mode === 'encrypted' && status?.running === false;
          const lan = data.lanDhcp?.['.name'] ?? 'lan';
          const foldErrors = errors.form.domain !== undefined || Object.keys(errors.records).length > 0;
          return (
            <>
              <Answer columns={3} label="DNS now">
                <AnswerCell
                  title="Your devices ask"
                  value={<Figure>{now.devices.value}</Figure>}
                  action={now.devices.who === 'adguard' ? <GoLink to={pageLink('adguardhome')}>AdGuard Home</GoLink> : undefined}
                >
                  {now.devices.text}
                </AnswerCell>
                <AnswerCell
                  title="The router sends lookups to"
                  value={
                    <>
                      <Figure>{now.upstream.value}</Figure>
                      {now.upstream.outside === true ? (
                        <Badge variant="outline">Set up outside MilkFlint</Badge>
                      ) : notRunning ? (
                        <Badge variant="warning">Not running</Badge>
                      ) : now.upstream.encrypted ? (
                        <Badge variant="success">Encrypted</Badge>
                      ) : (
                        <Badge variant="outline">Not encrypted</Badge>
                      )}
                    </>
                  }
                  action={
                    notRunning && now.upstream.outside !== true ? (
                      <GoLink to={pageLink('logs')}>The system log</GoLink>
                    ) : undefined
                  }
                >
                  {notRunning && now.upstream.outside !== true
                    ? 'Encrypted DNS is set up, but its service (dnsproxy) isn’t running.'
                    : now.upstream.text}
                </AnswerCell>
                <AnswerCell title="Cache and protection" value={<Figure>{now.protection.value}</Figure>}>
                  {now.protection.text}
                </AnswerCell>
              </Answer>

              <Card>
                <CardHeading
                  title="DNS servers"
                  status={outsideWarning?.status ?? describe(form.mode, main, backup, form.pair)}
                />
                <CardContent className="flex flex-col gap-5">
                  {outsideWarning !== undefined && (
                    <Note tone="warning" icon={warn} title={outsideWarning.title}>
                      {outsideWarning.text}
                    </Note>
                  )}
                  {aghOn && (
                    <Note tone="info" icon={<ShieldBanIcon />}>
                      <Link {...pageLink('adguardhome')} className="font-medium link underline-offset-4">
                        AdGuard Home
                      </Link>{' '}
                      filters your devices’ lookups first; what it doesn’t block comes here. These servers, the cache and the
                      protection below are set here, not in AdGuard Home.
                    </Note>
                  )}
                  <section aria-labelledby="dns-how" className="flex flex-col gap-3">
                    <h3 id="dns-how" className="text-sm font-medium">
                      How lookups are sent
                    </h3>
                    <ChoiceCards
                      label="How lookups are sent"
                      columns={3}
                      value={form.mode}
                      options={(Object.keys(modes) as Mode[]).map((m) => ({
                        value: m,
                        label: modes[m].label,
                        icon: modes[m].icon,
                        hint:
                          m === 'encrypted' && !data.proxyInstalled
                            ? 'Needs the dnsproxy package, which isn’t in this firmware.'
                            : modes[m].hint,
                        ...(m === 'encrypted' && data.proxyInstalled
                          ? { badge: <Badge variant="secondary">Recommended</Badge> }
                          : {}),
                        disabled: m === 'encrypted' && !data.proxyInstalled,
                      }))}
                      onChange={(m) => {
                        set('mode', m);
                      }}
                    />
                  </section>

                  {chosen && (
                    <section aria-label="Servers" className="flex flex-col gap-4">
                      <div className="divide-y border-t">
                        <Field
                          id="dns-pair"
                          label="Servers"
                          {...explain(pairs[form.pair].hint(form.mode), [
                            'milkflint.dns.backup',
                            'milkflint.dns.backup_use',
                            ...(form.mode === 'static'
                              ? [`${DNSMASQ}.allservers`, `${DNSMASQ}.strictorder`]
                              : ['dnsproxy.global.upstream_mode']),
                          ])}
                        >
                          <Segmented
                            label="Servers"
                            value={form.pair}
                            options={(Object.keys(pairs) as Pair[]).map((p) => ({ value: p, label: pairs[p].label }))}
                            onChange={(p) => {
                              update((f) => {
                                // a second server from the main one's provider (left from earlier): a fresh suggestion
                                const fresh = p !== 'one' && f.backup !== 'custom' && f.backup === f.provider;
                                const s = fresh ? suggestBackup(mainPick(f)) : undefined;
                                return {
                                  ...f,
                                  pair: p,
                                  ...(s === undefined ? {} : { backup: s.provider, backupServer: s.server }),
                                };
                              });
                            }}
                          />
                        </Field>
                        <ServerSlot
                          id="dns"
                          title={mainTitle}
                          hint={mainHint}
                          uci={slotUci('main', form.mode, form.pair)}
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
                          <ServerSlot
                            id="dns-backup"
                            title={backupTitle}
                            hint={backupHint}
                            uci={slotUci('backup', form.mode, form.pair)}
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
                        )}
                        {form.mode === 'encrypted' && form.provider !== 'custom' && (
                          <Field
                            id="dns-proto"
                            label="Encryption"
                            {...explain(
                              backup === undefined
                                ? 'All three keep lookups private; DNS over HTTPS is the hardest for a network to block.'
                                : 'Used for both servers. All three keep lookups private; DNS over HTTPS is the hardest for a network to block.',
                              ['milkflint.dns.proto'],
                            )}
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
                      </div>
                      {filter !== undefined && (
                        <Note tone="warning" icon={warn} title="They don’t filter the same">
                          {filter}
                        </Note>
                      )}
                      {dnssec !== undefined && (
                        <Note tone="warning" icon={warn} title="Doesn’t check DNSSEC">
                          {dnssec}
                        </Note>
                      )}
                      {backupDnssec !== undefined && (
                        <Note tone="warning" icon={warn} title="The second server doesn’t check DNSSEC">
                          {backupDnssec}
                        </Note>
                      )}
                      {sends.length > 0 &&
                        Object.keys(errors.form).every((k) => k === 'domain' || k === 'cacheSize' || k.startsWith('own')) && (
                          <p className="text-xs text-muted-foreground">
                            Sends to <span className="font-mono break-all text-foreground">{sends.join(', ')}</span>
                          </p>
                        )}
                    </section>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeading
                  title="Your devices’ DNS server"
                  status={
                    form.devices.own ? 'Devices on your home network ask another server directly.' : 'Devices ask the router.'
                  }
                />
                <CardContent className="flex flex-col gap-4">
                  <ChoiceCards
                    label="Your devices’ DNS server"
                    columns={2}
                    value={form.devices.own ? 'own' : 'router'}
                    options={[
                      {
                        value: 'router',
                        label: 'This router',
                        hint: 'Devices ask the router, which uses the DNS servers above and answers names on your network.',
                        icon: RouterIcon,
                      },
                      {
                        value: 'own',
                        label: 'Another server on your network',
                        hint: 'Such as a Pi-hole or AdGuard Home: devices ask it directly, so it sees and filters each device’s lookups.',
                        icon: ServerCogIcon,
                      },
                    ]}
                    onChange={(v) => {
                      update((f) => ({ ...f, devices: { ...f.devices, own: v === 'own' } }));
                    }}
                  />
                  {form.devices.own && (
                    <>
                      <div className="divide-y">
                        <Field
                          id="dns-own-ipv4"
                          label="IPv4 address"
                          {...explain(
                            'Give the server an address that doesn’t change (a reservation). Two addresses for two servers.',
                            [`dhcp.${lan}.dhcp_option (6,…)`],
                          )}
                          error={errors.form.ownIpv4}
                        >
                          <Input
                            id="dns-own-ipv4"
                            className="font-mono"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={data.routerIp.replace(/\.\d+$/, '.53')}
                            value={form.devices.ipv4}
                            aria-invalid={errors.form.ownIpv4 !== undefined}
                            onChange={(e) => {
                              const ipv4 = e.target.value;
                              update((f) => ({ ...f, devices: { ...f.devices, ipv4 } }));
                            }}
                          />
                        </Field>
                        <Field
                          id="dns-own-ipv6"
                          label="IPv6 address (optional)"
                          {...explain(
                            'If it has one that doesn’t change. Without one, the router stops offering itself for DNS over IPv6, so devices can’t skip your server that way.',
                            [`dhcp.${lan}.dns`, `dhcp.${lan}.dns_service`],
                          )}
                          error={errors.form.ownIpv6}
                        >
                          <Input
                            id="dns-own-ipv6"
                            className="font-mono"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder="fd00::53"
                            value={form.devices.ipv6}
                            aria-invalid={errors.form.ownIpv6 !== undefined}
                            onChange={(e) => {
                              const ipv6 = e.target.value;
                              update((f) => ({ ...f, devices: { ...f.devices, ipv6 } }));
                            }}
                          />
                        </Field>
                      </div>
                      <ul className="flex max-w-3xl list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
                        <li>
                          For its own lookups, your server can use the router (
                          <span className="font-mono text-foreground">{data.routerIp}</span>): it then gets the DNS servers above,
                          and names on your network (name.{form.domain}).
                        </li>
                        <li>Devices switch when they next renew their address; reconnecting one switches it at once.</li>
                        <li>Guest networks keep using the router.</li>
                      </ul>
                      {aghOn && (
                        <Note tone="warning" icon={warn}>
                          AdGuard Home on the router doesn’t filter your home network’s devices then: they ask your server
                          directly. Only the guest networks’ and Remote access’s lookups go through it.
                        </Note>
                      )}
                      {form.mode === 'static' && loops(form.devices, planned.dnsmasq) && (
                        <Note tone="warning" icon={warn} title="Lookups could go round in circles">
                          The router sends its own lookups to your server. If your server sends its lookups to the router too,
                          none get answered: give one of them a server on the internet.
                        </Note>
                      )}
                    </>
                  )}
                  <MoreSettings summary={moreSummary(form, { uncovered, invalid: foldErrors })}>
                    <Field
                      id="dns-intercept"
                      label="Catch devices with their own DNS"
                      {...explain(
                        `The router answers devices set to use another DNS server. That covers your home and guest networks${aghOn ? ', through AdGuard Home' : ''}. Apps that encrypt DNS themselves get past it. It’s one firewall redirect per network.`,
                        [`firewall.${INTERCEPT}`, `firewall.${INTERCEPT}_<zone>`],
                      )}
                    >
                      <Switch
                        id="dns-intercept"
                        checked={form.intercept && !form.devices.own}
                        disabled={form.devices.own}
                        onCheckedChange={(v) => {
                          set('intercept', v);
                        }}
                      />
                      {form.devices.own && (
                        <p className="text-xs text-muted-foreground">
                          Off while devices use another DNS server: it would catch that server’s own lookups too.
                        </p>
                      )}
                      {uncovered && (
                        <p className="text-xs text-muted-foreground">Not on every guest network yet: save to add it there.</p>
                      )}
                    </Field>
                    <Field
                      id="dns-rebind"
                      label="Rebinding protection"
                      {...explain(
                        'Stops websites pointing names at addresses inside your network. That’s what DNS rebinding attacks do.',
                        [`${DNSMASQ}.rebind_protection`],
                      )}
                    >
                      <Switch
                        id="dns-rebind"
                        checked={form.rebind}
                        onCheckedChange={(v) => {
                          set('rebind', v);
                        }}
                      />
                    </Field>
                    <Field
                      id="dns-domain"
                      label="Local domain"
                      {...explain(`Devices are reachable as name.${form.domain}.`, [`${DNSMASQ}.domain`, `${DNSMASQ}.local`])}
                      error={errors.form.domain}
                    >
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
                    <formApi.Field name="records" mode="array">
                      {(list) => (
                        <section aria-labelledby="dns-names" className="flex flex-col gap-3 py-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                            <div className="flex min-w-0 flex-col gap-1">
                              <h3 id="dns-names" className="text-sm font-medium">
                                Custom names
                              </h3>
                              <p className="text-xs text-muted-foreground">
                                Names the router answers itself, for every device on your network. Each is a{' '}
                                <code className="font-mono">domain</code> section in dhcp.
                              </p>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                list.pushValue({ key: `new-${String(nextKey++)}`, section: undefined, name: '', ip: '' });
                              }}
                            >
                              <PlusIcon /> Add
                            </Button>
                          </div>
                          {list.state.value.length === 0 ? (
                            <p className="text-sm text-muted-foreground">None yet. For example: nas, at 192.168.1.20.</p>
                          ) : (
                            <ul className="flex max-w-2xl flex-col gap-3">
                              {list.state.value.map((r, i) => {
                                const which = r.name === '' ? `custom name ${String(i + 1)}` : r.name;
                                const rowError = errors.records[r.key];
                                return (
                                  <li key={r.key} className="flex flex-col gap-1">
                                    <div className="flex items-start gap-2">
                                      <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
                                        <formApi.Field name={`records[${i}].name`}>
                                          {(field) => (
                                            <Input
                                              aria-label={`Name, ${which}`}
                                              placeholder="nas"
                                              className="font-mono"
                                              value={field.state.value}
                                              aria-invalid={rowError !== undefined}
                                              onChange={(e) => {
                                                field.handleChange(e.target.value.trim());
                                              }}
                                              onBlur={field.handleBlur}
                                            />
                                          )}
                                        </formApi.Field>
                                        <ArrowRightIcon
                                          className="hidden size-4 text-muted-foreground sm:block"
                                          aria-hidden="true"
                                        />
                                        <formApi.Field name={`records[${i}].ip`}>
                                          {(field) => (
                                            <Input
                                              aria-label={`IP address, ${which}`}
                                              placeholder="192.168.1.20"
                                              className="font-mono"
                                              value={field.state.value}
                                              aria-invalid={rowError !== undefined}
                                              onChange={(e) => {
                                                field.handleChange(e.target.value.trim());
                                              }}
                                              onBlur={field.handleBlur}
                                            />
                                          )}
                                        </formApi.Field>
                                      </div>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="text-muted-foreground hover:text-foreground"
                                        aria-label={`Remove ${which}`}
                                        onClick={() => {
                                          list.removeValue(i);
                                        }}
                                      >
                                        <Trash2Icon />
                                      </Button>
                                    </div>
                                    {rowError !== undefined && <p className="text-xs font-medium text-destructive">{rowError}</p>}
                                  </li>
                                );
                              })}
                            </ul>
                          )}
                        </section>
                      )}
                    </formApi.Field>
                  </MoreSettings>
                </CardContent>
              </Card>

              <CacheCard form={form} set={set} sizeError={errors.form.cacheSize} adguard={aghOn} />
            </>
          );
        })()}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={settings.save}
        onRevert={settings.discard}
      />
    </>
  );
}
