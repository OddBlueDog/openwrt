import {
  ActivityIcon,
  EyeIcon,
  EyeOffIcon,
  FileUpIcon,
  PlusIcon,
  RouteIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, useCallback, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getWgStatus, isConnected, parseConf, renewInterface, type WgInterface } from '@/lib/api/wireguard';
import { formatBytes, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { isMac } from '../firewall/model';
import { AppliedCard, CheckItem, NoWireGuard } from '../remote-access/parts';
import { loadClient } from './api';
import { type ClientForm, describe, type Device, drift, type Errors, fromConf, removal, serverText, summary, toChanges, TUNNEL_SHARE, validate, type Who } from './model';
import { CLIENT, CLIENT_TABLE } from './sections';

function ImportDialog({ open, onClose, onUse }: { open: boolean; onClose: () => void; onUse: (text: string) => string | undefined }): ReactElement {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const use = (t: string): void => {
    const err = onUse(t);
    setError(err);
    if (err === undefined) {
      setText('');
      onClose();
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use a provider’s WireGuard config</DialogTitle>
          <DialogDescription>
            From your VPN provider’s website (Mullvad, Proton VPN, IVPN, AzireVPN and others make them): pick a server, download its WireGuard file for a router or Linux, and
            open or paste it here. Its keys stay on this router.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          rows={10}
          spellCheck={false}
          placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …'}
          aria-label="The WireGuard config"
          aria-invalid={error !== undefined}
          className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 aria-invalid:border-destructive"
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <label className="mr-auto inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-accent">
            <FileUpIcon className="size-4" />
            Open a .conf file
            <input
              type="file"
              accept=".conf,text/plain"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file !== undefined) void file.text().then(use);
                e.target.value = '';
              }}
            />
          </label>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={text.trim() === ''}
            onClick={() => {
              use(text);
            }}
          >
            Use it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyInput({ id, value, error, onChange }: { id: string; value: string; error: string | undefined; onChange: (v: string) => void }): ReactElement {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? 'text' : 'password'}
        autoComplete="off"
        value={value}
        className="pr-10 font-mono text-xs"
        aria-invalid={error !== undefined}
        onChange={(e) => {
          onChange(e.target.value.trim());
        }}
      />
      <button
        type="button"
        onClick={() => {
          setShow((v) => !v);
        }}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label={show ? 'Hide the key' : 'Show the key'}
      >
        {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

function DevicePicker({ macs, devices, error, onChange }: { macs: string[]; devices: readonly Device[]; error: string | undefined; onChange: (m: string[]) => void }): ReactElement {
  const [typed, setTyped] = useState('');
  const known = new Map(devices.map((d) => [d.mac, d]));
  const add = (mac: string): void => {
    const m = mac.trim().toLowerCase().replace(/-/g, ':');
    if (m !== '' && !macs.includes(m)) onChange([...macs, m]);
  };
  return (
    <div className="flex flex-col gap-2">
      {macs.length > 0 && (
        <ul className="flex flex-col divide-y rounded-md border">
          {macs.map((m) => {
            const d = known.get(m);
            return (
              <li key={m} className="flex items-center gap-2 px-3 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{d?.name ?? 'Unknown device'}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{[m, d?.ip].filter((x) => x !== undefined).join(' · ')}</div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Take ${d?.name ?? m} off the list`}
                  onClick={() => {
                    onChange(macs.filter((x) => x !== m));
                  }}
                >
                  <XIcon />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <SearchSelect
        id="vpn-device"
        options={devices.filter((d) => !macs.includes(d.mac)).map((d) => ({ value: d.mac, label: d.name ?? d.mac, keywords: `${d.mac} ${d.ip ?? ''}` }))}
        value=""
        placeholder="Add a device the router knows…"
        onChange={add}
      />
      <div className="flex gap-2">
        <Input
          value={typed}
          placeholder="or its MAC address"
          className="font-mono"
          aria-label="A device’s MAC address"
          onChange={(e) => {
            setTyped(e.target.value);
          }}
        />
        <Button
          variant="outline"
          disabled={!isMac(typed.trim().replace(/-/g, ':'))}
          onClick={() => {
            add(typed);
            setTyped('');
          }}
        >
          <PlusIcon />
          Add
        </Button>
      </div>
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

const whoOptions: { value: Who; label: string; hint: string }[] = [
  { value: 'all', label: 'Every home device', hint: 'Everything on your home network goes through the VPN.' },
  { value: 'only', label: 'Only these', hint: 'Only the devices listed go through the VPN.' },
  { value: 'except', label: 'All but these', hint: 'Everything on your home network but the devices listed: a games console, a work laptop, a TV app that blocks VPNs.' },
  { value: 'none', label: 'No home devices', hint: 'Only the guest networks ticked below go through it.' },
];

function connectionState(form: ClientForm, running: WgInterface | undefined, now: number): { tone: 'ok' | 'warn' | 'off'; text: string } {
  if (!form.enabled) return { tone: 'off', text: 'Off: every device goes out directly.' };
  const peer = running?.peers[0];
  if (running === undefined || peer === undefined) return { tone: 'warn', text: 'The tunnel isn’t up. Check the server’s address: the router has to find it first.' };
  const data = ` · ↓ ${formatBytes(peer.rx_bytes)} ↑ ${formatBytes(peer.tx_bytes)}`;
  if (isConnected(peer, now)) return { tone: 'ok', text: `Connected to ${peer.endpoint ?? serverText(form)}, last handshake ${formatDuration(now - peer.latest_handshake)} ago${data}` };
  if (peer.latest_handshake === 0) return { tone: 'warn', text: 'No answer from the server yet. Check the keys and the server’s address and port.' };
  return {
    tone: 'warn',
    text: `No answer from the server for ${formatDuration(now - peer.latest_handshake)}${form.killSwitch ? ': with the kill switch, its devices have no internet.' : '.'}`,
  };
}

export function VpnClientPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadClient);
  const [edit, setEdit] = useState<ClientForm>();
  const [applied, setApplied] = useState<string[]>();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const renew = useRef(false);
  const onApplied = useCallback(() => {
    setEdit(undefined);
    setImported(undefined);
    // a new server, keys or port on a tunnel that was already up
    if (renew.current) void renewInterface(CLIENT).catch(() => undefined).finally(reload);
    else reload();
    renew.current = false;
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const status = usePoll(getWgStatus, 5000).data;

  const saved = data?.form;
  const form = edit ?? saved;
  const errors: Errors = form === undefined || data === undefined ? {} : validate(form, data);
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(saved);
  const invalid = Object.keys(errors).length > 0;
  const fix = data === undefined || dirty ? [] : drift(data);
  const running = status?.interfaces.find((i) => i.name === CLIENT);
  // the router's clock, which the handshakes are on
  const now = status?.now ?? 0;
  const blank = form?.privateKey === '' && form.publicKey === '';

  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]): void => {
    if (form !== undefined) setEdit({ ...form, [key]: value });
  };
  const useConf = (text: string): string | undefined => {
    if (form === undefined) return 'Not loaded yet.';
    const conf = parseConf(text);
    if ('error' in conf) return `That isn’t a WireGuard config this page can use: ${conf.error}`;
    const notes: string[] = [];
    if (conf.dns.length > 0) notes.push(`Its DNS server (${conf.dns.join(', ')}) isn’t used: devices keep this router’s DNS.`);
    const all = conf.peer.allowedIps.length === 0 || (conf.peer.allowedIps.includes('0.0.0.0/0') && conf.peer.allowedIps.includes('::/0'));
    if (!all) notes.push(`Its AllowedIPs (${conf.peer.allowedIps.join(', ')}) are replaced: this page sends all of a device’s traffic through the VPN.`);
    setImported(notes);
    // a first config turns it on: that's what it's for
    setEdit({ ...fromConf(form, conf), enabled: form.enabled || blank });
    return undefined;
  };
  const conn = form === undefined ? undefined : connectionState(saved ?? form, running, now);

  return (
    <>
      <PageHeader title="Send traffic through a VPN" description="Send chosen devices’ internet traffic through a VPN provider’s WireGuard server, with a kill switch." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {state.phase === 'done' && !state.nothingChanged && applied !== undefined && <AppliedCard lines={applied} />}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || data === undefined || form === undefined ? (
          <FormSkeleton />
        ) : !data.installed ? (
          <NoWireGuard />
        ) : (
          <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="flex flex-col gap-4">
              <Card>
                <CardHeader className="items-center">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <RouteIcon className="size-4" />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <CardTitle className="text-base">VPN connection</CardTitle>
                    <CardDescription className="truncate">{blank ? 'No config yet' : `${form.enabled ? 'On' : 'Off'} · ${serverText(form)}`}</CardDescription>
                  </div>
                  <CardAction className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setImporting(true);
                      }}
                    >
                      <FileUpIcon />
                      {blank ? 'Use a config' : 'New config'}
                    </Button>
                    <Switch
                      checked={form.enabled}
                      disabled={blank}
                      onCheckedChange={(v) => {
                        set('enabled', v);
                      }}
                      aria-label="VPN on"
                    />
                  </CardAction>
                </CardHeader>
                <CardContent>
                  {imported !== undefined && imported.length > 0 && (
                    <Alert variant="info" className="mb-3">
                      <AlertDescription>
                        <ul className="list-disc pl-4">
                          {imported.map((n) => (
                            <li key={n}>{n}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </Alert>
                  )}
                  {blank ? (
                    <p className="text-sm text-muted-foreground">
                      Start with your VPN provider’s WireGuard config file: “Use a config” reads it in, and you can check everything here before saving.
                    </p>
                  ) : (
                    <>
                      <Separator />
                      <div className="divide-y">
                        <Field id="vpn-host" label="Server" hint="The provider’s server ([Peer] Endpoint): a hostname or address." error={errors['host']}>
                          <Input
                            id="vpn-host"
                            value={form.endpointHost}
                            aria-invalid={errors['host'] !== undefined}
                            onChange={(e) => {
                              set('endpointHost', e.target.value.trim());
                            }}
                          />
                        </Field>
                        <Field id="vpn-port" label="Port" error={errors['port']}>
                          <Input
                            id="vpn-port"
                            inputMode="numeric"
                            value={form.endpointPort}
                            className="max-w-32 font-mono"
                            aria-invalid={errors['port'] !== undefined}
                            onChange={(e) => {
                              set('endpointPort', e.target.value.trim());
                            }}
                          />
                        </Field>
                        <Field id="vpn-public" label="Server’s public key" error={errors['public']}>
                          <Input
                            id="vpn-public"
                            value={form.publicKey}
                            className="font-mono text-xs"
                            aria-invalid={errors['public'] !== undefined}
                            onChange={(e) => {
                              set('publicKey', e.target.value.trim());
                            }}
                          />
                        </Field>
                        <Field id="vpn-private" label="This router’s private key" hint="From the config’s [Interface]. It’s what the provider knows this router by." error={errors['private']}>
                          <KeyInput
                            id="vpn-private"
                            value={form.privateKey}
                            error={errors['private']}
                            onChange={(v) => {
                              set('privateKey', v);
                            }}
                          />
                        </Field>
                        <Field id="vpn-psk" label="Preshared key" hint="Only if the config has one." error={errors['psk']}>
                          <KeyInput
                            id="vpn-psk"
                            value={form.presharedKey}
                            error={errors['psk']}
                            onChange={(v) => {
                              set('presharedKey', v);
                            }}
                          />
                        </Field>
                        <Field id="vpn-addresses" label="Addresses" hint="This router’s in the provider’s network ([Interface] Address), separated by commas. An IPv6 one carries IPv6 too." error={errors['addresses']}>
                          <Input
                            id="vpn-addresses"
                            value={form.addresses.join(', ')}
                            className="font-mono"
                            aria-invalid={errors['addresses'] !== undefined}
                            onChange={(e) => {
                              set('addresses', e.target.value.split(/,\s*/));
                            }}
                          />
                        </Field>
                        <Field id="vpn-mtu" label="MTU" hint="Empty for WireGuard’s 1420; lower only if the provider says so." error={errors['mtu']}>
                          <Input
                            id="vpn-mtu"
                            inputMode="numeric"
                            value={form.mtu}
                            placeholder="1420"
                            className="max-w-32 font-mono"
                            aria-invalid={errors['mtu'] !== undefined}
                            onChange={(e) => {
                              set('mtu', e.target.value.trim());
                            }}
                          />
                        </Field>
                      </div>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeading icon={UsersIcon} title="Who uses it" description="The rest, and the router itself, go out directly as before." />
                <CardContent className="flex flex-col gap-4">
                  <div role="radiogroup" aria-label="Home-network devices" className="grid gap-2 sm:grid-cols-2">
                    {whoOptions.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={form.who === o.value}
                        onClick={() => {
                          set('who', o.value);
                        }}
                        className={cn(
                          'flex flex-col items-start gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                          form.who === o.value ? 'border-primary/50 bg-primary/10' : 'bg-card hover:bg-accent',
                        )}
                      >
                        <span className={cn('text-sm font-medium', form.who === o.value && 'text-primary')}>{o.label}</span>
                        <span className="text-xs text-muted-foreground">{o.hint}</span>
                      </button>
                    ))}
                  </div>
                  {errors['who'] !== undefined && <p className="text-xs text-destructive">{errors['who']}</p>}
                  {(form.who === 'only' || form.who === 'except') && (
                    <DevicePicker
                      macs={form.macs}
                      devices={data.devices}
                      error={errors['macs']}
                      onChange={(m) => {
                        set('macs', m);
                      }}
                    />
                  )}
                  {data.guestZones.length > 0 && (
                    <div className="flex flex-col divide-y rounded-md border">
                      {data.guestZones.map((g) => (
                        <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                          <span>
                            Everything on <span className="font-medium">{g.label}</span>
                          </span>
                          <Switch
                            checked={form.guests.includes(g.id)}
                            aria-label={`${g.label} uses it`}
                            onCheckedChange={(v) => {
                              set('guests', v ? [...form.guests, g.id] : form.guests.filter((x) => x !== g.id));
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeading icon={ShieldCheckIcon} title="Protection and speed" />
                <CardContent>
                  <div className="divide-y">
                    <Field id="vpn-kill" label="Kill switch" hint="If the tunnel drops, its devices get no internet rather than going out unprotected.">
                      <Switch
                        id="vpn-kill"
                        checked={form.killSwitch}
                        onCheckedChange={(v) => {
                          set('killSwitch', v);
                        }}
                      />
                    </Field>
                    {data.sqm && (
                      <Field
                        id="vpn-shaper"
                        label="Smart Queue in the tunnel"
                        hint={`The internet port’s queue sees the tunnel as one connection, so it can’t keep its devices apart: this one can. Start ${String(Math.round((1 - TUNNEL_SHARE) * 100))}% under the internet port’s rates${data.wanRates === undefined ? '' : ` (${String(data.wanRates.down)}/${String(data.wanRates.up)})`}, and lower them if latency still climbs while one device downloads.`}
                        error={errors['shaper']}
                      >
                        <div className="flex flex-col gap-2">
                          <Switch
                            id="vpn-shaper"
                            checked={form.shaper}
                            onCheckedChange={(v) => {
                              set('shaper', v);
                            }}
                          />
                          {form.shaper && (
                            <div className="grid grid-cols-2 gap-2">
                              {(
                                [
                                  ['downMbit', 'Download'],
                                  ['upMbit', 'Upload'],
                                ] as const
                              ).map(([key, label]) => (
                                <div key={key} className="relative">
                                  <Input
                                    aria-label={`${label}, Mbit/s`}
                                    inputMode="decimal"
                                    value={form[key]}
                                    className="pr-16"
                                    aria-invalid={errors['shaper'] !== undefined}
                                    onChange={(e) => {
                                      set(key, e.target.value.trim());
                                    }}
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">Mbit/s {label === 'Download' ? '↓' : '↑'}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </Field>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-4">
              {conn !== undefined && !blank && (
                <Card>
                  <CardHeading icon={ActivityIcon} title="Connection" />
                  <CardContent>
                    <p className={cn('text-sm', conn.tone === 'warn' && 'text-warning', conn.tone === 'off' && 'text-muted-foreground')}>{conn.text}</p>
                  </CardContent>
                </Card>
              )}
              {fix.length > 0 && (
                <Alert variant="warning">
                  <TriangleAlertIcon />
                  <AlertTitle>Changed outside this page</AlertTitle>
                  <AlertDescription>
                    Some of its parts were edited in LuCI or on another page ({[...new Set(fix.map((c) => ('section' in c ? c.section : c.config)))].join(', ')}). Saving
                    here puts them back as this page sets them.
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      disabled={state.phase === 'applying'}
                      onClick={() => {
                        setApplied(['Put its parts back as this page sets them.']);
                        void apply(fix);
                      }}
                    >
                      <Undo2Icon />
                      Put back
                    </Button>
                  </AlertDescription>
                </Alert>
              )}
              {!blank && (
                <Card>
                  <CardHeading icon={ShieldCheckIcon} title="What this sets up" description={dirty ? 'Once saved.' : undefined} />
                  <CardContent className="flex flex-col gap-4">
                    <ul className="flex flex-col gap-2">
                      {describe(form, data).map((l) => (
                        <CheckItem key={l.text} yes={l.ok}>
                          {l.text}
                        </CheckItem>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground">
                      It’s OpenWrt’s own setup, so LuCI shows each part: Network → Interfaces ({CLIENT}, with the server as its peer, routes in table {CLIENT_TABLE}),
                      Network → Routing (the rules that send marked devices there), Network → Firewall (zone {CLIENT}, the MARK rules, the kill switch’s block)
                      {data.sqm ? ' and Network → SQM QoS' : ''}. The{' '}
                      <a href={`${href('firewall')}/rules`} className="underline">
                        Firewall page
                      </a>{' '}
                      labels its rules.
                    </p>
                  </CardContent>
                </Card>
              )}
              {data.exists && (
                <Button
                  variant="ghost"
                  className="self-start text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={state.phase === 'applying'}
                  onClick={() => {
                    setConfirmRemove(true);
                  }}
                >
                  <Trash2Icon />
                  Remove the VPN
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          if (data === undefined || form === undefined) return;
          setApplied(summary(data.exists ? data.form : undefined, form, data));
          const changes = toChanges(form, data);
          renew.current = form.enabled && changes.some((c) => c.config === 'network' && 'section' in c && c.section === data.peerSection);
          void apply(changes);
        }}
        onRevert={() => {
          setEdit(undefined);
          setImported(undefined);
        }}
      />
      <ImportDialog
        open={importing}
        onClose={() => {
          setImporting(false);
        }}
        onUse={useConf}
      />
      <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove the VPN?</DialogTitle>
            <DialogDescription>
              The WireGuard interface and its keys, its routing rules, its firewall zone, marks and kill switch{data?.sqm === true ? ', and its Smart Queue' : ''} all go,
              here and in LuCI, and every device goes out directly. To only pause it, turn it off instead.{dirty ? ' Changes you haven’t saved are dropped too.' : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmRemove(false);
                if (data === undefined) return;
                setEdit(undefined);
                setApplied(['Deleted the VPN’s interface and keys, its routing rules, its firewall zone and rules: every device goes out directly.']);
                void apply(removal(data));
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
