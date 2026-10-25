// The live state of each band, at the top of the Wi-Fi page: on or off,
// what it runs on, devices, throughput now, airtime and signal.
import { ArrowDownIcon, ArrowUpIcon, QrCodeIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useRef, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { QrCode } from '@/components/qr-code';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getDevices, getLeases } from '@/lib/api/network';
import { bool, getConfig, str } from '@/lib/api/uci';
import { getAccessPoints, getSurvey, getWirelessStatus, type SurveyEntry } from '@/lib/api/wireless';
import { formatBitrate, formatBytes, formatPercent } from '@/lib/format';
import { wifiQrText } from '@/lib/qr';
import { onGuestNetwork } from '../wifi-guest/guest';
import { blockAround, blockOf, widthOf } from './channels';

const POLL_MS = 3000;
/** Two minutes of samples for each band's sparkline. */
const HISTORY = 40;
/** A network whose interface hostapd hasn't brought up after this long didn't start. */
const FAILED_AFTER_MS = 30_000;

interface Band {
  radio: string;
  band: string;
  /** checking: choosing a channel, or listening for radar before using it */
  state: 'online' | 'off' | 'starting' | 'checking' | 'failed';
  ssid: string | undefined;
  /** The band's own network's section in the wireless config, for its password. */
  section: string | undefined;
  channel: number | undefined;
  /** The 20 MHz channels it takes up at its width (the primary is `channel`). */
  block: number[] | undefined;
  htmode: string | undefined;
  /** Every device on the band, guests too. */
  clients: number;
  /** Devices on its guest network; undefined when it has none. */
  guests: number | undefined;
  weakest: { name: string; signal: number } | undefined;
  /** bits/s: what devices download (the access point's tx) and upload (its rx). */
  down: number | undefined;
  up: number | undefined;
  /** Bytes since the access points started. */
  sent: number | undefined;
  received: number | undefined;
  /** Share of the time the channel was busy, since the previous sample. */
  airtime: number | undefined;
  noise: number | undefined;
  txpower: number | undefined;
  history: (number | undefined)[];
}

interface Previous {
  at: number;
  /** The access points counted: when that changes, so do the totals. */
  ifnames: string;
  rx: number;
  tx: number;
  busy: number | undefined;
  active: number | undefined;
}

function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

/** "HE80" -> "Wi-Fi 6 · 80 MHz". */
function modeLabel(htmode: string | undefined): string | undefined {
  const m = /^(EHT|HE|VHT|HT|NOHT)(\d*)/.exec(htmode ?? '');
  if (m === null) return undefined;
  const gen = { EHT: 'Wi-Fi 7', HE: 'Wi-Fi 6', VHT: 'Wi-Fi 5', HT: 'Wi-Fi 4', NOHT: 'Legacy' }[m[1] as 'EHT' | 'HE' | 'VHT' | 'HT' | 'NOHT'];
  return m[2] === undefined || m[2] === '' ? gen : `${gen} · ${m[2]} MHz`;
}

/** "Channel 36", or "Channels 36–48 (primary 36)" when it's wider than 20 MHz. */
function channelLabel(b: Band): string | undefined {
  if (b.channel === undefined) return undefined;
  const first = b.block?.[0];
  const last = b.block?.at(-1);
  if (first === undefined || last === undefined || first === last) return `Channel ${String(b.channel)}`;
  return `Channels ${String(first)}–${String(last)} (primary ${String(b.channel)})`;
}

function useWifiLive(): Band[] | undefined {
  const previous = useRef(new Map<string, Previous>());
  const history = useRef(new Map<string, (number | undefined)[]>());
  const missingSince = useRef(new Map<string, number>());

  return usePoll(async (): Promise<Band[]> => {
    const status = await getWirelessStatus();
    const [aps, devices, leases] = await Promise.all([getAccessPoints(status), getDevices(), getLeases().catch(() => [])]);
    const surveys = new Map(
      await Promise.all(aps.map(async (ap) => [ap.ifname, await getSurvey(ap.ifname).catch((): SurveyEntry[] => [])] as const)),
    );
    const names = new Map(leases.flatMap((l) => (l.hostname === undefined ? [] : [[l.macaddr.toLowerCase(), l.hostname] as const])));
    const now = performance.now();

    // as the settings below: radios that are off and have no access point aren't networks
    const used = Object.entries(status).filter(
      ([, r]) => r.disabled !== true || (r.interfaces ?? []).some((i) => (i.config?.mode ?? 'ap') === 'ap'),
    );
    return used.map(([radio, r]): Band => {
      // the band's own network for what it runs on; traffic and devices of its guest network too
      const mine = aps.filter((a) => a.radio === radio);
      const ap = mine.find((a) => !onGuestNetwork(a.networks)) ?? mine[0];
      const guestAps = mine.filter((a) => onGuestNetwork(a.networks));
      const info = ap?.info;
      const counters = mine.flatMap((a) => devices[a.ifname]?.statistics ?? []);
      const stats =
        counters.length === 0
          ? undefined
          : { rx_bytes: counters.reduce((n, c) => n + c.rx_bytes, 0), tx_bytes: counters.reduce((n, c) => n + c.tx_bytes, 0) };
      const ifnames = mine.map((a) => a.ifname).join(' ');
      const survey = surveys.get(ap?.ifname ?? '')?.find((s) => s.mhz === info?.frequency);

      // rates and airtime since the previous sample of this band's access points
      const last = previous.current.get(radio);
      const prev = last?.ifnames === ifnames ? last : undefined;
      const seconds = prev === undefined ? 0 : (now - prev.at) / 1000;
      const perSecond = (before: number | undefined, after: number | undefined): number | undefined =>
        before === undefined || after === undefined || seconds <= 0 || after < before ? undefined : ((after - before) * 8) / seconds;
      const down = perSecond(prev?.tx, stats?.tx_bytes);
      const up = perSecond(prev?.rx, stats?.rx_bytes);
      const activeDelta = (survey?.active_time ?? 0) - (prev?.active ?? 0);
      const busyDelta = (survey?.busy_time ?? 0) - (prev?.busy ?? 0);
      const airtime = prev?.active !== undefined && activeDelta > 0 && busyDelta >= 0 ? Math.min(1, busyDelta / activeDelta) : undefined;
      if (stats !== undefined) {
        previous.current.set(radio, { at: now, ifnames, rx: stats.rx_bytes, tx: stats.tx_bytes, busy: survey?.busy_time, active: survey?.active_time });
      }
      const series = [...(history.current.get(radio) ?? []), down === undefined && up === undefined ? undefined : (down ?? 0) + (up ?? 0)].slice(-HISTORY);
      history.current.set(radio, series);

      const signals = mine.flatMap((a) => a.stations).flatMap((s) => {
        const signal = s.signal_avg ?? s.signal;
        return signal === undefined ? [] : [{ name: names.get(s.mac.toLowerCase()) ?? s.mac, signal }];
      });
      const weakest = signals.reduce<{ name: string; signal: number } | undefined>((w, s) => (w === undefined || s.signal < w.signal ? s : w), undefined);
      // netifd lists only the networks that are on; a radio with none is up but has nothing to start
      const networkOn = (r.interfaces ?? []).some((i) => (i.config?.mode ?? 'ap') === 'ap' && i.config?.disabled !== true);
      // the interface, once hostapd has it: carrier while it broadcasts, none while it picks a channel or
      // listens for radar; never there when hostapd couldn't start it (a channel the country doesn't allow)
      const dev = ap === undefined ? undefined : devices[ap.ifname];
      if (r.disabled === true || !networkOn || dev?.up === true) missingSince.current.delete(radio);
      else if (!missingSince.current.has(radio)) missingSince.current.set(radio, now);
      const missing = now - (missingSince.current.get(radio) ?? now);
      const htmode = info?.htmode ?? r.config?.htmode;
      const band = r.config?.band ?? '';
      const width = widthOf(htmode);
      const block =
        info?.channel === undefined
          ? undefined
          : info.center_chan1 === undefined
            ? blockOf(band, info.channel, width)
            : blockAround(info.center_chan1, width);

      return {
        radio,
        band,
        state:
          r.disabled === true || !networkOn
            ? 'off'
            : dev?.up === true && dev.carrier === true
              ? 'online'
              : dev?.up === true
                ? 'checking'
                : r.retry_setup_failed === true || missing > FAILED_AFTER_MS
                  ? 'failed'
                  : 'starting',
        ssid: ap?.ssid ?? info?.ssid,
        section: (r.interfaces ?? []).find((i) => ap !== undefined && i.ifname === ap.ifname)?.section,
        channel: info?.channel,
        block,
        htmode,
        clients: mine.reduce((n, a) => n + a.stations.length, 0),
        guests: guestAps.length === 0 ? undefined : guestAps.reduce((n, a) => n + a.stations.length, 0),
        weakest,
        down,
        up,
        sent: stats?.tx_bytes,
        received: stats?.rx_bytes,
        airtime,
        // 0 or above: the driver doesn't know
        noise: info?.noise !== undefined && info.noise < 0 ? info.noise : undefined,
        txpower: info?.txpower,
        history: series,
      };
    });
  }, POLL_MS).data;
}

function Stat({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular">{children}</span>
    </div>
  );
}

/** The QR code to join a band's own network, read when it's shown: passwords aren't polled. */
function JoinQr({ section, ssid }: { section: string; ssid: string }): ReactElement {
  const { data, error } = useLoad(async () => (await getConfig('wireless')).find((s) => s['.name'] === section));
  if (error !== undefined) return <p className="text-sm text-muted-foreground">Couldn’t read the network’s settings.</p>;
  if (data === undefined) return <div className="size-60 animate-pulse rounded-lg bg-muted" />;
  // OWE is open to the phone; enterprise networks need a username, which the code can't carry
  const security = (str(data, 'encryption') ?? 'none').split('+')[0] ?? 'none';
  const encryption = security === 'owe' ? 'none' : security;
  if (encryption !== 'none' && !/^(psk|sae)/.test(encryption))
    return <p className="text-sm text-muted-foreground">Networks with a username and password can’t be joined with a QR code.</p>;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <QrCode
        text={wifiQrText(str(data, 'ssid') ?? ssid, encryption, str(data, 'key') ?? '', bool(data, 'hidden'))}
        label={`QR code to join ${ssid}`}
        className="size-60 rounded-lg border bg-white p-1"
      />
      <span className="text-xs text-muted-foreground">{ssid}</span>
    </div>
  );
}

function BandCard({ b }: { b: Band }): ReactElement {
  const [qr, setQr] = useState(false);
  const online = b.state === 'online';
  const peak = Math.max(1_000_000, ...b.history.map((v) => v ?? 0));
  const mode = modeLabel(b.htmode);
  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            {online ? <WifiIcon className="size-4" /> : <WifiOffIcon className="size-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{bandLabel(b.band)}</span>
              <Badge variant={online ? 'success' : b.state === 'off' ? 'outline' : b.state === 'failed' ? 'destructive' : 'warning'}>
                {online ? 'Online' : b.state === 'off' ? 'Off' : b.state === 'failed' ? 'Didn’t start' : 'Starting…'}
              </Badge>
            </div>
            <p className={online ? 'truncate text-xs text-muted-foreground' : 'text-xs text-muted-foreground'}>
              {online
                ? [b.ssid, channelLabel(b), mode].filter((x) => x !== undefined).join(' · ')
                : b.state === 'off'
                  ? 'Turn it on in the settings below'
                  : b.state === 'failed'
                    ? 'The Wi-Fi network couldn’t start. The system log says why (filter: hostapd).'
                    : b.state === 'checking'
                      ? 'Choosing a channel or checking it for radar, usually about a minute'
                      : 'Waiting for the radio'}
            </p>
          </div>
          {online && b.ssid !== undefined && b.section !== undefined && (
            <Button
              variant="ghost"
              size="icon"
              className="-my-1 shrink-0"
              aria-label={`Show a QR code to join ${b.ssid}`}
              title="Join with a camera"
              onClick={() => {
                setQr(true);
              }}
            >
              <QrCodeIcon />
            </Button>
          )}
        </div>
        {online && b.ssid !== undefined && b.section !== undefined && (
          <Dialog open={qr} onOpenChange={setQr}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Join {bandLabel(b.band)} with a camera</DialogTitle>
                <DialogDescription>Point a phone’s camera at it to join {b.ssid}.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-center">
                <JoinQr section={b.section} ssid={b.ssid} />
              </div>
            </DialogContent>
          </Dialog>
        )}
        {online && (
          <>
            <div className="flex items-end gap-6">
              <div className="flex items-center gap-1.5">
                <ArrowDownIcon className="size-4 text-chart-2" />
                <span className="text-xl font-semibold tabular">{b.down === undefined ? '—' : formatBitrate(b.down)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <ArrowUpIcon className="size-4 text-chart-1" />
                <span className="text-xl font-semibold tabular">{b.up === undefined ? '—' : formatBitrate(b.up)}</span>
              </div>
            </div>
            <Sparkline
              values={b.history}
              max={peak}
              slots={HISTORY}
              className="h-8"
              label="Down + up"
              format={formatBitrate}
              timeOf={(slot) => Date.now() / 1000 - ((HISTORY - 1 - slot) * POLL_MS) / 1000}
            />
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              <Stat label="Devices">
                {b.clients}
                {b.guests !== undefined && <span className="block text-xs font-normal text-muted-foreground">{b.guests} on guest</span>}
              </Stat>
              <Stat label="Weakest signal">
                {b.weakest === undefined ? '—' : `${String(b.weakest.signal)} dBm`}
                {b.weakest !== undefined && <span className="block truncate text-xs font-normal text-muted-foreground">{b.weakest.name}</span>}
              </Stat>
              <Stat label="Airtime used">{b.airtime === undefined ? '—' : formatPercent(b.airtime)}</Stat>
              <Stat label="Noise">{b.noise === undefined ? '—' : `${String(b.noise)} dBm`}</Stat>
              <Stat label="Transmit power">{b.txpower === undefined ? '—' : `${String(b.txpower)} dBm`}</Stat>
              <Stat label="Since Wi-Fi started">
                {b.sent === undefined || b.received === undefined ? (
                  '—'
                ) : (
                  <>
                    <span className="block">↓ {formatBytes(b.sent)}</span>
                    <span className="block">↑ {formatBytes(b.received)}</span>
                  </>
                )}
              </Stat>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** One card per band, live; nothing until the first answer. */
export function WifiLive(): ReactElement | null {
  const bands = useWifiLive();
  if (bands === undefined || bands.length === 0) return null;
  const order = (band: string): number => ['2g', '5g', '6g'].indexOf(band);
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      {[...bands]
        .sort((a, b) => order(a.band) - order(b.band))
        .map((b) => (
          <BandCard key={b.radio} b={b} />
        ))}
    </div>
  );
}
