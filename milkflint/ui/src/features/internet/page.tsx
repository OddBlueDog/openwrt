// The Internet page: the connection as it is now first (online or not, the
// address, how long, the DNS servers the provider gave), live from netifd
// every 5 s, then how the router connects: the everyday settings, and the
// provider-specific ones (client ID, VLAN) under More settings.
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { FormField, FormSaveBar, SelectField, SwitchField, TextField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { PageBoundary } from '@/components/page-boundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { ipv4, wanInterfaces, wanIpv6 } from '@/lib/api/network';
import { formatDuration } from '@/lib/format';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { explain } from '@/components/explain';
import { type ClientIdMode, hexToText, textToHex } from './client-id';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { internetFormSchema, sqmQueueTo, toChanges } from './model';
import { internetQueries } from './queries';

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
  const { data, error } = useLive(internetQueries.interfaces());
  const wan = data?.find((i) => i.interface === 'wan');
  // pppd keeps looking for a server without reporting anything, and a stop
  // (USER_REQUEST) leaves its code behind: neither says what's wrong
  const code = wan?.up === true || proto !== 'pppoe' ? undefined : wan?.errors?.[0]?.code;
  const reason =
    code !== undefined && code !== 'USER_REQUEST' ? (PPP_ERRORS[code] ?? `The connection failed (${code}).`) : undefined;
  const trying = proto === 'pppoe' && wan?.up !== true && wan?.pending === true && reason === undefined;
  const gateway = wan?.route?.find((r) => r.target === '0.0.0.0')?.nexthop;
  // many providers give the router no IPv6 address of its own, only a range for the devices
  const v6 = wanIpv6(wanInterfaces(data ?? []));
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
        <span className="flex flex-col gap-0.5">
          {address === undefined ? (
            <span>No IPv4 address from your provider yet.</span>
          ) : (
            <span>Gateway {gateway === undefined ? '—' : <Mono>{gateway}</Mono>}</span>
          )}
          {v6.address !== undefined && (
            <span>
              IPv6 <Mono>{v6.address}</Mono>
            </span>
          )}
          {v6.range !== undefined && (
            <span>
              IPv6 range <Mono>{v6.range}</Mono>
            </span>
          )}
          {v6.address === undefined && v6.range === undefined && address !== undefined && <span>IPv6 none</span>}
        </span>
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
        action={<GoLink to={pageLink('dns')}>DNS settings</GoLink>}
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
  return (
    <>
      <PageHeader title="Internet" description="How the router connects to your internet provider." />
      <PageBoundary>
        <InternetBody />
      </PageBoundary>
    </>
  );
}

function InternetBody(): ReactElement {
  const { data } = useSuspenseQuery(internetQueries.settings());
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: internetFormSchema,
    saved: data,
    onSave: (values) => apply(toChanges(values, data)),
  });
  const { form } = settings;
  const values = useFormValues(form);
  // Smart Queue's queue going to or from PPPoE's session with the change
  const queueTo = sqmQueueTo(values, data);
  // switch how the client ID is typed, keeping the same bytes
  const setClientIdMode = (mode: ClientIdMode): void => {
    if (values.clientIdMode === mode) return;
    const value = mode === 'hex' ? textToHex(values.clientId) : (hexToText(values.clientId) ?? values.clientId);
    form.setFieldValue('clientIdMode', mode);
    form.setFieldValue('clientId', value);
  };
  const protoOptions = [
    { value: 'dhcp', label: 'Automatic (DHCP)' },
    { value: 'pppoe', label: 'PPPoE (username and password)' },
    { value: 'static', label: 'Static IP' },
    ...(['dhcp', 'pppoe', 'static'].includes(values.proto)
      ? []
      : [{ value: values.proto, label: `${values.proto} (set in LuCI)` }]),
  ];

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <InternetAnswer proto={data.proto} />
        <Card>
          <CardHeading title="Connection settings" description="Most fibre and cable connections use Automatic." />
          <CardContent className="flex flex-col">
            <div className="divide-y border-t">
              <form.Field name="proto">
                {(field) => (
                  <SelectField
                    field={field}
                    id="proto"
                    label="Connection type"
                    {...explain(
                      queueTo === undefined
                        ? 'PPPoE when your provider gave you a username and password.'
                        : `Smart Queue moves to ${queueTo} with it, where CAKE can read your traffic.`,
                      ['network.wan.proto'],
                    )}
                    options={protoOptions}
                  />
                )}
              </form.Field>
              {values.proto === 'pppoe' && (
                <>
                  <form.Field name="username">
                    {(field) => (
                      <TextField
                        field={field}
                        id="username"
                        label="Username"
                        {...explain('From your provider, with the password.', ['network.wan.username', 'network.wan.password'])}
                        autoComplete="off"
                      />
                    )}
                  </form.Field>
                  <form.Field name="password">
                    {(field) => (
                      <TextField field={field} id="password" label="Password" type="password" autoComplete="new-password" />
                    )}
                  </form.Field>
                </>
              )}
              {values.proto === 'static' &&
                (['ipaddr', 'netmask', 'gateway'] as const).map((key) => (
                  <form.Field key={key} name={key}>
                    {(field) => (
                      <TextField
                        field={field}
                        id={key}
                        label={key === 'ipaddr' ? 'IP address' : key === 'netmask' ? 'Netmask' : 'Gateway'}
                        {...(key === 'ipaddr'
                          ? explain('The fixed address, netmask and gateway your provider gave you.', [
                              'network.wan.ipaddr',
                              'network.wan.netmask',
                              'network.wan.gateway',
                            ])
                          : {})}
                        className="font-mono"
                        trim
                      />
                    )}
                  </form.Field>
                ))}
              {values.proto === 'static' && (
                <form.Field name="staticDns">
                  {(field) => (
                    <TextField
                      field={field}
                      id="staticDns"
                      label="DNS servers"
                      hint="Your provider’s."
                      status={
                        <>
                          To use others, see{' '}
                          <Link {...pageLink('dns')} className="font-medium text-foreground underline underline-offset-2">
                            DNS
                          </Link>
                          .
                        </>
                      }
                      why={explain('', ['network.wan.dns', 'network.wan.peerdns']).why}
                      className="font-mono"
                      placeholder="203.0.113.53, 203.0.113.54"
                    />
                  )}
                </form.Field>
              )}
              <form.Field name="ipv6">
                {(field) => (
                  <SwitchField
                    field={field}
                    id="ipv6"
                    label="IPv6"
                    {...explain(
                      'Gets IPv6 from your provider automatically when it offers it.',
                      values.proto === 'pppoe' ? ['network.wan6.disabled', 'network.wan.ipv6'] : ['network.wan6.disabled'],
                      <p>
                        How your devices get IPv6 addresses is on the{' '}
                        <Link {...pageLink('ipv6')} className="font-medium underline underline-offset-2">
                          IPv6 page
                        </Link>
                        .
                      </p>,
                    )}
                  />
                )}
              </form.Field>
              {/* every setting shown: the client ID and VLAN are rarely needed, but when they are, they're the ones to find */}
              {values.proto === 'dhcp' && (
                <form.Field name="clientId">
                  {(field) => (
                    <FormField
                      field={field}
                      id="clientid"
                      label="Provider’s client ID (option 61)"
                      {...explain(
                        'Only if your provider asks for one, as Sky does; leave it empty otherwise. DHCP option 61: the router sends it when it asks your provider for an address. Sky’s looks like username@skydsl|password. Type it as text or as hex: OpenWrt keeps it as hex.',
                        ['network.wan.clientid'],
                      )}
                    >
                      {(control) => (
                        <div className="flex gap-2">
                          <Input
                            {...control}
                            className={cn('min-w-0', values.clientIdMode === 'hex' && 'font-mono')}
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={values.clientIdMode === 'text' ? 'aabbcc123456@skydsl|aabbccdd' : '61:62:63'}
                            value={field.state.value}
                            onChange={(e) => {
                              field.handleChange(e.target.value);
                            }}
                            onBlur={field.handleBlur}
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
                                variant={values.clientIdMode === mode ? 'secondary' : 'ghost'}
                                className="h-7 px-2.5"
                                aria-pressed={values.clientIdMode === mode}
                                // hex that isn't printable can't be shown as text
                                disabled={
                                  mode === 'text' &&
                                  values.clientIdMode === 'hex' &&
                                  values.clientId !== '' &&
                                  hexToText(values.clientId) === undefined
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
                      )}
                    </FormField>
                  )}
                </form.Field>
              )}
              <form.Field name="vlan">
                {(field) => (
                  <TextField
                    field={field}
                    id="vlan"
                    label="VLAN ID"
                    {...explain(
                      'Only if your provider asks for one, e.g. 911 or 101; leave it empty otherwise. The connection then runs on an 802.1q VLAN device on the WAN port, which wan (and wan6) use instead of the port itself.',
                      ['network.wan.device', `network.${data.vlanSection ?? 'wan_vlan'}.vid`],
                    )}
                    className="max-w-32 tabular"
                    inputMode="numeric"
                    placeholder="None"
                    trim
                  />
                )}
              </form.Field>
            </div>
          </CardContent>
        </Card>
      </div>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
