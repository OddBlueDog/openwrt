// One guest network's settings, in tiers: its name, password, security and
// bands first; what the page calls it, one name per band, isolation, the
// speed limit, its address and lease time under More settings. Each "Why?"
// names the UCI options the control writes.
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, EyeIcon, EyeOffIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { Field } from '@/components/field';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { intToIp, ipToInt } from '@/lib/api/network';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { explain } from '@/components/explain';
import { SECURITY_PLAIN } from '../wifi/model';
import { MoreSettings } from '@/components/more-settings';
import { securityOptions } from '../wifi/security';
import { KindChoice } from './kind';
import {
  apSections,
  bandCreds,
  bandLabel,
  type Creds,
  type Errors,
  generateKey,
  type GuestData,
  type Kind,
  labelOf,
  LEASE_TIMES,
  leaseLabel,
  moreSummary,
  type NetData,
  type NetForm,
  networkSummary,
  speedOk,
} from './model';

const options = (aps: readonly string[], option: string): string[] => aps.map((a) => `wireless.${a}.${option}`);

function PasswordInput({
  id,
  value,
  invalid,
  onChange,
  onGenerate,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
  onGenerate: () => void;
}): ReactElement {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          autoComplete="new-password"
          value={value}
          className="pr-10 font-mono"
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(e) => {
            onChange(e.target.value);
          }}
        />
        <button
          type="button"
          onClick={() => {
            setShow((v) => !v);
          }}
          className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center rounded-r-lg text-muted-foreground hover:text-foreground"
          aria-label={show ? 'Hide password' : 'Show password'}
          aria-pressed={show}
        >
          {show ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
        </button>
      </div>
      <Button
        variant="outline"
        size="icon"
        aria-label="Make up a new password"
        title="Make up a new password"
        onClick={() => {
          onGenerate();
          setShow(true);
        }}
      >
        <RefreshCwIcon />
      </Button>
    </div>
  );
}

/** A network name, password and security: the network's own, or one band's. */
function CredsFields({
  at,
  creds,
  saved,
  errors,
  aps,
  onChange,
}: {
  /** the fields' id prefix, which is also their errors' */
  at: string;
  creds: Creds;
  /** as on the router, for a cipher set in LuCI */
  saved: Creds;
  errors: Errors;
  /** the access points these are written to */
  aps: readonly string[];
  onChange: (c: Creds) => void;
}): ReactElement {
  const set = (patch: Partial<Creds>): void => {
    onChange({ ...creds, ...patch });
  };
  const ssidError = errors[`${at}-ssid`];
  const keyError = errors[`${at}-key`];
  const security = securityOptions.find((o) => o.value === creds.encryption);
  return (
    <>
      <Field
        id={`${at}-ssid`}
        label="Wi-Fi name"
        error={ssidError}
        {...explain('The name devices see in their list of Wi-Fi networks. 1 to 32 characters.', options(aps, 'ssid'))}
      >
        <Input
          id={`${at}-ssid`}
          value={creds.ssid}
          maxLength={32}
          aria-invalid={ssidError !== undefined}
          aria-describedby={ssidError === undefined ? undefined : `${at}-ssid-error`}
          onChange={(e) => {
            set({ ssid: e.target.value });
          }}
        />
      </Field>
      {creds.encryption !== 'none' && (
        <Field
          id={`${at}-key`}
          label="Password"
          error={keyError}
          {...explain(
            '8 to 63 characters. A new one locks out every device that has the old, until it joins again with the new.',
            options(aps, 'key'),
          )}
        >
          <PasswordInput
            id={`${at}-key`}
            value={creds.key}
            invalid={keyError !== undefined}
            onChange={(key) => {
              set({ key });
            }}
            onGenerate={() => {
              set({ key: generateKey() });
            }}
          />
        </Field>
      )}
      <Field
        id={`${at}-security`}
        label="Security"
        {...explain(
          `${security?.hint ?? 'Set outside this page.'}${security === undefined ? '' : ` In OpenWrt’s terms: ${security.label} (${security.value}).`}`,
          options(aps, 'encryption'),
        )}
      >
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
                {SECURITY_PLAIN[o.value] ?? o.label}
              </SelectItem>
            ))}
            {security === undefined && <SelectItem value={creds.encryption}>{creds.encryption} (set elsewhere)</SelectItem>}
          </SelectContent>
        </Select>
      </Field>
    </>
  );
}

function SpeedInput({
  id,
  label,
  way,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  way: 'down' | 'up';
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}): ReactElement {
  const Icon = way === 'down' ? ArrowDownIcon : ArrowUpIcon;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3" aria-hidden />
        {label}
      </label>
      <div className="relative">
        <Input
          id={id}
          inputMode="decimal"
          placeholder="No limit"
          value={value}
          className="pr-16 tabular"
          aria-invalid={invalid}
          onChange={(e) => {
            onChange(e.target.value.trim());
          }}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          Mbit/s
        </span>
      </div>
    </div>
  );
}

export function NetworkSettings({
  form,
  net,
  data,
  errors,
  kind,
  setUp,
  busy,
  onChange,
  onKind,
  onRemove,
}: {
  form: NetForm;
  net: NetData;
  data: GuestData;
  errors: Errors;
  /** What a network not saved yet was added for: its two kinds stay shown, to switch. */
  kind: Kind | undefined;
  /** It's on the router (saved at least once): Remove takes it off; otherwise it's just dropped. */
  setUp: boolean;
  busy: boolean;
  onChange: (f: NetForm) => void;
  onKind: (k: Kind) => void;
  onRemove: () => void;
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
  const aps = apSections(form, net, data.radios);
  const apOf = (radio: string): string => net.aps[radio]?.['.name'] ?? `${id}_${radio}`;
  const pool = net.dhcp?.['.name'] ?? id;
  const queue = net.shaper?.['.name'] ?? id;
  const label = labelOf(form);
  const enabledChanged = form.enabled !== net.form.enabled && setUp;

  // why it can't be changed here: shown in every theme
  const addressFixed = net.addressFixed
    ? `Set up differently in LuCI (Network → Interfaces → ${id}), so it’s left as it is here.`
    : undefined;
  let addressHint: string | undefined;
  if (range !== undefined && !net.addressFixed)
    addressHint = `Devices get ${intToIp(Math.floor(range / 256) * 256 + 100)} to ${intToIp(Math.floor(range / 256) * 256 + 249)}, on a network of their own.`;

  const bandsField: ReactNode = (
    <Field
      id={`${id}-bands`}
      label="Bands"
      error={bandsError}
      {...explain(
        'Which bands it’s on. Saving restarts its Wi-Fi where it changes: its devices reconnect within a few seconds. Your main network keeps running.',
        options(
          data.radios.map((r) => apOf(r.name)),
          'disabled',
        ),
      )}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Bands">
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
                'flex h-9 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors duration-fast',
                on
                  ? 'border-primary bg-primary-subtle font-medium text-primary-subtle-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {on ? <CheckIcon className="size-4" aria-hidden /> : <span className="size-4" aria-hidden />}
              {bandLabel(r.band)}
            </button>
          );
        })}
      </div>
      {offBands.length > 0 && (
        <p className="text-xs text-warning">
          {offBands.map((r) => bandLabel(r.band)).join(' and ')} {offBands.length === 1 ? 'is' : 'are'} off in{' '}
          <a href={href('wifi')} className="font-medium underline underline-offset-2">
            Networks &amp; radios
          </a>
          : this network starts there once {offBands.length === 1 ? 'it’s' : 'they’re'} on.
        </p>
      )}
    </Field>
  );

  return (
    <Card aria-labelledby={`${id}-settings-title`} className="gap-0">
      <CardHeader className="flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <CardTitle id={`${id}-settings-title`}>{label}: settings</CardTitle>
          <CardDescription className="truncate">{networkSummary(form, data.radios)}</CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {enabledChanged && (
            <span className="text-xs font-medium text-muted-foreground">{form.enabled ? 'On when saved' : 'Off when saved'}</span>
          )}
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              set('enabled', v);
            }}
            aria-label={`${label} on`}
          />
        </div>
      </CardHeader>
      {kind !== undefined && (
        <div className="flex flex-col gap-2 px-5 pt-4">
          <p className="text-sm font-medium">What it’s for</p>
          <KindChoice label="What it’s for" value={kind} onPick={onKind} />
          <p className="text-xs text-muted-foreground">Switching starts the settings below again for that kind.</p>
        </div>
      )}
      <CardContent className="mt-4">
        <div className="divide-y border-t">
          {form.same ? (
            <CredsFields
              at={id}
              creds={form.shared}
              saved={net.form.shared}
              errors={errors}
              aps={aps}
              onChange={(c) => {
                set('shared', c);
              }}
            />
          ) : (
            bandCreds(form, data.radios).map(({ radio, creds }) => (
              <section key={radio.name} aria-label={bandLabel(radio.band)}>
                <h3 className="pt-4 text-sm font-medium">{bandLabel(radio.band)}</h3>
                <div className="divide-y">
                  <CredsFields
                    at={`${id}-${radio.name}`}
                    creds={creds}
                    saved={savedOwn(radio.name)}
                    errors={errors}
                    aps={[apOf(radio.name)]}
                    onChange={(c) => {
                      set('own', { ...form.own, [radio.name]: c });
                    }}
                  />
                </div>
              </section>
            ))
          )}
          {bandsField}
        </div>
        <MoreSettings summary={moreSummary(form, data.radios)}>
          <Field
            id={`${id}-label`}
            label="What it’s for"
            error={errors[`${id}-label`]}
            {...explain('What this page calls it, e.g. Guests or Smart home. Devices see the Wi-Fi name, not this.', [
              `milkflint.${id}.label`,
            ])}
          >
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
          {several && (
            <Field
              id={`${id}-same`}
              label={data.radios.length === 2 ? 'Same on both bands' : 'Same on every band'}
              {...explain(
                'One Wi-Fi name, security and password everywhere. Turn it off to give each band its own, e.g. a 2.4 GHz name for devices that can’t use 5 GHz.',
                [],
              )}
            >
              <Switch
                id={`${id}-same`}
                checked={form.same}
                onCheckedChange={(v) => {
                  if (v) {
                    // the first band that's on is what every band broadcasts from now on
                    const first = data.radios.find((r) => form.bands[r.name] === true) ?? data.radios[0];
                    onChange({
                      ...form,
                      same: true,
                      shared: (first === undefined ? undefined : form.own[first.name]) ?? form.shared,
                    });
                  } else {
                    onChange({
                      ...form,
                      same: false,
                      own: Object.fromEntries(data.radios.map((r) => [r.name, { ...form.shared }])),
                    });
                  }
                }}
              />
            </Field>
          )}
          <Field
            id={`${id}-isolate`}
            label="Keep devices apart"
            {...explain('Devices on it can’t reach each other, on any band. They never reach yours.', [
              ...options(aps, 'isolate'),
              ...options(aps, 'bridge_isolate'),
            ])}
          >
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
              error={errors[`${id}-speed`]}
              {...explain(
                'For all its devices together, shared evenly between them. Leave a box empty for no limit that way. It’s a queue of its own on the network’s bridge, where upload is what its devices download.',
                [`sqm.${queue}.upload`, `sqm.${queue}.download`],
              )}
            >
              <div className="grid grid-cols-2 gap-2">
                <SpeedInput
                  id={`${id}-down`}
                  label="Download"
                  way="down"
                  value={form.downMbit}
                  invalid={errors[`${id}-speed`] !== undefined && !speedOk(form.downMbit)}
                  onChange={(v) => {
                    set('downMbit', v);
                  }}
                />
                <SpeedInput
                  id={`${id}-up`}
                  label="Upload"
                  way="up"
                  value={form.upMbit}
                  invalid={errors[`${id}-speed`] !== undefined && !speedOk(form.upMbit)}
                  onChange={(v) => {
                    set('upMbit', v);
                  }}
                />
              </div>
            </Field>
          )}
          <Field
            id={`${id}-ip`}
            label="Router address"
            error={errors[`${id}-ip`]}
            status={addressFixed}
            {...explain(addressHint ?? 'The router’s address on this network.', [`network.${id}.ipaddr`])}
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
          <Field
            id={`${id}-lease`}
            label="Address lease"
            {...explain(
              'How long a device keeps its address before it asks again. Visitors come and go: a short time hands their addresses on sooner.',
              [`dhcp.${pool}.leasetime`],
            )}
          >
            <Select
              value={form.leasetime}
              onValueChange={(v) => {
                set('leasetime', v);
              }}
            >
              <SelectTrigger id={`${id}-lease`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEASE_TIMES.map((l) => (
                  <SelectItem key={l.value} value={l.value}>
                    {l.label}
                  </SelectItem>
                ))}
                {!LEASE_TIMES.some((l) => l.value === form.leasetime) && (
                  <SelectItem value={form.leasetime}>{leaseLabel(form.leasetime)} (set elsewhere)</SelectItem>
                )}
              </SelectContent>
            </Select>
          </Field>
        </MoreSettings>
      </CardContent>
      <div className="flex flex-wrap items-center gap-3 border-t px-5 pt-4">
        <Button
          variant="ghost"
          className="-ml-3 text-destructive hover:bg-destructive-subtle hover:text-destructive"
          disabled={busy}
          onClick={onRemove}
        >
          <Trash2Icon />
          {setUp ? 'Remove this network' : 'Don’t add it'}
        </Button>
        {setUp && <p className="text-xs text-muted-foreground">To only pause it, turn it off with the switch at the top.</p>}
      </div>
    </Card>
  );
}
