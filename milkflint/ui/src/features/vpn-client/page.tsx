// Send through a VPN: chosen devices' internet traffic goes through a VPN
// provider's WireGuard server (wg_out), with a kill switch. It opens on the
// answer (on or off, whether the tunnel is up and when it last heard from the
// server, who goes through it), then who uses it, protection and speed, and
// the provider's server details from their config file. "What this sets up"
// says in words what a save will do; the save result says what it did.
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  FileUpIcon,
  InfoIcon,
  PlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  Undo2Icon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useId, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { SearchSelect } from '@/components/search-select';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input, inputClass } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getWgStatus, isConnected, parseConf, renewInterface, type WgInterface, type WgPeer } from '@/lib/api/wireguard';
import { formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { isMac } from '../firewall/model';
import { Choice } from '../firewall/parts';
import { Cell, CheckItem, NoWireGuard, Traffic } from '../remote-access/parts';
import { loadClient } from './api';
import {
  type ClientForm,
  describe,
  type Device,
  drift,
  type Errors,
  fromConf,
  pickerLabel,
  removal,
  serverText,
  summary,
  toChanges,
  TUNNEL_SHARE,
  validate,
  type Who,
  whoSummary,
} from './model';
import { CLIENT, CLIENT_PEER, CLIENT_TABLE } from './sections';

function ImportDialog({
  open,
  onClose,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (text: string) => string | undefined;
}): ReactElement {
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
            From your VPN provider’s website (Mullvad, Proton VPN, IVPN, AzireVPN and others make them): pick a server, download
            its WireGuard file for a router or Linux, and open or paste it here. Its keys stay on this router.
          </DialogDescription>
        </DialogHeader>
        <textarea
          value={text}
          rows={10}
          spellCheck={false}
          placeholder={'[Interface]\nPrivateKey = …\nAddress = …\n\n[Peer]\nPublicKey = …\nEndpoint = …'}
          aria-label="The WireGuard config"
          aria-invalid={error !== undefined}
          className={cn(inputClass, 'h-auto py-2 font-mono text-xs')}
          onChange={(e) => {
            setText(e.target.value);
          }}
        />
        {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <label className="mr-auto inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium shadow-xs hover:bg-accent has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
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

function KeyInput({
  id,
  value,
  error,
  onChange,
}: {
  id: string;
  value: string;
  error: string | undefined;
  onChange: (v: string) => void;
}): ReactElement {
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
        className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground"
        aria-label={show ? 'Hide the key' : 'Show the key'}
      >
        {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

function DevicePicker({
  macs,
  devices,
  error,
  onChange,
}: {
  macs: string[];
  devices: readonly Device[];
  error: string | undefined;
  onChange: (m: string[]) => void;
}): ReactElement {
  const [typed, setTyped] = useState('');
  const known = new Map(devices.map((d) => [d.mac, d]));
  const add = (mac: string): void => {
    const m = mac.trim().toLowerCase().replace(/-/g, ':');
    if (m !== '' && !macs.includes(m)) onChange([...macs, m]);
  };
  return (
    <div className="flex flex-col gap-2">
      {macs.length > 0 && (
        <ul className="flex flex-col divide-y border-y">
          {macs.map((m) => {
            const d = known.get(m);
            return (
              <li key={m} className="flex items-center gap-2 py-1.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{d?.name ?? 'Unknown device'}</div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {[m, d?.ip].filter((x) => x !== undefined).join(' · ')}
                  </div>
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
        options={devices
          .filter((d) => !macs.includes(d.mac))
          .map((d) => ({ value: d.mac, label: pickerLabel(d, devices), keywords: `${d.mac} ${d.ip ?? ''}` }))}
        value=""
        placeholder="Add a device the router knows…"
        onChange={add}
      />
      <div className="flex gap-2">
        <Input
          value={typed}
          placeholder="or its MAC address"
          className="font-mono placeholder:font-sans"
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
  {
    value: 'except',
    label: 'All but these',
    hint: 'Everything on your home network but the devices listed: a games console, a work laptop, a TV app that blocks VPNs.',
  },
  { value: 'none', label: 'No home devices', hint: 'Only the guest networks switched on below go through it.' },
];

interface Connection {
  tone: 'ok' | 'warn' | 'off';
  badge: string;
  headline: string;
  text: string;
  peer?: WgPeer;
}

function connectionState(form: ClientForm, running: WgInterface | undefined, now: number): Connection {
  if (!form.enabled)
    return {
      tone: 'off',
      badge: 'Off',
      headline: 'Every device goes out directly',
      text: 'Nothing goes through the VPN until you turn it on.',
    };
  const peer = running?.peers[0];
  if (running === undefined || peer === undefined) {
    return {
      tone: 'warn',
      badge: 'Not up',
      headline: 'The tunnel isn’t up',
      text: 'Check the server’s address: the router has to find it first.',
    };
  }
  if (isConnected(peer, now)) {
    return {
      tone: 'ok',
      badge: 'Connected',
      headline: `Connected to ${peer.endpoint ?? serverText(form)}`,
      text: `Last handshake ${formatDuration(now - peer.latest_handshake)} ago.`,
      peer,
    };
  }
  if (peer.latest_handshake === 0) {
    return {
      tone: 'warn',
      badge: 'No answer',
      headline: 'No answer from the server yet',
      text: 'Check the keys and the server’s address and port.',
      peer,
    };
  }
  return {
    tone: 'warn',
    badge: 'No answer',
    headline: `No answer from the server for ${formatDuration(now - peer.latest_handshake)}`,
    text: form.killSwitch
      ? 'With the kill switch on, its devices have no internet meanwhile.'
      : 'Its devices go out directly meanwhile.',
    peer,
  };
}

/** A fold that opens itself while something in it needs fixing. */
function Fold({
  title,
  summary,
  mono = false,
  open,
  onToggle,
  children,
}: {
  title: string;
  summary: string;
  mono?: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}): ReactElement {
  const panel = useId();
  return (
    <div className="border-t">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-sm py-2 text-left text-sm font-medium hover:text-primary"
      >
        <ChevronDownIcon
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform duration-fast', open && 'rotate-180')}
          aria-hidden
        />
        {title}
        <span className={cn('min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground', mono && 'font-mono')}>
          {summary}
        </span>
      </button>
      <div id={panel} hidden={!open} className="divide-y border-t">
        {children}
      </div>
    </div>
  );
}

const opt = (name: string): ReactElement => <span className="font-mono">{name}</span>;

/** The provider's server and this router's keys and addresses, as their config file gives them. */
function ServerFields({
  form,
  errors,
  set,
}: {
  form: ClientForm;
  errors: Errors;
  set: <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => void;
}): ReactElement {
  return (
    <>
      <Field
        id="vpn-host"
        label="Server"
        hint="The provider’s server: a hostname or address."
        why={
          <>
            The config’s [Peer] Endpoint. It’s {opt('endpoint_host')} on peer {opt(CLIENT_PEER)}.
          </>
        }
        error={errors['host']}
      >
        <Input
          id="vpn-host"
          value={form.endpointHost}
          aria-invalid={errors['host'] !== undefined}
          onChange={(e) => {
            set('endpointHost', e.target.value.trim());
          }}
        />
      </Field>
      <Field
        id="vpn-port"
        label="Port"
        hint="UDP, from the same Endpoint."
        why={
          <>
            It’s {opt('endpoint_port')} on peer {opt(CLIENT_PEER)}.
          </>
        }
        error={errors['port']}
      >
        <Input
          id="vpn-port"
          inputMode="numeric"
          value={form.endpointPort}
          className="max-w-32 tabular"
          aria-invalid={errors['port'] !== undefined}
          onChange={(e) => {
            set('endpointPort', e.target.value.trim());
          }}
        />
      </Field>
      <Field
        id="vpn-public"
        label="Server’s public key"
        hint="The config’s [Peer] PublicKey."
        why={
          <>
            It’s {opt('public_key')} on peer {opt(CLIENT_PEER)}.
          </>
        }
        error={errors['public']}
      >
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
      <Field
        id="vpn-private"
        label="This router’s private key"
        hint="What the provider knows this router by."
        why={
          <>
            The config’s [Interface] PrivateKey: {opt('private_key')} on interface {opt(CLIENT)}.
          </>
        }
        error={errors['private']}
      >
        <KeyInput
          id="vpn-private"
          value={form.privateKey}
          error={errors['private']}
          onChange={(v) => {
            set('privateKey', v);
          }}
        />
      </Field>
      <Field
        id="vpn-psk"
        label="Preshared key"
        hint="Only if the config has one."
        why={
          <>
            {opt('preshared_key')} on peer {opt(CLIENT_PEER)}.
          </>
        }
        error={errors['psk']}
      >
        <KeyInput
          id="vpn-psk"
          value={form.presharedKey}
          error={errors['psk']}
          onChange={(v) => {
            set('presharedKey', v);
          }}
        />
      </Field>
      <Field
        id="vpn-addresses"
        label="Addresses"
        hint="This router’s in the provider’s network, separated by commas."
        why={
          <>
            The config’s [Interface] Address. An IPv6 one carries IPv6 too. It’s {opt('addresses')} on interface {opt(CLIENT)}.
          </>
        }
        error={errors['addresses']}
      >
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
      <Field
        id="vpn-mtu"
        label="MTU"
        hint="Empty for WireGuard’s 1420."
        why={
          <>
            Lower it only if the provider says so. It’s {opt('mtu')} on interface {opt(CLIENT)}.
          </>
        }
        error={errors['mtu']}
      >
        <Input
          id="vpn-mtu"
          inputMode="numeric"
          value={form.mtu}
          placeholder="1420"
          className="max-w-32 tabular"
          aria-invalid={errors['mtu'] !== undefined}
          onChange={(e) => {
            set('mtu', e.target.value.trim());
          }}
        />
      </Field>
    </>
  );
}

const SERVER_ERRORS = ['host', 'port', 'public', 'private', 'psk', 'addresses', 'mtu'];

export function VpnClientPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadClient);
  const [edit, setEdit] = useState<ClientForm>();
  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState<string[]>();
  const [details, setDetails] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const renew = useRef(false);
  const onApplied = useCallback(() => {
    setEdit(undefined);
    setImported(undefined);
    // a new server, keys or port on a tunnel that was already up
    if (renew.current)
      void renewInterface(CLIENT)
        .catch(() => undefined)
        .finally(reload);
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
  const serverWrong = SERVER_ERRORS.some((k) => errors[k] !== undefined);

  const set = <K extends keyof ClientForm>(key: K, value: ClientForm[K]): void => {
    if (form !== undefined) setEdit({ ...form, [key]: value });
  };
  const useConf = (text: string): string | undefined => {
    if (form === undefined) return 'Not loaded yet.';
    const conf = parseConf(text);
    if ('error' in conf) return `That isn’t a WireGuard config this page can use: ${conf.error}`;
    const notes: string[] = [];
    if (conf.dns.length > 0) notes.push(`Its DNS server (${conf.dns.join(', ')}) isn’t used: devices keep this router’s DNS.`);
    const all =
      conf.peer.allowedIps.length === 0 || (conf.peer.allowedIps.includes('0.0.0.0/0') && conf.peer.allowedIps.includes('::/0'));
    if (!all)
      notes.push(
        `Its AllowedIPs (${conf.peer.allowedIps.join(', ')}) are replaced: this page sends all of a device’s traffic through the VPN.`,
      );
    setImported(notes);
    // a first config turns it on: that's what it's for
    setEdit({ ...fromConf(form, conf), enabled: form.enabled || blank });
    // what it read in, to check before saving
    setDetails(true);
    return undefined;
  };
  const conn = form === undefined ? undefined : connectionState(saved ?? form, running, now);
  const importButton = (
    <Button
      variant={blank ? 'default' : 'outline'}
      size="sm"
      onClick={() => {
        setImporting(true);
      }}
    >
      <FileUpIcon />
      {blank ? 'Use a config' : 'New config'}
    </Button>
  );

  return (
    <>
      <PageHeader
        title="Send through a VPN"
        description="Send chosen devices’ internet traffic through a VPN provider’s WireGuard server, with a kill switch."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || data === undefined || form === undefined || saved === undefined || conn === undefined ? (
          <FormSkeleton />
        ) : !data.installed ? (
          <NoWireGuard />
        ) : (
          <>
            <Card className="gap-0 py-0">
              <div className="flex flex-col gap-1.5 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <h2 className="text-lg font-semibold tracking-tight [overflow-wrap:anywhere]">
                      {blank ? 'No VPN set up yet' : conn.headline}
                    </h2>
                    {/* the heading already says when there's none */}
                    {!blank && (
                      <Badge variant={conn.tone === 'ok' ? 'success' : conn.tone === 'warn' ? 'warning' : 'secondary'}>
                        {conn.badge}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {blank && importButton}
                    <Switch
                      checked={form.enabled}
                      disabled={blank}
                      onCheckedChange={(v) => {
                        set('enabled', v);
                      }}
                      aria-label="VPN on"
                    />
                  </div>
                </div>
                <p className="flex max-w-prose flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
                  {blank
                    ? 'Start with your VPN provider’s WireGuard config file: “Use a config” reads it in, and you can check everything here before saving.'
                    : conn.text}
                  {!blank && conn.peer !== undefined && conn.peer.latest_handshake > 0 && (
                    <Traffic down={conn.peer.rx_bytes} up={conn.peer.tx_bytes} />
                  )}
                </p>
              </div>
              {!blank && (
                <div className="grid divide-y border-t md:grid-cols-2 md:divide-x md:divide-y-0">
                  <Cell
                    title="Goes through the tunnel"
                    status={
                      <span className="text-sm font-medium">
                        {saved.enabled ? whoSummary(saved, data) : 'Nothing while it’s off'}
                      </span>
                    }
                  >
                    <p>The rest, and the router’s own traffic, go out directly as before.</p>
                  </Cell>
                  <Cell
                    title="Kill switch"
                    status={saved.killSwitch ? <Badge variant="success">On</Badge> : <Badge variant="secondary">Off</Badge>}
                  >
                    <p>
                      {saved.killSwitch
                        ? 'If the tunnel drops, its devices get no internet rather than going out unprotected.'
                        : 'If the tunnel drops, its devices go out directly until it’s back.'}
                    </p>
                  </Cell>
                </div>
              )}
            </Card>
            {fix.length > 0 && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Changed outside this page</AlertTitle>
                <AlertDescription>
                  Some of its parts were edited in LuCI or on another page (
                  {[...new Set(fix.map((c) => ('section' in c ? c.section : c.config)))].join(', ')}). Saving here puts them back
                  as this page sets them.
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-2"
                    disabled={state.phase === 'applying'}
                    onClick={() => {
                      void apply(fix, { note: 'Put its parts back as this page sets them.' });
                    }}
                  >
                    <Undo2Icon />
                    Put back
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className={cn('grid items-start gap-4', !blank && 'xl:grid-cols-[minmax(0,1fr)_22rem]')}>
              <div className="flex min-w-0 flex-col gap-4">
                <Card>
                  <CardHeading title="Who uses it" description="The rest, and the router itself, go out directly as before." />
                  <CardContent className="flex flex-col gap-4">
                    <Choice
                      label="Home-network devices"
                      value={form.who}
                      options={whoOptions}
                      columns={2}
                      onChange={(v) => {
                        set('who', v);
                      }}
                    />
                    {errors['who'] !== undefined && <p className="text-xs font-medium text-destructive">{errors['who']}</p>}
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
                      <div className="divide-y border-t">
                        {data.guestZones.map((g) => (
                          <Field
                            key={g.id}
                            id={`vpn-guest-${g.id}`}
                            label={`Everything on ${g.label}`}
                            hint="Every device on this guest network goes through it."
                          >
                            <Switch
                              id={`vpn-guest-${g.id}`}
                              checked={form.guests.includes(g.id)}
                              onCheckedChange={(v) => {
                                set('guests', v ? [...form.guests, g.id] : form.guests.filter((x) => x !== g.id));
                              }}
                            />
                          </Field>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeading title="Protection and speed" />
                  <CardContent>
                    <div className="divide-y border-t">
                      <Field
                        id="vpn-kill"
                        label="Kill switch"
                        hint="If the tunnel drops, its devices get no internet rather than going out unprotected."
                        why={
                          <>
                            A routing rule ({opt(`${CLIENT}_kill`)}) sends their traffic nowhere when the tunnel’s routes are
                            gone, and a firewall rule per network ({opt(`${CLIENT}_leak_lan`)}
                            …) drops what would leave by the internet port.
                          </>
                        }
                      >
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
                          hint="Keeps the tunnel’s devices apart, so one download doesn’t slow the rest."
                          why={
                            <>
                              The internet port’s queue sees the tunnel as one connection, so it can’t keep its devices apart:
                              this one can. Start {String(Math.round((1 - TUNNEL_SHARE) * 100))}% under the internet port’s rates
                              {data.wanRates === undefined ? '' : ` (${String(data.wanRates.down)}/${String(data.wanRates.up)})`},
                              and lower them if latency still climbs while one device downloads. It’s SQM’s queue{' '}
                              {opt(`sqm.${CLIENT}`)}.
                            </>
                          }
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
                                    ['downMbit', 'Download', ArrowDownIcon],
                                    ['upMbit', 'Upload', ArrowUpIcon],
                                  ] as const
                                ).map(([key, label, Icon]) => (
                                  <div key={key} className="relative">
                                    <Input
                                      aria-label={`${label}, Mbit/s`}
                                      inputMode="decimal"
                                      value={form[key]}
                                      className="pr-20"
                                      aria-invalid={errors['shaper'] !== undefined}
                                      onChange={(e) => {
                                        set(key, e.target.value.trim());
                                      }}
                                    />
                                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center gap-1 text-xs text-muted-foreground">
                                      Mbit/s
                                      <Icon className="size-3.5" aria-hidden />
                                    </span>
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

                {!blank && (
                  <Card>
                    <CardHeading
                      title="The provider’s server"
                      description="As the config file gave it; change it here only if the provider says so."
                      action={importButton}
                    />
                    <CardContent className="flex flex-col gap-3">
                      {imported !== undefined && imported.length > 0 && (
                        <Note tone="info" icon={<InfoIcon />} title="Read in, apart from:">
                          <ul className="list-disc pl-4">
                            {imported.map((n) => (
                              <li key={n}>{n}</li>
                            ))}
                          </ul>
                        </Note>
                      )}
                      <Fold
                        title="Server, keys and addresses"
                        summary={serverWrong ? 'Something to fix here' : serverText(form)}
                        mono={!serverWrong && form.endpointHost.trim() !== ''}
                        open={details || serverWrong}
                        onToggle={() => {
                          setDetails((d) => !(d || serverWrong));
                        }}
                      >
                        <ServerFields form={form} errors={errors} set={set} />
                      </Fold>
                    </CardContent>
                  </Card>
                )}
              </div>

              <div className="flex flex-col gap-4">
                {!blank && (
                  <Card>
                    <CardHeading title="What this sets up" status={dirty ? 'Once saved.' : 'As saved.'} />
                    <CardContent className="flex flex-col gap-4">
                      <ul className="flex flex-col gap-2">
                        {describe(form, data).map((l) => (
                          <CheckItem key={l.text} yes={l.ok}>
                            {l.text}
                          </CheckItem>
                        ))}
                      </ul>
                      <p className="border-t pt-3 text-xs text-muted-foreground">
                        It’s OpenWrt’s own setup, so LuCI shows each part: Network → Interfaces ({CLIENT}, with the server as its
                        peer, routes in table {CLIENT_TABLE}), Network → Routing (the rules that send marked devices there),
                        Network → Firewall (zone {CLIENT}, the MARK rules, the kill switch’s block)
                        {data.sqm ? ' and Network → SQM QoS' : ''}. The{' '}
                        <a href={`${href('firewall')}/rules`} className="font-medium link underline-offset-4">
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
                    className="self-start text-destructive hover:bg-destructive-subtle hover:text-destructive"
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
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={() => {
          if (data === undefined || form === undefined) return;
          const applied = summary(data.exists ? data.form : undefined, form, data);
          const changes = toChanges(form, data);
          renew.current =
            form.enabled && changes.some((c) => c.config === 'network' && 'section' in c && c.section === data.peerSection);
          void apply(changes, { note: applied.join(' ') });
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
              The WireGuard interface and its keys, its routing rules, its firewall zone, marks and kill switch
              {data?.sqm === true ? ', and its Smart Queue' : ''} all go, here and in LuCI, and every device goes out directly. To
              only pause it, turn it off instead.{dirty ? ' Changes you haven’t saved are dropped too.' : ''}
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
                void apply(removal(data), {
                  note: 'Deleted the VPN’s interface and keys, its routing rules, its firewall zone and rules: every device goes out directly.',
                });
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
