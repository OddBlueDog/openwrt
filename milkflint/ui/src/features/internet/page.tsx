// The Internet page: the connection as it is now first (online or not, the
// address, how long, the DNS servers the provider gave), live from netifd
// every 5 s, then how the router connects: the everyday settings, and the
// provider-specific ones (client ID, VLAN) under More settings.
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
import { getInterfaces, ipv4 } from '@/lib/api/network';
import { bool, getConfig, list, str } from '@/lib/api/uci';
import { formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { internetQueue } from '../sqm/model';
import { explain } from '@/components/explain';
import { type ClientIdMode, hexToText, textToHex } from './client-id';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { clientIdForm, type InternetForm, sqmQueueTo, toChanges, validate, wanPort } from './model';

async function loadInternet(): Promise<InternetForm> {
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

/** Why a PPPoE connection is down, from the code OpenWrt's ppp script reports. */
const PPP_ERRORS: Record<string, string> = {
  AUTH_TOPEER_FAILED: 'Your provider refused the username or password.',
  CONNECT_FAILED: 'No PPPoE server answered. Check the WAN cable, and whether your provider needs a VLAN ID.',
  PEER_AUTH_FAILED: 'Your provider’s server didn’t prove who it is.',
  NEGOTIATION_FAILED: 'Your provider answered, but the connection settings couldn’t be agreed.',
  PEER_DEAD: 'Your provider stopped answering.',
  HANGUP: 'Your provider ended the connection.',
};

const protoLabels: Record<string, string> = {
  dhcp: 'Automatic (DHCP)',
  pppoe: 'PPPoE',
  static: 'Static IP',
};

/** A value in mono that wraps anywhere, for addresses in a sentence. */
function Mono({ children }: { children: string }): ReactElement {
  return <span className="font-mono text-xs break-all text-foreground">{children}</span>;
}

/** The connection now, live from the WAN port: online or not, its address, how long, its DNS servers. */
function InternetAnswer({ proto }: { proto: string | undefined }): ReactElement {
  const { data, error } = usePoll(getInterfaces, 5000);
  const wan = data?.find((i) => i.interface === 'wan');
  // pppd keeps looking for a server without reporting anything, and a stop
  // (USER_REQUEST) leaves its code behind: neither says what's wrong
  const code = wan?.up === true || proto !== 'pppoe' ? undefined : wan?.errors?.[0]?.code;
  const reason =
    code !== undefined && code !== 'USER_REQUEST' ? (PPP_ERRORS[code] ?? `The connection failed (${code}).`) : undefined;
  const trying = proto === 'pppoe' && wan?.up !== true && wan?.pending === true && reason === undefined;
  const wan6 = data?.find((i) => i.interface === 'wan6');
  const gateway = wan?.route?.find((r) => r.target === '0.0.0.0')?.nexthop;
  const v6 = wan6?.['ipv6-address']?.[0] ?? wan6?.['ipv6-prefix-assignment']?.[0];
  const address = ipv4(wan);
  const dns = wan?.['dns-server'] ?? [];
  const up = wan?.up === true;
  const reading = data === undefined;

  const state = reading ? (
    <span className="text-sm text-muted-foreground">{error === undefined ? 'Reading…' : 'Couldn’t read it'}</span>
  ) : up ? (
    <Badge variant="success">Online</Badge>
  ) : trying ? (
    <Badge variant="warning">Connecting…</Badge>
  ) : (
    <Badge variant="destructive">Not connected</Badge>
  );
  const stateText = reading
    ? error === undefined
      ? 'From the WAN port.'
      : 'The router didn’t answer; it tries again in a few seconds.'
    : up
      ? `${proto === undefined ? 'Connected' : (protoLabels[proto] ?? proto)}, through the WAN port.`
      : (reason ??
        (trying
          ? 'If it stays like this, check the WAN cable, and whether your provider needs a VLAN ID (More settings, below).'
          : 'Check the WAN cable, and the connection settings below.'));

  return (
    <Answer columns={4} label="The connection now">
      <AnswerCell title="Connection" value={state}>
        <span className={cn(reason !== undefined && 'text-foreground')}>{stateText}</span>
      </AnswerCell>
      <AnswerCell title="Address" value={<Figure>{address ?? '—'}</Figure>}>
        {address === undefined ? (
          'None from your provider yet.'
        ) : (
          <span className="flex flex-col gap-0.5">
            <span>Gateway {gateway === undefined ? '—' : <Mono>{gateway}</Mono>}</span>
            <span>IPv6 {v6 === undefined ? 'none' : <Mono>{`${v6.address}/${String(v6.mask)}`}</Mono>}</span>
          </span>
        )}
      </AnswerCell>
      <AnswerCell
        title="Connected for"
        value={<Figure>{up && wan.uptime !== undefined ? formatDuration(wan.uptime) : '—'}</Figure>}
      >
        {up ? 'Since the connection last came up.' : 'Not connected now.'}
      </AnswerCell>
      <AnswerCell
        title="DNS servers"
        value={<Figure>{dns.length === 0 ? '—' : `${String(dns.length)} ${dns.length === 1 ? 'server' : 'servers'}`}</Figure>}
        action={<GoLink href={href('dns')}>DNS settings</GoLink>}
      >
        <span className="flex flex-col gap-0.5">
          {dns.length > 0 && <Mono>{dns.join(', ')}</Mono>}
          <span>
            {proto === 'static'
              ? 'Your provider’s, as set below.'
              : 'Your provider’s. The router uses them unless the DNS page chooses others.'}
          </span>
        </span>
      </AnswerCell>
    </Answer>
  );
}

export function InternetPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadInternet);
  const [edit, setEdit] = useState<InternetForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data;
  const errors = form === undefined ? {} : validate(form);
  // Smart Queue's queue going to or from PPPoE's session with the change
  const queueTo = form === undefined || data === undefined ? undefined : sqmQueueTo(form, data);
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof InternetForm>(key: K, value: InternetForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);
  // switch how the client ID is typed, keeping the same bytes
  const setClientIdMode = (mode: ClientIdMode): void => {
    setEdit((current) => {
      const base = current ?? data;
      if (base === undefined || base.clientIdMode === mode) return base;
      const value = mode === 'hex' ? textToHex(base.clientId) : (hexToText(base.clientId) ?? base.clientId);
      return { ...base, clientIdMode: mode, clientId: value };
    });
  };

  return (
    <>
      <PageHeader title="Internet" description="How the router connects to your internet provider." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <InternetAnswer proto={data?.proto} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined ? (
          <FormSkeleton />
        ) : (
          <Card>
            <CardHeading title="Connection settings" description="Most fibre and cable connections use Automatic." />
            <CardContent className="flex flex-col">
              <div className="divide-y border-t">
                <Field
                  id="proto"
                  label="Connection type"
                  {...explain(
                    queueTo === undefined
                      ? 'PPPoE when your provider gave you a username and password.'
                      : `Smart Queue moves to ${queueTo} with it, where CAKE can read your traffic.`,
                    ['network.wan.proto'],
                  )}
                >
                  <Select
                    value={form.proto}
                    onValueChange={(v) => {
                      set('proto', v);
                    }}
                  >
                    <SelectTrigger id="proto">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dhcp">Automatic (DHCP)</SelectItem>
                      <SelectItem value="pppoe">PPPoE (username and password)</SelectItem>
                      <SelectItem value="static">Static IP</SelectItem>
                      {!['dhcp', 'pppoe', 'static'].includes(form.proto) && (
                        <SelectItem value={form.proto}>{form.proto} (set in LuCI)</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
                {form.proto === 'pppoe' && (
                  <>
                    <Field
                      id="username"
                      label="Username"
                      {...explain('From your provider, with the password.', ['network.wan.username', 'network.wan.password'])}
                      error={errors.username}
                    >
                      <Input
                        id="username"
                        autoComplete="off"
                        value={form.username}
                        aria-invalid={errors.username !== undefined}
                        onChange={(e) => {
                          set('username', e.target.value);
                        }}
                      />
                    </Field>
                    <Field id="password" label="Password">
                      <Input
                        id="password"
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={(e) => {
                          set('password', e.target.value);
                        }}
                      />
                    </Field>
                  </>
                )}
                {form.proto === 'static' &&
                  (['ipaddr', 'netmask', 'gateway'] as const).map((key) => (
                    <Field
                      key={key}
                      id={key}
                      label={key === 'ipaddr' ? 'IP address' : key === 'netmask' ? 'Netmask' : 'Gateway'}
                      {...(key === 'ipaddr'
                        ? explain('The fixed address, netmask and gateway your provider gave you.', [
                            'network.wan.ipaddr',
                            'network.wan.netmask',
                            'network.wan.gateway',
                          ])
                        : {})}
                      error={errors[key]}
                    >
                      <Input
                        id={key}
                        className="font-mono"
                        value={form[key]}
                        aria-invalid={errors[key] !== undefined}
                        onChange={(e) => {
                          set(key, e.target.value.trim());
                        }}
                      />
                    </Field>
                  ))}
                {form.proto === 'static' && (
                  <Field
                    id="staticDns"
                    label="DNS servers"
                    hint="Your provider’s."
                    status={
                      <>
                        To use others, see{' '}
                        <a href={href('dns')} className="font-medium text-foreground underline underline-offset-2">
                          DNS
                        </a>
                        .
                      </>
                    }
                    why={explain('', ['network.wan.dns', 'network.wan.peerdns']).why}
                    error={errors.staticDns}
                  >
                    <Input
                      id="staticDns"
                      className="font-mono"
                      placeholder="203.0.113.53, 203.0.113.54"
                      value={form.staticDns}
                      aria-invalid={errors.staticDns !== undefined}
                      onChange={(e) => {
                        set('staticDns', e.target.value);
                      }}
                    />
                  </Field>
                )}
                <Field
                  id="ipv6"
                  label="IPv6"
                  {...explain(
                    'Gets IPv6 from your provider automatically when it offers it.',
                    form.proto === 'pppoe' ? ['network.wan6.disabled', 'network.wan.ipv6'] : ['network.wan6.disabled'],
                    <p>
                      How your devices get IPv6 addresses is on the{' '}
                      <a href={href('ipv6')} className="font-medium underline underline-offset-2">
                        IPv6 page
                      </a>
                      .
                    </p>,
                  )}
                >
                  <Switch
                    id="ipv6"
                    checked={form.ipv6}
                    onCheckedChange={(v) => {
                      set('ipv6', v);
                    }}
                  />
                </Field>
                {/* every setting shown: the client ID and VLAN are rarely needed, but when they are, they're the ones to find */}
                {form.proto === 'dhcp' && (
                  <Field
                    id="clientid"
                    label="Provider’s client ID (option 61)"
                    {...explain(
                      'Only if your provider asks for one, as Sky does; leave it empty otherwise. DHCP option 61: the router sends it when it asks your provider for an address. Sky’s looks like username@skydsl|password. Type it as text or as hex: OpenWrt keeps it as hex.',
                      ['network.wan.clientid'],
                    )}
                    error={errors.clientId}
                  >
                    <div className="flex gap-2">
                      <Input
                        id="clientid"
                        className={cn('min-w-0', form.clientIdMode === 'hex' && 'font-mono')}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={form.clientIdMode === 'text' ? 'aabbcc123456@skydsl|aabbccdd' : '61:62:63'}
                        value={form.clientId}
                        aria-invalid={errors.clientId !== undefined}
                        onChange={(e) => {
                          set('clientId', e.target.value);
                        }}
                      />
                      <div
                        role="group"
                        aria-label="Client ID format"
                        className="inline-flex shrink-0 gap-0.5 rounded-md border p-0.5"
                      >
                        {(['text', 'hex'] as const).map((mode) => (
                          <Button
                            key={mode}
                            type="button"
                            size="sm"
                            variant={form.clientIdMode === mode ? 'secondary' : 'ghost'}
                            className="h-7 px-2.5"
                            aria-pressed={form.clientIdMode === mode}
                            // hex that isn't printable can't be shown as text
                            disabled={
                              mode === 'text' &&
                              form.clientIdMode === 'hex' &&
                              form.clientId !== '' &&
                              hexToText(form.clientId) === undefined
                            }
                            onClick={() => {
                              setClientIdMode(mode);
                            }}
                          >
                            {mode === 'text' ? 'Text' : 'Hex'}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </Field>
                )}
                <Field
                  id="vlan"
                  label="VLAN ID"
                  {...explain(
                    'Only if your provider asks for one, e.g. 911 or 101; leave it empty otherwise. The connection then runs on an 802.1q VLAN device on the WAN port, which wan (and wan6) use instead of the port itself.',
                    ['network.wan.device', `network.${data?.vlanSection ?? 'wan_vlan'}.vid`],
                  )}
                  error={errors.vlan}
                >
                  <Input
                    id="vlan"
                    className="max-w-32 tabular"
                    inputMode="numeric"
                    placeholder="None"
                    value={form.vlan}
                    aria-invalid={errors.vlan !== undefined}
                    onChange={(e) => {
                      set('vlan', e.target.value.trim());
                    }}
                  />
                </Field>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
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
