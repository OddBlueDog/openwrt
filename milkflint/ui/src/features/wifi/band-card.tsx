// A band's card on Networks & radios, the whole band in one place: whether
// it's on air and how it's doing now, its network (name, password, security,
// the QR code to join it), then its radio (radio-card.tsx).
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { ArrowDownIcon, ArrowUpIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';
import { SNR_HINT } from '@/components/charts/signal-bars';
import { Sparkline } from '@/components/charts/sparkline';
import { Field } from '@/components/field';
import { QrCode } from '@/components/qr-code';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatBitrate, formatBytes, formatPercent } from '@/lib/format';
import { wifiQrText } from '@/lib/qr';
import { cn } from '@/lib/utils';
import { explain } from '@/components/explain';
import { channelLabel, LIVE_HISTORY, LIVE_POLL_MS, type LiveBand, modeLabel } from './live';
import { bandLabel, cipherFits, networkErrors, type RadioForm, type RadioOptions, SECURITY_PLAIN } from './model';
import { securityOptions } from './security';
import type { RegRule } from '@/lib/api/wireless';
import { RadioFields } from './radio-card';

type Set = <K extends keyof RadioForm>(key: K, value: RadioForm[K]) => void;

const LUCI_WIRELESS = '/cgi-bin/luci/admin/network/wireless';

function StatusBadge({ live }: { live: LiveBand | undefined }): ReactElement | null {
  if (live === undefined) return null;
  switch (live.state) {
    case 'online':
      return <Badge variant="success">Online</Badge>;
    case 'off':
      return <Badge variant="outline">Off</Badge>;
    case 'failed':
      return <Badge variant="destructive">Didn’t start</Badge>;
    case 'checking':
    case 'starting':
      return <Badge variant="warning">Starting…</Badge>;
  }
}

/** One line under the band's name: what it runs on, or why it isn't on air and what to do. */
function StatusLine({
  live,
  form,
  onShowRadar,
}: {
  live: LiveBand | undefined;
  form: RadioForm;
  onShowRadar: (() => void) | undefined;
}): ReactNode {
  if (live === undefined)
    return (
      <span className="inline-block h-4 w-48 rounded-md bg-muted align-middle motion-safe:animate-pulse">
        <span className="sr-only">Reading its state…</span>
      </span>
    );
  switch (live.state) {
    case 'online':
      return [channelLabel(live), modeLabel(live.htmode)].filter((x) => x !== undefined).join(' · ');
    case 'off':
      return form.enabled ? 'Off: it turns on when you save.' : 'Off: turn it on with the switch.';
    case 'failed':
      return (
        <>
          The network couldn’t start.{' '}
          <Link {...pageLink('logs')} className="font-medium text-foreground underline underline-offset-2">
            The system log
          </Link>{' '}
          says why (filter: hostapd).
        </>
      );
    case 'checking':
      return (
        <>
          Choosing a channel or checking it for radar, usually about a minute.
          {onShowRadar !== undefined && (
            <>
              {' '}
              <button type="button" onClick={onShowRadar} className="cursor-pointer font-medium link">
                Radar detection
              </button>
            </>
          )}
        </>
      );
    case 'starting':
      return 'Waiting for the radio.';
  }
}

/**
 * A reading: its label, its value and a second line, kept even when empty, so
 * the bands' cards keep the same rows and their settings below line up.
 */
function Stat({
  label,
  value,
  sub,
  subTitle,
  subStrong = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  subTitle?: string;
  subStrong?: boolean;
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-col">
        <span className="text-sm font-medium [overflow-wrap:anywhere] tabular">{value}</span>
        <span
          title={subTitle}
          className={cn(
            '[overflow-wrap:anywhere] tabular',
            subStrong ? 'text-sm font-medium' : 'text-xs text-muted-foreground',
            subTitle !== undefined && 'cursor-help',
          )}
        >
          {sub ?? '\u00a0'}
        </span>
      </dd>
    </div>
  );
}

/** A rate or total going down to the band's devices, or up from them: an arrow and the word for screen readers. */
function Way({ way, children, className }: { way: 'down' | 'up'; children: ReactNode; className?: string }): ReactElement {
  const Icon = way === 'down' ? ArrowDownIcon : ArrowUpIcon;
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      <Icon className={cn('size-[1em] shrink-0', way === 'down' ? 'text-chart-2' : 'text-chart-1')} aria-hidden />
      <span className="sr-only">{way === 'down' ? 'Down' : 'Up'}</span>
      {children}
    </span>
  );
}

/** What the band is doing now: throughput, devices, the weakest signal, airtime, noise. */
function LiveStats({ b }: { b: LiveBand }): ReactElement {
  const peak = Math.max(1_000_000, ...b.history.map((v) => v ?? 0));
  const weakest = b.weakest;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-lg font-semibold tabular">
          <Way way="down">{b.down === undefined ? '—' : formatBitrate(b.down)}</Way>
          <Way way="up">{b.up === undefined ? '—' : formatBitrate(b.up)}</Way>
        </div>
        <figure className="flex flex-col gap-1">
          {/* a baseline under the line, so a quiet band reads as a flat chart, not a stray mark */}
          <div className="border-b border-border">
            <Sparkline
              values={b.history}
              max={peak}
              slots={LIVE_HISTORY}
              className="h-8"
              label="Down + up"
              format={formatBitrate}
              timeOf={(slot) => Date.now() / 1000 - ((LIVE_HISTORY - 1 - slot) * LIVE_POLL_MS) / 1000}
            />
          </div>
          <figcaption className="flex justify-between text-xs text-muted-foreground">
            <span>Down and up, the last 2 minutes</span>
            <span>Now</span>
          </figcaption>
        </figure>
      </div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2.5">
        <Stat label="Devices" value={b.clients} sub={b.guests === undefined ? undefined : `${String(b.guests)} on guest`} />
        <Stat
          label="Weakest signal"
          value={weakest === undefined ? '—' : `${String(weakest.signal)} dBm`}
          sub={
            weakest === undefined
              ? undefined
              : [weakest.snr === undefined ? undefined : `SNR ${String(weakest.snr)} dB`, weakest.name]
                  .filter((x) => x !== undefined)
                  .join(' · ')
          }
          {...(weakest?.snr === undefined ? {} : { subTitle: SNR_HINT })}
        />
        <Stat label="Airtime used" value={b.airtime === undefined ? '—' : formatPercent(b.airtime)} />
        <Stat label="Noise" value={b.noise === undefined ? '—' : `${String(b.noise)} dBm`} />
        <Stat label="Transmit power" value={b.txpower === undefined ? '—' : `${String(b.txpower)} dBm`} />
        <Stat
          label="Since Wi-Fi started"
          value={b.sent === undefined ? '—' : <Way way="down">{formatBytes(b.sent)}</Way>}
          sub={b.received === undefined ? undefined : <Way way="up">{formatBytes(b.received)}</Way>}
          subStrong
        />
      </dl>
    </div>
  );
}

/**
 * The QR code to join the band's network as saved (the router broadcasts
 * that until a save), with a larger one to point a camera at.
 */
function JoinCode({ saved, edited }: { saved: RadioForm; edited: boolean }): ReactElement | null {
  const [large, setLarge] = useState(false);
  if (!saved.enabled || saved.iface === undefined || saved.ssid === '') return null;
  // OWE is open to the phone; enterprise networks need a username, which the code can't carry
  const encryption = saved.encryption === 'owe' ? 'none' : saved.encryption;
  if (encryption !== 'none' && !/^(psk|sae)/.test(encryption))
    return (
      <p className="border-t py-3.5 text-xs text-muted-foreground @min-[28rem]:max-w-32 @min-[28rem]:border-t-0">
        Networks with a username and password can’t be joined with a QR code.
      </p>
    );
  const text = wifiQrText(saved.ssid, encryption, saved.key, saved.hidden);
  return (
    <div className="flex items-center gap-4 border-t py-3.5 @min-[28rem]:flex-col @min-[28rem]:gap-2 @min-[28rem]:border-t-0 @min-[28rem]:pb-0">
      <button
        type="button"
        onClick={() => {
          setLarge(true);
        }}
        aria-label={`Show a larger QR code to join ${saved.ssid}`}
        className="shrink-0 cursor-pointer rounded-lg border bg-white p-1 transition-colors duration-fast hover:border-primary"
      >
        <QrCode text={text} label={`QR code to join ${saved.ssid}`} className="block size-24 @min-[28rem]:size-28" />
      </button>
      <div className="flex min-w-0 flex-col gap-0.5 @min-[28rem]:max-w-32 @min-[28rem]:items-center @min-[28rem]:text-center">
        <span className="text-sm font-medium">Join with a camera</span>
        <span className="text-xs text-muted-foreground">
          {edited ? 'For the saved network, until you save.' : 'Select it for a larger code.'}
        </span>
      </div>
      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join {bandLabel(saved.band)} with a camera</DialogTitle>
            <DialogDescription>Point a phone’s camera at it to join {saved.ssid}.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-1.5">
            <QrCode text={text} label={`QR code to join ${saved.ssid}`} className="size-60 rounded-lg border bg-white p-1" />
            <span className="text-xs text-muted-foreground">{saved.ssid}</span>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PasswordInput({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}): ReactElement {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
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
  );
}

export function BandCard({
  form,
  saved,
  live,
  onChange: set,
  onShowRadar,
  options,
  rules,
}: {
  form: RadioForm;
  /** The band as saved: what's on air, and what its QR code joins */
  saved: RadioForm;
  live: LiveBand | undefined;
  onChange: Set;
  /** Scrolls to the radar card, for a 5 GHz band waiting on a radar check */
  onShowRadar: (() => void) | undefined;
  /** What the radio can do, for its section of the card */
  options: RadioOptions | undefined;
  /** The country's rules, for each channel's power limit */
  rules: readonly RegRule[] | undefined;
}): ReactElement {
  const errors = networkErrors(form);
  const id = (field: string): string => `${form.radio}-${field}`;
  const band = bandLabel(form.band);
  const iface = form.iface;
  const security = securityOptions.find((o) => o.value === form.encryption);
  const credentialsEdited =
    form.ssid !== saved.ssid || form.key !== saved.key || form.encryption !== saved.encryption || form.hidden !== saved.hidden;

  return (
    <Card aria-labelledby={id('title')}>
      <CardHeader className="flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle id={id('title')}>{band}</CardTitle>
            <StatusBadge live={live} />
          </div>
          <CardDescription>
            <StatusLine live={live} form={form} onShowRadar={onShowRadar} />
          </CardDescription>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {form.enabled !== saved.enabled && (
            <span className="text-xs font-medium text-muted-foreground">{form.enabled ? 'On when saved' : 'Off when saved'}</span>
          )}
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              set('enabled', v);
            }}
            aria-label={`${band} Wi-Fi on`}
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        {live?.state === 'online' && <LiveStats b={live} />}
        {/* one list of the band's settings, network then radio, the QR code beside its top; the foot
            sits at the bottom, so side-by-side cards of different lengths still line up */}
        <div className="@container flex flex-1 flex-col border-t">
          <div className="grid flex-1 grid-rows-[auto_auto_auto_1fr] @min-[28rem]:grid-cols-[minmax(0,1fr)_auto] @min-[28rem]:grid-rows-[auto_auto_1fr] @min-[28rem]:gap-x-6">
            {iface === undefined ? (
              <p className="py-4 text-sm text-muted-foreground">
                This band has no network of its own.{' '}
                <a href={LUCI_WIRELESS} className="font-medium link">
                  Set one up in LuCI
                </a>
                .
              </p>
            ) : (
              <div className="divide-y">
                <Field
                  id={id('ssid')}
                  label="Network name"
                  error={errors.ssid}
                  {...explain('The name devices see in their list of Wi-Fi networks. 1 to 32 characters.', [
                    `wireless.${iface}.ssid`,
                  ])}
                >
                  <Input
                    id={id('ssid')}
                    value={form.ssid}
                    maxLength={32}
                    aria-invalid={errors.ssid !== undefined}
                    aria-describedby={errors.ssid === undefined ? undefined : `${id('ssid')}-error`}
                    onChange={(e) => {
                      set('ssid', e.target.value);
                    }}
                  />
                </Field>
                {form.encryption !== 'none' && (
                  <Field
                    id={id('key')}
                    label="Password"
                    error={errors.key}
                    {...explain('8 to 63 characters. Devices already joined need the new one to join again.', [
                      `wireless.${iface}.key`,
                    ])}
                  >
                    <PasswordInput
                      id={id('key')}
                      value={form.key}
                      invalid={errors.key !== undefined}
                      onChange={(v) => {
                        set('key', v);
                      }}
                    />
                  </Field>
                )}
                <Field
                  id={id('security')}
                  label="Security"
                  {...explain(
                    `${security?.hint ?? 'Set outside this page.'} ${security === undefined ? '' : `In OpenWrt’s terms: ${security.label} (${security.value}).`} The cipher is further down this card.`,
                    [`wireless.${iface}.encryption`],
                  )}
                >
                  <Select
                    value={form.encryption}
                    onValueChange={(v) => {
                      set('encryption', v);
                      // a cipher the new mode can't have would keep the network from starting
                      if (form.cipher !== '' && !cipherFits(form.cipher, v)) set('cipher', '');
                    }}
                  >
                    <SelectTrigger id={id('security')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {securityOptions.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {SECURITY_PLAIN[o.value] ?? o.label}
                        </SelectItem>
                      ))}
                      {security === undefined && (
                        <SelectItem value={form.encryption}>
                          {form.encryption}
                          {form.cipher === '' ? '' : `+${form.cipher}`} (set elsewhere)
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            )}
            <div className="@min-[28rem]:col-start-2 @min-[28rem]:row-span-2 @min-[28rem]:row-start-1">
              <JoinCode saved={saved} edited={credentialsEdited} />
            </div>
            <RadioFields form={form} options={options} rules={rules} onChange={set} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
