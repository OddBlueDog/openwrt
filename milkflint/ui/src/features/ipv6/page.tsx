import { Globe2Icon, NetworkIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading, InfoRow } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getInterfaces } from '@/lib/api/network';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';

const modes = {
  native: { label: 'Native', hint: 'Your provider delegates a prefix; the router gives each device its own IPv6 address.' },
  relay: { label: 'Pass-through', hint: "Relays your provider's IPv6 straight to devices. For providers that don't delegate a prefix." },
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
        : { op: 'add', config: 'dhcp', type: 'dhcp', name: 'wan6', values: { ...relay, interface: 'wan6', master: '1', ignore: '1' } },
    );
    changes.push({ op: 'set', config: 'dhcp', section: 'lan', values: relay });
  } else {
    if (data.dhcpWan6Exists) changes.push({ op: 'delete', config: 'dhcp', section: 'wan6' });
    if (f.mode === 'off') {
      changes.push({ op: 'set', config: 'dhcp', section: 'lan', values: { ra: 'disabled', dhcpv6: 'disabled', ndp: 'disabled' } });
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

function Status(): ReactElement {
  const ifaces = usePoll(getInterfaces, 10_000).data;
  const wan6 = ifaces?.find((i) => i.interface === 'wan6');
  const lan = ifaces?.find((i) => i.interface === 'lan');
  const addr = wan6?.['ipv6-address']?.[0];
  const prefix = wan6?.['ipv6-prefix']?.[0];
  const lanPrefix = lan?.['ipv6-prefix-assignment']?.[0];
  const dns = wan6?.['dns-server'] ?? [];
  const fmt = (a: { address: string; mask: number } | undefined): string => (a === undefined ? '—' : `${a.address}/${String(a.mask)}`);
  return (
    <Card>
      <CardHeading icon={NetworkIcon} title="Status" description="Live" />
      <CardContent className="divide-y">
        <InfoRow label="Internet (wan6)">{wan6 === undefined ? 'not configured' : wan6.up ? 'connected' : 'not connected'}</InfoRow>
        <InfoRow label="Router's address">{fmt(addr)}</InfoRow>
        <InfoRow label="Delegated prefix">{fmt(prefix)}</InfoRow>
        <InfoRow label="LAN prefix">{fmt(lanPrefix)}</InfoRow>
        <InfoRow label="DNS servers">{dns.length > 0 ? dns.join(', ') : '—'}</InfoRow>
      </CardContent>
    </Card>
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
  const ulaError = form !== undefined && form.ula !== '' && !/^f[cd][0-9a-f]{2}:[0-9a-f:]+\/(4[89]|5\d|6[0-4])$/i.test(form.ula) ? 'A ULA prefix like fd12:3456:789a::/48.' : undefined;
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);

  return (
    <>
      <PageHeader title="IPv6" description="IPv6 from your provider, and how devices get their addresses." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[1fr_24rem]">
            <Card>
              <CardHeading icon={Globe2Icon} title="IPv6" description={modes[form.mode].hint} />
              <CardContent className="divide-y">
                <Field id="v6-mode" label="Mode">
                  <Select
                    value={form.mode}
                    onValueChange={(v) => {
                      set('mode', v as Mode);
                    }}
                  >
                    <SelectTrigger id="v6-mode">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(modes).map(([k, m]) => (
                        <SelectItem key={k} value={k}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                {form.mode === 'native' && (
                  <Field id="v6-addr" label="Device addresses" hint={addressing[form.addressing].hint}>
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
                )}
                {form.mode !== 'off' && (
                  <Field id="v6-ula" label="Local prefix (ULA)" hint="Private IPv6 addresses that keep working if your provider's prefix changes." error={ulaError}>
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
                )}
              </CardContent>
            </Card>
            <Status />
          </div>
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
