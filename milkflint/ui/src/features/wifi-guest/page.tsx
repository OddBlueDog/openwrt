import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  EyeIcon,
  EyeOffIcon,
  HousePlugIcon,
  type LucideIcon,
  PlusIcon,
  QrCodeIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UsersIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { SignalBars } from '@/components/charts/signal-bars';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { QrCode } from '@/components/qr-code';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { intToIp, ipToInt } from '@/lib/api/network';
import { formatDuration } from '@/lib/format';
import { wifiQrText } from '@/lib/qr';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { securityOptions } from '../wifi/security';
import { loadGuest, loadGuests } from './api';
import { GUEST_IDS, type GuestId } from './guest';
import {
  bandCreds,
  bandLabel,
  blankNet,
  type Creds,
  type Errors,
  freshAccess,
  generateKey,
  type GuestData,
  type Kind,
  labelOf,
  type NetData,
  type NetForm,
  newForm,
  removal,
  speedOk,
  toChanges,
  validate,
} from './model';

function Can({ yes, children }: { yes: boolean; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full',
          yes ? 'bg-success/15 text-success' : 'bg-destructive/12 text-destructive',
        )}
      >
        {yes ? <CheckIcon className="size-3" /> : <XIcon className="size-3" />}
      </span>
      <span>{children}</span>
    </li>
  );
}

function ConnectedGuests({ id, enabled }: { id: GuestId; enabled: boolean }): ReactElement {
  const guests = usePoll(() => loadGuests(id), 5000, id).data;
  return (
    <Card>
      <CardHeading
        icon={UsersIcon}
        title="Connected now"
        description={
          guests === undefined
            ? ' '
            : guests.length === 0
              ? enabled
                ? 'No devices right now.'
                : 'This network is off.'
              : `${String(guests.length)} device${guests.length === 1 ? '' : 's'}`
        }
      />
      {guests !== undefined && guests.length > 0 && (
        <CardContent className="flex flex-col divide-y">
          {guests.map((g) => (
            <div key={g.mac} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{g.name ?? g.mac}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {[g.ip, g.band, g.connected === undefined ? undefined : formatDuration(g.connected)].filter((x) => x !== undefined).join(' · ')}
                </div>
              </div>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular">
                <SignalBars dbm={g.signal} />
                {g.signal === undefined ? '' : `${String(g.signal)} dBm`}
              </span>
            </div>
          ))}
        </CardContent>
      )}
    </Card>
  );
}

/** A network name, security and password: the network's own, or one band's. */
function CredsFields({
  at,
  creds,
  saved,
  errors,
  onChange,
}: {
  /** the fields' id prefix, which is also their errors' */
  at: string;
  creds: Creds;
  /** as on the router, for a cipher set in LuCI */
  saved: Creds;
  errors: Errors;
  onChange: (c: Creds) => void;
}): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const set = (patch: Partial<Creds>): void => {
    onChange({ ...creds, ...patch });
  };
  const ssidError = errors[`${at}-ssid`];
  const keyError = errors[`${at}-key`];
  return (
    <>
      <Field id={`${at}-ssid`} label="Wi-Fi name" error={ssidError}>
        <Input
          id={`${at}-ssid`}
          value={creds.ssid}
          maxLength={32}
          aria-invalid={ssidError !== undefined}
          onChange={(e) => {
            set({ ssid: e.target.value });
          }}
        />
      </Field>
      <Field id={`${at}-security`} label="Security" hint={securityOptions.find((o) => o.value === creds.encryption)?.hint}>
        <Select
          value={creds.encryption}
          onValueChange={(v) => {
            // a cipher chosen in LuCI belongs to the mode it was chosen for
            set({ encryption: v, cipher: v === saved.encryption ? saved.cipher : '' });
          }}
        >
          <SelectTrigger id={`${at}-security`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {securityOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
            {!securityOptions.some((o) => o.value === creds.encryption) && <SelectItem value={creds.encryption}>{creds.encryption} (set elsewhere)</SelectItem>}
          </SelectContent>
        </Select>
      </Field>
      {creds.encryption !== 'none' && (
        <Field id={`${at}-key`} label="Password" hint="A new one locks out every device that has the old." error={keyError}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                id={`${at}-key`}
                type={showKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={creds.key}
                className="pr-10 font-mono"
                aria-invalid={keyError !== undefined}
                onChange={(e) => {
                  set({ key: e.target.value });
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setShowKey((v) => !v);
                }}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                aria-label={showKey ? 'Hide password' : 'Show password'}
              >
                {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
              </button>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label="Make up a new password"
              title="Make up a new password"
              onClick={() => {
                set({ key: generateKey() });
                setShowKey(true);
              }}
            >
              <RefreshCwIcon />
            </Button>
          </div>
        </Field>
      )}
    </>
  );
}

/** "Name on 2.4 and 5 GHz", "A on 2.4 GHz, B on 5 GHz", or "Off". */
function summary(f: NetForm, d: GuestData): string {
  if (!f.enabled) return 'Off';
  const on = bandCreds(f, d.radios);
  if (on.length === 0) return 'On no band';
  const names = [...new Set(on.map((b) => b.creds.ssid))];
  if (names.length === 1) return `${names[0] ?? ''} on ${on.map((b) => bandLabel(b.radio.band)).join(' and ')}`;
  return on.map((b) => `${b.creds.ssid} on ${bandLabel(b.radio.band)}`).join(', ');
}

function NetworkSettings({
  form,
  net,
  data,
  errors,
  onChange,
}: {
  form: NetForm;
  net: NetData;
  data: GuestData;
  errors: Errors;
  onChange: (f: NetForm) => void;
}): ReactElement {
  const id = form.id;
  const set = <K extends keyof NetForm>(key: K, value: NetForm[K]): void => {
    onChange({ ...form, [key]: value });
  };
  const offBands = data.radios.filter((r) => form.bands[r.name] === true && !r.on);
  const range = ipToInt(form.ipaddr);
  const several = data.radios.length > 1;
  const savedOwn = (radio: string): Creds => net.form.own[radio] ?? net.form.shared;
  const bandsError = form.enabled ? errors[`${id}-bands`] : undefined;
  return (
    <Card>
      <CardHeader className="items-center">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UsersIcon className="size-4" />
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-base">{labelOf(form)}</CardTitle>
          <CardDescription className="truncate">{summary(form, data)}</CardDescription>
        </div>
        <CardAction>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              set('enabled', v);
            }}
            aria-label={`${labelOf(form)} on`}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        <div className="divide-y">
          <Field id={`${id}-label`} label="What it’s for" hint="What this page calls it, e.g. Guests or Smart home. Devices see the Wi-Fi name." error={errors[`${id}-label`]}>
            <Input
              id={`${id}-label`}
              value={form.label}
              maxLength={32}
              aria-invalid={errors[`${id}-label`] !== undefined}
              onChange={(e) => {
                set('label', e.target.value);
              }}
            />
          </Field>
          <Field id={`${id}-bands`} label="Bands" hint="Saving restarts this network’s Wi-Fi where it changes: its devices reconnect within a few seconds. Your main network keeps running." error={bandsError}>
            <div id={`${id}-bands`} className="flex flex-wrap gap-2" role="group" aria-label="Bands">
              {data.radios.map((r) => {
                const on = form.bands[r.name] === true;
                return (
                  <button
                    key={r.name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      set('bands', { ...form.bands, [r.name]: !on });
                    }}
                    className={cn(
                      'flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
                      on ? 'border-primary/50 bg-primary/10 text-primary' : 'bg-card text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {on ? <CheckIcon className="size-3.5" /> : <span className="size-3.5" />}
                    {bandLabel(r.band)}
                  </button>
                );
              })}
            </div>
            {offBands.length > 0 && (
              <p className="text-xs text-warning">
                {offBands.map((r) => bandLabel(r.band)).join(' and ')} {offBands.length === 1 ? 'is' : 'are'} off in{' '}
                <a href={href('wifi')} className="underline">
                  Radios &amp; SSIDs
                </a>
                : this network starts there once {offBands.length === 1 ? 'it’s' : 'they’re'} on.
              </p>
            )}
          </Field>
          {several && (
            <Field
              id={`${id}-same`}
              label={data.radios.length === 2 ? 'Same on both bands' : 'Same on every band'}
              hint="One Wi-Fi name, security and password everywhere. Turn it off to give each band its own, e.g. a 2.4 GHz name for devices that can’t use 5 GHz."
            >
              <Switch
                id={`${id}-same`}
                checked={form.same}
                onCheckedChange={(v) => {
                  if (v) {
                    // the first band that's on is what every band broadcasts from now on
                    const first = data.radios.find((r) => form.bands[r.name] === true) ?? data.radios[0];
                    onChange({ ...form, same: true, shared: (first === undefined ? undefined : form.own[first.name]) ?? form.shared });
                  } else {
                    onChange({ ...form, same: false, own: Object.fromEntries(data.radios.map((r) => [r.name, { ...form.shared }])) });
                  }
                }}
              />
            </Field>
          )}
          {form.same ? (
            <CredsFields
              at={id}
              creds={form.shared}
              saved={net.form.shared}
              errors={errors}
              onChange={(c) => {
                set('shared', c);
              }}
            />
          ) : (
            bandCreds(form, data.radios).map(({ radio, creds }) => (
              <div key={radio.name}>
                <h3 className="pt-4 pb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{bandLabel(radio.band)}</h3>
                <CredsFields
                  at={`${id}-${radio.name}`}
                  creds={creds}
                  saved={savedOwn(radio.name)}
                  errors={errors}
                  onChange={(c) => {
                    set('own', { ...form.own, [radio.name]: c });
                  }}
                />
              </div>
            ))
          )}
          <Field id={`${id}-isolate`} label="Keep devices apart" hint="Devices on it can’t reach each other, on any band. They never reach yours.">
            <Switch
              id={`${id}-isolate`}
              checked={form.isolate}
              onCheckedChange={(v) => {
                set('isolate', v);
              }}
            />
          </Field>
          {net.shaper !== undefined && (
            <Field
              id={`${id}-down`}
              label="Speed limit"
              hint="For all its devices together, shared evenly between them. Leave a box empty for no limit that way."
              error={errors[`${id}-speed`]}
            >
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['downMbit', `${id}-down`, 'Download', ArrowDownIcon],
                    ['upMbit', `${id}-up`, 'Upload', ArrowUpIcon],
                  ] as const
                ).map(([key, fieldId, label, Icon]) => (
                  <div key={key} className="flex flex-col gap-1">
                    <label htmlFor={fieldId} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Icon className="size-3" />
                      {label}
                    </label>
                    <div className="relative">
                      <Input
                        id={fieldId}
                        inputMode="decimal"
                        placeholder="No limit"
                        value={form[key]}
                        className="pr-16 tabular"
                        aria-invalid={errors[`${id}-speed`] !== undefined && !speedOk(form[key])}
                        onChange={(e) => {
                          set(key, e.target.value.trim());
                        }}
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">Mbit/s</span>
                    </div>
                  </div>
                ))}
              </div>
            </Field>
          )}
          <Field
            id={`${id}-ip`}
            label="Router address"
            error={errors[`${id}-ip`]}
            hint={
              net.addressFixed
                ? `Set up differently in LuCI (Network → Interfaces → ${id}), so it’s left as it is here.`
                : range === undefined
                  ? undefined
                  : `Devices get ${intToIp(Math.floor(range / 256) * 256 + 100)} to ${intToIp(Math.floor(range / 256) * 256 + 249)}, on a network of their own.`
            }
          >
            <Input
              id={`${id}-ip`}
              className="font-mono"
              value={form.ipaddr}
              disabled={net.addressFixed}
              aria-invalid={errors[`${id}-ip`] !== undefined}
              onChange={(e) => {
                set('ipaddr', e.target.value.trim());
              }}
            />
          </Field>
        </div>
      </CardContent>
    </Card>
  );
}

/** The two kinds of network, as big buttons: for the first one and for Add. */
function KindChoice({ onPick }: { onPick: (k: Kind) => void }): ReactElement {
  const choices: { kind: Kind; icon: LucideIcon; title: string; text: string }[] = [
    { kind: 'visitors', icon: UsersIcon, title: 'For visitors', text: 'Their phones and laptops, on both bands, kept apart from each other.' },
    {
      kind: 'devices',
      icon: HousePlugIcon,
      title: 'For smart-home devices',
      text: 'Plugs, bulbs, cameras and speakers: 2.4 GHz and WPA2, which most of them need, away from your computers.',
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {choices.map((c) => (
        <button
          key={c.kind}
          type="button"
          onClick={() => {
            onPick(c.kind);
          }}
          className="flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary/5"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <c.icon className="size-4" />
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-sm font-medium">{c.title}</span>
            <span className="text-xs text-muted-foreground">{c.text}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export function GuestWifiPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadGuest);
  const [edit, setEdit] = useState<NetForm[]>();
  const [selected, setSelected] = useState<GuestId>();
  const [adding, setAdding] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<NetData>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);

  const saved = data?.nets.map((n) => n.form) ?? [];
  const forms = edit ?? saved;
  const netOf = (f: NetForm): NetData | undefined => (data === undefined ? undefined : (data.nets.find((n) => n.id === f.id) ?? blankNet(f, data)));
  const errorsOf = (f: NetForm): Errors => {
    const net = netOf(f);
    return data === undefined || net === undefined
      ? {}
      : validate(
          f,
          net,
          data,
          forms.filter((o) => o.id !== f.id),
        );
  };
  const changed = (f: NetForm): boolean => JSON.stringify(f) !== JSON.stringify(saved.find((s) => s.id === f.id));
  const dirty = edit !== undefined && (edit.length !== saved.length || edit.some(changed));
  const invalid = forms.some((f) => Object.keys(errorsOf(f)).length > 0);
  const current = forms.find((f) => f.id === selected) ?? forms[0];
  const currentNet = current === undefined ? undefined : netOf(current);
  const errors = current === undefined ? {} : errorsOf(current);
  const freeId = GUEST_IDS.find((id) => !forms.some((f) => f.id === id));

  const update = (f: NetForm): void => {
    setEdit(forms.map((o) => (o.id === f.id ? f : o)));
  };
  const add = (kind: Kind): void => {
    if (data === undefined || freeId === undefined) return;
    const f = newForm(freeId, kind, data, forms);
    setEdit([...forms, f].sort((a, b) => GUEST_IDS.indexOf(a.id) - GUEST_IDS.indexOf(b.id)));
    setSelected(f.id);
    setAdding(false);
  };
  const bands = current === undefined || data === undefined ? [] : bandCreds(current, data.radios);
  const qrs = current === undefined ? [] : current.same ? (bands[0] === undefined ? [] : [{ ...bands[0], label: undefined }]) : bands.map((b) => ({ ...b, label: bandLabel(b.radio.band) }));
  const others = forms.filter((f) => f.id !== current?.id);
  const setUp = currentNet !== undefined && data?.nets.some((n) => n.id === currentNet.id) === true;
  const access = currentNet?.access ?? freshAccess;

  return (
    <>
      <PageHeader title="Guest Wi-Fi" description="Networks of their own for visitors and smart-home devices: the internet, but none of your devices." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || data === undefined ? (
          <FormSkeleton />
        ) : current === undefined || currentNet === undefined ? (
          <Card>
            <CardHeading icon={UsersIcon} title="No guest network yet" description="Pick what it’s for: you can change every setting before saving, and add another later." />
            <CardContent>
              <KindChoice onPick={add} />
            </CardContent>
          </Card>
        ) : (
          <>
            {forms.length > 1 && (
              <div role="tablist" aria-label="Guest networks" className="flex w-full overflow-x-auto rounded-lg border bg-muted/50 p-1 sm:w-fit">
                {forms.map((f) => {
                  const bad = Object.keys(errorsOf(f)).length > 0;
                  return (
                    <button
                      key={f.id}
                      id={`guest-tab-${f.id}`}
                      type="button"
                      role="tab"
                      aria-selected={f.id === current.id}
                      aria-controls="guest-panel"
                      onClick={() => {
                        setSelected(f.id);
                      }}
                      className={cn(
                        'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors sm:flex-none',
                        f.id === current.id ? 'bg-card font-medium text-foreground shadow-xs' : 'hover:text-foreground',
                      )}
                    >
                      <span className={cn('size-1.5 rounded-full', bad ? 'bg-destructive' : f.enabled ? 'bg-success' : 'bg-muted-foreground/40')} />
                      {labelOf(f)}
                    </button>
                  );
                })}
              </div>
            )}
            <div id="guest-panel" role={forms.length > 1 ? 'tabpanel' : undefined} className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
              <NetworkSettings key={current.id} form={current} net={currentNet} data={data} errors={errors} onChange={update} />

              <div className="flex flex-col gap-4">
                <Card>
                  <CardHeading icon={ShieldCheckIcon} title="What its devices get" />
                  <CardContent className="flex flex-col gap-4">
                    <ul className="flex flex-col gap-2">
                      <Can yes={access.internet}>
                        The internet
                        {!access.internet
                          ? ': turned off on the Firewall page'
                          : current.downMbit !== '' || current.upMbit !== ''
                            ? `, at up to ${[current.downMbit === '' ? undefined : `${current.downMbit} Mbit/s down`, current.upMbit === '' ? undefined : `${current.upMbit} Mbit/s up`].filter((x) => x !== undefined).join(' and ')} between them`
                            : ''}
                      </Can>
                      <Can yes={access.lan}>Your devices{access.lan ? ': let through on the Firewall page' : ''}</Can>
                      <Can yes={access.router}>This router’s settings and SSH{access.router ? ': let through on the Firewall page' : ''}</Can>
                      {others.map((o) => (
                        <Can key={o.id} yes={access.guests.includes(o.id)}>
                          Devices on {labelOf(o)}
                          {access.guests.includes(o.id) ? ': let through on the Firewall page' : ''}
                        </Can>
                      ))}
                      <Can yes={!current.isolate}>Each other</Can>
                    </ul>
                    {access.fromLan && (
                      <p className="text-xs text-muted-foreground">
                        Your devices may reach these, as set on the{' '}
                        <a href={`${href('firewall')}/zones`} className="underline">
                          Firewall page
                        </a>
                        .
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Set up as OpenWrt’s own guide does it, so it shows in LuCI too: Network → Interfaces ({current.id}), Wireless, Firewall and DHCP and DNS. On the{' '}
                      <a href={`${href('firewall')}/zones`} className="underline">
                        Firewall page
                      </a>{' '}
                      it’s zone {current.id}.
                    </p>
                  </CardContent>
                </Card>

                {current.enabled && qrs.length > 0 && !Object.keys(errors).some((k) => k.endsWith('-ssid') || k.endsWith('-key')) && (
                  <Card>
                    <CardHeading
                      icon={QrCodeIcon}
                      title="Join with a camera"
                      description={changed(current) ? 'For the settings above, once they’re saved.' : 'Point a phone at it to join.'}
                    />
                    <CardContent className="flex flex-col items-center gap-4">
                      {qrs.map((q) => (
                        <div key={q.radio.name} className="flex flex-col items-center gap-1.5">
                          <QrCode
                            text={wifiQrText(q.creds.ssid, q.creds.encryption, q.creds.key)}
                            label={`QR code to join ${q.creds.ssid}`}
                            className="size-52 rounded-lg border bg-white p-1"
                          />
                          <span className="text-xs text-muted-foreground">{q.label === undefined ? q.creds.ssid : `${q.creds.ssid} · ${q.label}`}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {setUp && <ConnectedGuests id={current.id} enabled={currentNet.form.enabled} />}

                <div className="flex flex-wrap gap-2">
                  {freeId !== undefined && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setAdding(true);
                      }}
                    >
                      <PlusIcon />
                      Add a guest network
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    disabled={state.phase === 'applying'}
                    onClick={() => {
                      if (setUp) setConfirmRemove(currentNet);
                      else {
                        // not saved yet: it just goes
                        const rest = forms.filter((f) => f.id !== current.id);
                        setEdit(rest.length === saved.length && !rest.some(changed) ? undefined : rest);
                      }
                    }}
                  >
                    <Trash2Icon />
                    {setUp ? 'Remove this network' : 'Don’t add it'}
                  </Button>
                </div>
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
          if (data === undefined) return;
          const changes = forms.filter(changed).flatMap((f) => {
            const net = netOf(f);
            return net === undefined ? [] : toChanges(f, net, data);
          });
          void apply(changes);
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a guest network</DialogTitle>
            <DialogDescription>
              A network of its own, with its own Wi-Fi name and addresses: its devices get the internet, but not your devices or those on your other guest networks. Each
              one shares its bands’ airtime and adds its own beacons (about 0.5% of the airtime per band), so there can be up to {String(GUEST_IDS.length)}.
            </DialogDescription>
          </DialogHeader>
          <KindChoice onPick={add} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={confirmRemove !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmRemove(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {confirmRemove === undefined ? 'this network' : labelOf(confirmRemove.form)}?</DialogTitle>
            <DialogDescription>
              Its access points, its interface and address, its DHCP pool, its firewall zone and rules and its speed limit all go, here and in LuCI. To only pause it, turn
              it off instead.{dirty ? ' Changes you haven’t saved are dropped too.' : ''}
            </DialogDescription>
          </DialogHeader>
          {confirmRemove !== undefined && Object.keys(confirmRemove.aps).length > 0 && (
            <Alert variant="warning">
              <TriangleAlertIcon />
              <AlertDescription>Its devices are disconnected; your main network keeps running.</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirmRemove(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const net = confirmRemove;
                setConfirmRemove(undefined);
                if (net !== undefined) void apply(removal(net));
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
