// The IPv6 page: whether IPv6 works now (wan6, the router's address, the
// prefixes, live every 10 s) and how it's set, then the mode, how devices
// get their addresses and, under More settings, the local (ULA) prefix.
import { ChevronDownIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useId, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getInterfaces } from '@/lib/api/network';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Answer, AnswerCell, ChoiceCards, GoLink } from '@/components/page-kit';
import { explain } from '@/components/explain';
import { MoreSettings } from '@/components/more-settings';

const modes = {
  native: { label: 'Native', hint: 'Your provider delegates a prefix; the router gives each device its own IPv6 address.' },
  relay: {
    label: 'Pass-through',
    hint: "Relays your provider's IPv6 straight to devices. For providers that don't delegate a prefix.",
  },
  off: { label: 'Off', hint: 'No IPv6 on the internet port or for devices.' },
} as const;
type Mode = keyof typeof modes;

const addressing = {
  slaac: { label: 'Automatic (SLAAC)', hint: 'Devices make their own addresses. Works with everything, including Android.' },
  both: { label: 'SLAAC + DHCPv6', hint: 'Devices make their own addresses, and can also ask the router for one.' },
  dhcpv6: { label: 'DHCPv6 only', hint: 'The router hands out every address. Android devices don’t support this.' },
} as const;
type Addressing = keyof typeof addressing;

interface Ipv6Form {
  mode: Mode;
  addressing: Addressing;
  ula: string;
}

interface Ipv6Data {
  form: Ipv6Form;
  wan6Exists: boolean;
  dhcpWan6Exists: boolean;
}

async function loadIpv6(): Promise<Ipv6Data> {
  const [network, dhcp] = await Promise.all([getConfig('network'), getConfig('dhcp')]);
  const wan6 = network.find((s) => s['.name'] === 'wan6');
  const globals = network.find((s) => s['.type'] === 'globals');
  const lan = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan');
  const mode: Mode = wan6 === undefined || bool(wan6, 'disabled') ? 'off' : str(lan, 'ra') === 'relay' ? 'relay' : 'native';
  const slaac = bool(lan, 'ra_slaac', true);
  const dhcpv6 = (str(lan, 'dhcpv6') ?? 'server') === 'server';
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

function toChanges(f: Ipv6Form, data: Ipv6Data): Change[] {
  const changes: Change[] = [];
  const wan6 = { disabled: f.mode === 'off' ? '1' : '0' };
  changes.push(
    data.wan6Exists
      ? { op: 'set', config: 'network', section: 'wan6', values: wan6 }
      : { op: 'add', config: 'network', type: 'interface', name: 'wan6', values: { ...wan6, device: '@wan', proto: 'dhcpv6' } },
  );
  if (f.ula !== '') changes.push({ op: 'set', config: 'network', section: 'globals', values: { ula_prefix: f.ula } });

  if (f.mode === 'relay') {
    const relay = { ra: 'relay', dhcpv6: 'relay', ndp: 'relay' };
    changes.push(
      data.dhcpWan6Exists
        ? { op: 'set', config: 'dhcp', section: 'wan6', values: { ...relay, interface: 'wan6', master: '1' } }
        : {
            op: 'add',
            config: 'dhcp',
            type: 'dhcp',
            name: 'wan6',
            values: { ...relay, interface: 'wan6', master: '1', ignore: '1' },
          },
    );
    changes.push({ op: 'set', config: 'dhcp', section: 'lan', values: relay });
  } else {
    if (data.dhcpWan6Exists) changes.push({ op: 'delete', config: 'dhcp', section: 'wan6' });
    if (f.mode === 'off') {
      changes.push({
        op: 'set',
        config: 'dhcp',
        section: 'lan',
        values: { ra: 'disabled', dhcpv6: 'disabled', ndp: 'disabled' },
      });
    } else {
      changes.push({
        op: 'set',
        config: 'dhcp',
        section: 'lan',
        values: {
          ra: 'server',
          dhcpv6: f.addressing === 'slaac' ? 'disabled' : 'server',
          ndp: 'disabled',
          ra_slaac: f.addressing === 'dhcpv6' ? '0' : '1',
          ra_flags: f.addressing === 'slaac' ? ['none'] : ['managed-config', 'other-config'],
        },
      });
    }
  }
  return changes;
}

const fmt = (a: { address: string; mask: number } | undefined): string | undefined =>
  a === undefined ? undefined : `${a.address}/${String(a.mask)}`;

/** An address in mono that wraps anywhere, or a dash. */
function Addr({ value, className }: { value: string | undefined; className?: string }): ReactElement {
  return (
    <span className={cn('font-mono break-all', value === undefined ? 'text-muted-foreground' : 'text-foreground', className)}>
      {value ?? '—'}
    </span>
  );
}

/** IPv6 now: the internet side (wan6, live every 10 s), the prefixes, and what devices get as saved. */
function Ipv6Answer({ saved }: { saved: Ipv6Form | undefined }): ReactElement {
  const { data: ifaces, error } = usePoll(getInterfaces, 10_000);
  const wan6 = ifaces?.find((i) => i.interface === 'wan6');
  const lan = ifaces?.find((i) => i.interface === 'lan');
  const addr = fmt(wan6?.['ipv6-address']?.[0]);
  const prefix = fmt(wan6?.['ipv6-prefix']?.[0]);
  const lanPrefix = fmt(lan?.['ipv6-prefix-assignment']?.[0]);
  const dns = wan6?.['dns-server'] ?? [];
  const off = saved?.mode === 'off';

  const state =
    ifaces === undefined ? (
      <span className="text-sm text-muted-foreground">{error === undefined ? 'Reading…' : 'Couldn’t read it'}</span>
    ) : wan6 === undefined ? (
      <Badge variant="outline">Not set up</Badge>
    ) : wan6.up ? (
      <Badge variant="success">Connected</Badge>
    ) : off ? (
      <Badge variant="outline">Off</Badge>
    ) : (
      <Badge variant="destructive">Not connected</Badge>
    );

  return (
    <Answer columns={3} label="IPv6 now">
      <AnswerCell
        title="IPv6 from your provider"
        value={state}
        {...(wan6?.up !== true && !off && ifaces !== undefined
          ? { action: <GoLink href={href('internet')}>Internet connection</GoLink> }
          : {})}
      >
        {wan6?.up === true ? (
          <span className="flex flex-col gap-0.5">
            <span>
              Router <Addr value={addr} className="text-xs" />
            </span>
            <span>
              DNS <Addr value={dns.length > 0 ? dns.join(', ') : undefined} className="text-xs" />
            </span>
          </span>
        ) : off || wan6 === undefined ? (
          'The router doesn’t ask your provider for IPv6. Choose Native or Pass-through below to turn it on.'
        ) : (
          'No answer from your provider yet. Check that your plan includes IPv6, and that the internet connection is up.'
        )}
      </AnswerCell>
      <AnswerCell
        title="Your network’s prefix"
        value={
          lanPrefix === undefined ? (
            <Badge variant="outline">None</Badge>
          ) : prefix === undefined ? (
            <Badge variant="info">Local only</Badge>
          ) : (
            <Badge variant="success">From your provider</Badge>
          )
        }
      >
        {lanPrefix === undefined ? (
          saved?.mode === 'relay' ? (
            'None of its own: with pass-through, devices take addresses from your provider’s network.'
          ) : off ? (
            'None while IPv6 is off.'
          ) : (
            'None yet.'
          )
        ) : (
          <span className="flex flex-col gap-0.5">
            <Addr value={lanPrefix} className="text-xs" />
            <span>
              {prefix === undefined ? (
                'Your provider delegated none, so devices have local addresses only.'
              ) : (
                <>
                  Delegated: <Addr value={prefix} className="text-xs" />
                </>
              )}
            </span>
          </span>
        )}
      </AnswerCell>
      <AnswerCell
        title="Your devices"
        value={
          <span className="text-xl font-semibold tracking-tight">
            {saved === undefined ? '—' : saved.mode === 'native' ? addressing[saved.addressing].label : modes[saved.mode].label}
          </span>
        }
      >
        {saved === undefined
          ? 'Reading the settings…'
          : saved.mode === 'native'
            ? addressing[saved.addressing].hint
            : modes[saved.mode].hint}
      </AnswerCell>
    </Answer>
  );
}

/** "Why?" under a choice that isn't a Field: the mechanism and the UCI options, folded. */
function ChoiceWhy({ lead, why }: { lead: string; why: ReactNode }): ReactElement {
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        {lead}{' '}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => {
            setOpen((o) => !o);
          }}
          className="inline-flex cursor-pointer items-center gap-0.5 rounded-sm font-medium link"
        >
          Why?
          <ChevronDownIcon className={cn('size-3 transition-transform duration-fast', open && 'rotate-180')} />
        </button>
      </p>
      <div id={panel} hidden={!open} className="max-w-prose rounded-md bg-muted px-3 py-2 text-xs text-foreground">
        {why}
      </div>
    </div>
  );
}

export function Ipv6Page(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadIpv6);
  const [edit, setEdit] = useState<Ipv6Form>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data?.form;
  const set = <K extends keyof Ipv6Form>(key: K, value: Ipv6Form[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const ulaError =
    form !== undefined && form.ula !== '' && !/^f[cd][0-9a-f]{2}:[0-9a-f:]+\/(4[89]|5\d|6[0-4])$/i.test(form.ula)
      ? 'A ULA prefix like fd12:3456:789a::/48.'
      : undefined;
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);
  const modeWhy = explain(
    'Native asks your provider for a prefix (DHCPv6-PD) and runs the router’s own IPv6 server for your devices. Pass-through relays your provider’s router adverts, DHCPv6 and neighbour discovery between the WAN and your network instead.',
    ['network.wan6.disabled', 'dhcp.lan.ra', 'dhcp.lan.dhcpv6', 'dhcp.lan.ndp', 'dhcp.wan6'],
  );

  return (
    <>
      <PageHeader title="IPv6" description="IPv6 from your provider, and how devices get their addresses." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <Ipv6Answer saved={data?.form} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <Card>
            <CardHeading
              title="IPv6 settings"
              description="What the router asks your provider for, and what it passes on to your devices."
            />
            <CardContent className="flex flex-col">
              <div className="flex flex-col gap-3 pb-5">
                <ChoiceCards
                  label="IPv6 mode"
                  columns={3}
                  value={form.mode}
                  options={(Object.keys(modes) as Mode[]).map((m) => ({ value: m, label: modes[m].label, hint: modes[m].hint }))}
                  onChange={(m) => {
                    set('mode', m);
                  }}
                />
                <ChoiceWhy lead="What each mode sets up." why={modeWhy.why} />
              </div>
              {form.mode === 'native' && (
                <div className="divide-y border-t">
                  <Field
                    id="v6-addr"
                    label="Device addresses"
                    {...explain(
                      `${addressing[form.addressing].hint} SLAAC: devices make addresses from the router’s adverts; DHCPv6: they ask the router for one.`,
                      ['dhcp.lan.ra_slaac', 'dhcp.lan.dhcpv6', 'dhcp.lan.ra_flags'],
                    )}
                  >
                    <Select
                      value={form.addressing}
                      onValueChange={(v) => {
                        set('addressing', v as Addressing);
                      }}
                    >
                      <SelectTrigger id="v6-addr">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(addressing).map(([k, a]) => (
                          <SelectItem key={k} value={k}>
                            {a.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              )}
              {form.mode !== 'off' && (
                <MoreSettings summary={form.ula === '' ? 'Local prefix: none' : `Local prefix ${form.ula}`}>
                  <Field
                    id="v6-ula"
                    label="Local prefix (ULA)"
                    {...explain(
                      "Private IPv6 addresses that keep working if your provider's prefix changes. They work only inside your network.",
                      ['network.globals.ula_prefix'],
                    )}
                    error={ulaError}
                  >
                    <Input
                      id="v6-ula"
                      className="font-mono"
                      value={form.ula}
                      aria-invalid={ulaError !== undefined}
                      onChange={(e) => {
                        set('ula', e.target.value.trim());
                      }}
                    />
                  </Field>
                </MoreSettings>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={ulaError !== undefined}
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
