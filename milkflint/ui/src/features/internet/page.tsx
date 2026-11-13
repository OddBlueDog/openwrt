import { ArrowDownUpIcon, GlobeIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getInterfaces, ipv4 } from '@/lib/api/network';
import { bool, getConfig, list, str } from '@/lib/api/uci';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { internetQueue } from '../sqm/model';
import { type ClientIdMode, hexToText, textToHex } from './client-id';
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

function StatusCard({ proto }: { proto: string }): ReactElement {
  const { data } = usePoll(getInterfaces, 5000);
  const wan = data?.find((i) => i.interface === 'wan');
  // pppd keeps looking for a server without reporting anything, and a stop
  // (USER_REQUEST) leaves its code behind: neither says what's wrong
  const code = wan?.up === true || proto !== 'pppoe' ? undefined : wan?.errors?.[0]?.code;
  const reason = code !== undefined && code !== 'USER_REQUEST' ? (PPP_ERRORS[code] ?? `The connection failed (${code}).`) : undefined;
  const trying = proto === 'pppoe' && wan?.up !== true && wan?.pending === true && reason === undefined;
  const wan6 = data?.find((i) => i.interface === 'wan6');
  const gateway = wan?.route?.find((r) => r.target === '0.0.0.0')?.nexthop;
  const v6 = wan6?.['ipv6-address']?.[0] ?? wan6?.['ipv6-prefix-assignment']?.[0];

  const rows: [string, readonly string[] | string | undefined][] = [
    ['IPv4 address', ipv4(wan)],
    ['Gateway', gateway],
    ['DNS servers', wan?.['dns-server']],
    ['IPv6', v6 === undefined ? undefined : `${v6.address}/${String(v6.mask)}`],
    ['Connected for', wan?.uptime === undefined ? undefined : formatDuration(wan.uptime)],
  ];
  return (
    <Card>
      <CardHeader className="items-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <GlobeIcon className="size-4" />
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">Status</CardTitle>
          <CardDescription>Live, from the WAN port</CardDescription>
        </div>
        <Badge variant={wan?.up === true ? 'success' : 'destructive'} className="ml-auto">
          {wan?.up === true ? 'Connected' : 'Not connected'}
        </Badge>
      </CardHeader>
      <CardContent className="divide-y">
        {reason !== undefined && <p className="pb-3 text-sm text-destructive">{reason}</p>}
        {trying && (
          <p className="pb-3 text-sm text-muted-foreground">
            Connecting… If it stays like this, check the WAN cable, and whether your provider needs a VLAN ID.
          </p>
        )}
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 py-2 text-sm">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 text-right font-mono text-xs break-all">
              {value === undefined || value.length === 0
                ? '—'
                : (typeof value === 'string' ? [value] : value).map((v) => (
                    <span key={v} className="block">
                      {v}
                    </span>
                  ))}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
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
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[1fr_22rem]">
            <Card>
              <CardHeader className="items-center">
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ArrowDownUpIcon className="size-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <CardTitle className="text-base">Connection</CardTitle>
                  <CardDescription>Most fibre and cable connections use Automatic.</CardDescription>
                </div>
              </CardHeader>
              <CardContent className="divide-y">
                <Field
                  id="proto"
                  label="Connection type"
                  hint={queueTo === undefined ? undefined : `Smart Queue moves to ${queueTo} with it, where CAKE can read your traffic.`}
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
                    <Field id="username" label="Username" error={errors.username}>
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
                {form.proto === 'dhcp' && (
                  <Field
                    id="clientid"
                    label="Client ID (option 61)"
                    hint={
                      <>
                        Only if your provider asks for it, e.g. Sky: <span className="font-mono">username@skydsl|password</span>. Leave
                        it empty otherwise.
                      </>
                    }
                    error={errors.clientId}
                  >
                    <div className="flex gap-2">
                      <Input
                        id="clientid"
                        className={cn(form.clientIdMode === 'hex' && 'font-mono')}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={form.clientIdMode === 'text' ? 'aabbcc123456@skydsl|aabbccdd' : '61:62:63'}
                        value={form.clientId}
                        aria-invalid={errors.clientId !== undefined}
                        onChange={(e) => {
                          set('clientId', e.target.value);
                        }}
                      />
                      <div role="group" aria-label="Client ID format" className="inline-flex shrink-0 gap-0.5 rounded-md border p-0.5">
                        {(['text', 'hex'] as const).map((mode) => (
                          <Button
                            key={mode}
                            type="button"
                            size="sm"
                            variant={form.clientIdMode === mode ? 'secondary' : 'ghost'}
                            className="h-7 px-2.5"
                            aria-pressed={form.clientIdMode === mode}
                            // hex that isn't printable can't be shown as text
                            disabled={mode === 'text' && form.clientIdMode === 'hex' && form.clientId !== '' && hexToText(form.clientId) === undefined}
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
                  hint="Only if your provider asks for one, e.g. 911 or 101. Leave it empty otherwise."
                  error={errors.vlan}
                >
                  <Input
                    id="vlan"
                    className="max-w-32 font-mono"
                    inputMode="numeric"
                    placeholder="None"
                    value={form.vlan}
                    aria-invalid={errors.vlan !== undefined}
                    onChange={(e) => {
                      set('vlan', e.target.value.trim());
                    }}
                  />
                </Field>
                {form.proto === 'static' ? (
                  <Field
                    id="staticDns"
                    label="DNS servers"
                    hint={
                      <>
                        Your provider&apos;s. To use others, see <a href="#/dns" className="underline underline-offset-2">DNS</a>.
                      </>
                    }
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
                ) : (
                  <p className="py-3 text-sm text-muted-foreground">
                    DNS servers come from your provider, unless you choose others on the{' '}
                    <a href="#/dns" className="text-foreground underline underline-offset-2">
                      DNS page
                    </a>
                    .
                  </p>
                )}
                <Field id="ipv6" label="IPv6" hint="Gets IPv6 from your provider automatically when it offers it.">
                  <Switch
                    id="ipv6"
                    checked={form.ipv6}
                    onCheckedChange={(v) => {
                      set('ipv6', v);
                    }}
                  />
                </Field>
              </CardContent>
            </Card>
            <StatusCard proto={data?.proto ?? form.proto} />
          </div>
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
