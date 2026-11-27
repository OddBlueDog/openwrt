// The VPN page's editable cards: who uses it, protection and speed, the
// sites that go direct, and the provider's server, and the dialog that reads
// a provider's config file in.
// The page draws them for the live tunnel; the profiles' editor draws the
// same ones for a profile that isn't active (mode 'profile': no connection
// state, ids of their own, and the server always shown).
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  FileUpIcon,
  InfoIcon,
  PlusIcon,
  RefreshCwIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useId, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { Note } from '@/components/note';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { parseSites } from '@/lib/hostnames';
import { cn } from '@/lib/utils';
import { isMac } from '../firewall/model';
import { Choice } from '../firewall/parts';
import {
  type ClientData,
  type ClientForm,
  type Device,
  type Errors,
  MAX_DIRECT,
  pickerLabel,
  serverNeedsFixing,
  serverText,
  TUNNEL_SHARE,
  type Who,
} from './model';
import { CLIENT, CLIENT_META, CLIENT_PEER } from './sections';

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
  at,
  macs,
  devices,
  error,
  onChange,
}: {
  /** the start of its id: the page's and the profile sheet's differ */
  at: string;
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
        id={`${at}-device`}
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

/**
 * Sites that go direct, typed or pasted one a line (or with commas): the
 * form holds the names as cleaned, the field what was typed, with what it
 * left out, until the list changes from outside it (Revert, the reload after
 * a save), when it shows the names as kept. Only where the router's dnsmasq
 * can fill the sets.
 */
function DirectSites({
  at,
  sites,
  nftset,
  error,
  onChange,
}: {
  at: string;
  sites: string[];
  nftset: boolean;
  error: string | undefined;
  onChange: (s: string[]) => void;
}): ReactElement {
  const [text, setText] = useState(() => sites.join('\n'));
  const [shown, setShown] = useState(sites);
  // the field's own edits hand back the list it shows; any other is from outside
  if (shown !== sites) {
    setShown(sites);
    setText(sites.join('\n'));
  }
  const parsed = parseSites(text, MAX_DIRECT);
  const problem = error !== undefined || parsed.bad.length > 0 || parsed.over;
  // what the field says about itself: what's wrong with it first, then how to fill it in
  const describedBy = [...(problem ? [`${at}-direct-problem`] : []), `${at}-direct-note`];
  return (
    <Card>
      <CardHeading
        title="Sites that go direct"
        description="Sites that won’t work through a VPN skip it on these devices, using your normal line."
      />
      <CardContent className="flex flex-col gap-2">
        {!nftset ? (
          <Note tone="info" icon={<RefreshCwIcon />}>
            This firmware’s DNS can’t do this yet: update MilkFlint to use sites that go direct.
          </Note>
        ) : (
          <>
            <Textarea
              id={`${at}-direct`}
              value={text}
              rows={4}
              spellCheck={false}
              autoCapitalize="none"
              autoCorrect="off"
              placeholder={'bbc.co.uk\nbbci.co.uk'}
              aria-label="Sites that go direct"
              aria-invalid={error !== undefined}
              aria-describedby={describedBy.join(' ')}
              className="font-mono text-xs placeholder:font-sans"
              onChange={(e) => {
                setText(e.target.value);
                const next = parseSites(e.target.value, MAX_DIRECT).sites;
                setShown(next);
                onChange(next);
              }}
            />
            {error !== undefined ? (
              <p id={`${at}-direct-problem`} className="text-xs text-destructive">
                {error}
              </p>
            ) : parsed.bad.length > 0 ? (
              <p id={`${at}-direct-problem`} className="text-xs text-warning">
                Not a site’s name, left out: {parsed.bad.join(', ')}
              </p>
            ) : parsed.over ? (
              <p id={`${at}-direct-problem`} className="text-xs text-warning">
                At most {String(MAX_DIRECT)}: the first {String(MAX_DIRECT)} are used.
              </p>
            ) : null}
            <p id={`${at}-direct-note`} className="text-xs text-muted-foreground">
              One site a line, or commas between them. Each covers everything under it: bbc.co.uk covers www.bbc.co.uk. A service
              can need more than one: iPlayer needs bbc.co.uk and bbci.co.uk.
            </p>
            <details className="group text-xs text-muted-foreground">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1 font-medium text-foreground [&::-webkit-details-marker]:hidden">
                Good to know
                <ChevronDownIcon
                  className="size-3.5 transition-transform duration-fast group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4">
                <li>A device using its own encrypted DNS (Android’s Private DNS, a browser’s DNS over HTTPS) skips this list.</li>
                <li>
                  Sites on a shared CDN address can take others on it with them. Don’t list a DNS service’s own name (dns.google,
                  say): lookups through it would skip the VPN too.
                </li>
                <li>
                  Names are looked up over your normal line: with plain DNS someone on the way could send other sites direct;
                  encrypted DNS on the DNS page stops that.
                </li>
                <li>
                  Adding a site breaks a connection already open to it through the VPN once; removing one may restart connections
                  to the others.
                </li>
              </ul>
            </details>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** The provider's server and this router's keys and addresses, as their config file gives them. */
function ServerFields({
  at,
  form,
  errors,
  set,
}: {
  at: string;
  form: ClientForm;
  errors: Errors;
  set: <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => void;
}): ReactElement {
  return (
    <>
      <Field
        id={`${at}-host`}
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
          id={`${at}-host`}
          value={form.endpointHost}
          aria-invalid={errors['host'] !== undefined}
          onChange={(e) => {
            set('endpointHost', e.target.value.trim());
          }}
        />
      </Field>
      <Field
        id={`${at}-port`}
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
          id={`${at}-port`}
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
        id={`${at}-public`}
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
          id={`${at}-public`}
          value={form.publicKey}
          className="font-mono text-xs"
          aria-invalid={errors['public'] !== undefined}
          onChange={(e) => {
            set('publicKey', e.target.value.trim());
          }}
        />
      </Field>
      <Field
        id={`${at}-private`}
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
          id={`${at}-private`}
          value={form.privateKey}
          error={errors['private']}
          onChange={(v) => {
            set('privateKey', v);
          }}
        />
      </Field>
      <Field
        id={`${at}-psk`}
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
          id={`${at}-psk`}
          value={form.presharedKey}
          error={errors['psk']}
          onChange={(v) => {
            set('presharedKey', v);
          }}
        />
      </Field>
      <Field
        id={`${at}-addresses`}
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
          id={`${at}-addresses`}
          value={form.addresses.join(', ')}
          className="font-mono"
          aria-invalid={errors['addresses'] !== undefined}
          onChange={(e) => {
            set('addresses', e.target.value.split(/,\s*/));
          }}
        />
      </Field>
      <Field
        id={`${at}-mtu`}
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
          id={`${at}-mtu`}
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

/** The first-config state (the live page only) and the server fold its import opens. */
export interface LiveParts {
  blank: boolean;
  details: boolean;
  onToggleDetails: () => void;
}

/** "Use a config" (first one) or "New config", on the page and in a profile's sheet. */
export function ConfigButton({ blank, onClick }: { blank: boolean; onClick: () => void }): ReactElement {
  return (
    <Button variant={blank ? 'default' : 'outline'} size="sm" onClick={onClick}>
      <FileUpIcon />
      {blank ? 'Use a config' : 'New config'}
    </Button>
  );
}

export function ClientFormCards({
  form,
  set,
  errors,
  data,
  mode,
  live,
  importButton,
  imported,
}: {
  form: ClientForm;
  set: <K extends keyof ClientForm>(key: K, value: ClientForm[K]) => void;
  errors: Errors;
  data: ClientData;
  mode: 'live' | 'profile';
  live?: LiveParts;
  /** the server card's "Use a config", and what the config it read in left out */
  importButton?: ReactNode;
  imported?: string[] | undefined;
}): ReactElement {
  const [ownDetails, setOwnDetails] = useState(false);
  const serverWrong = serverNeedsFixing(errors);
  const blank = mode === 'live' && live?.blank === true;
  // the page's fields and a profile sheet's are on screen at once
  const at = mode === 'live' ? 'vpn' : 'vpnp';
  const details = live !== undefined ? live.details : ownDetails;
  const toggleDetails =
    live !== undefined
      ? live.onToggleDetails
      : (): void => {
          setOwnDetails((d) => !(d || serverWrong));
        };
  return (
    <>
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
              at={at}
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
                  id={`${at}-guest-${g.id}`}
                  label={`Everything on ${g.label}`}
                  hint="Every device on this guest network goes through it."
                >
                  <Switch
                    id={`${at}-guest-${g.id}`}
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
              id={`${at}-kill`}
              label="Kill switch"
              hint="If the tunnel drops, its devices get no internet rather than going out unprotected."
              why={
                <>
                  A routing rule ({opt(`${CLIENT}_kill`)}) sends their traffic nowhere when the tunnel’s routes are gone, and a
                  firewall rule per network ({opt(`${CLIENT}_leak_lan`)}
                  …) drops what would leave by the internet port.
                </>
              }
            >
              <Switch
                id={`${at}-kill`}
                checked={form.killSwitch}
                onCheckedChange={(v) => {
                  set('killSwitch', v);
                }}
              />
            </Field>
            <Field
              id={`${at}-dns`}
              label="Use VPN’s DNS"
              hint="Devices sent through the VPN use its DNS server through the tunnel; other devices keep this router’s DNS."
              why={
                <>
                  Lookups from marked devices go to a local forwarder ({opt('milkflint-vpn')}) that asks the provider’s DNS
                  through the tunnel ({opt(`milkflint.${CLIENT_META}`)}), while names on your network still come from dnsmasq.
                  Other devices and the router itself keep the DNS page’s servers.
                </>
              }
              error={errors['dns']}
            >
              <div className="flex flex-col gap-2">
                <Switch
                  id={`${at}-dns`}
                  checked={form.useVpnDns}
                  onCheckedChange={(v) => {
                    set('useVpnDns', v);
                  }}
                />
                {form.useVpnDns && (
                  <Input
                    aria-label="VPN DNS servers"
                    value={form.dns.join(', ')}
                    placeholder="10.64.0.1"
                    className="font-mono"
                    aria-invalid={errors['dns'] !== undefined}
                    onChange={(e) => {
                      set('dns', e.target.value.split(/,\s*/));
                    }}
                  />
                )}
              </div>
            </Field>
            {data.sqm && (
              <Field
                id={`${at}-shaper`}
                label="Smart Queue in the tunnel"
                hint="Keeps the tunnel’s devices apart, so one download doesn’t slow the rest."
                why={
                  <>
                    The internet port’s queue sees the tunnel as one connection, so it can’t keep its devices apart: this one can.
                    Start {String(Math.round((1 - TUNNEL_SHARE) * 100))}% under the internet port’s rates
                    {data.wanRates === undefined ? '' : ` (${String(data.wanRates.down)}/${String(data.wanRates.up)})`}, and lower
                    them if latency still climbs while one device downloads. It’s SQM’s queue {opt(`sqm.${CLIENT}`)}.
                  </>
                }
                error={errors['shaper']}
              >
                <div className="flex flex-col gap-2">
                  <Switch
                    id={`${at}-shaper`}
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

      <DirectSites
        at={at}
        sites={form.direct}
        nftset={data.nftset === true}
        error={errors['direct']}
        onChange={(s) => {
          set('direct', s);
        }}
      />

      {!blank && (
        <Card>
          <CardHeading
            title="The provider’s server"
            description="As the config file gave it; change it here only if the provider says so."
            {...(importButton === undefined ? {} : { action: importButton })}
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
              onToggle={toggleDetails}
            >
              <ServerFields at={at} form={form} errors={errors} set={set} />
            </Fold>
          </CardContent>
        </Card>
      )}
    </>
  );
}

/** Reads a provider's WireGuard config in, pasted or from its file; `onUse` says why it can't, or takes it. */
export function ImportDialog({
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
        <Textarea
          value={text}
          rows={10}
          spellCheck={false}
          placeholder={'[Interface]\nPrivateKey = …\nAddress = …\nDNS = …\n\n[Peer]\nPublicKey = …\nEndpoint = …'}
          aria-label="The WireGuard config"
          aria-invalid={error !== undefined}
          className="font-mono text-xs"
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
