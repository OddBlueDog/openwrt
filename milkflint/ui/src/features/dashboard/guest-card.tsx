// Guest Wi-Fi on Home: the guest networks in name order, one at a time at
// one column wide and two side by side wider, with arrows to the others. Each
// says whether it's on, its Wi-Fi name and the devices on it now, with its
// password behind "Show" (a secret on screen) and its join code a press away.
// Reads the networks' settings once, and their devices every 30 s, only while
// it's on Home.
import { dashboardQueries } from './queries';
import { useLive } from '@/lib/query/use-live';
import { useRead } from '@/lib/query/use-read';
import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, ChevronRightIcon, EyeIcon, EyeOffIcon, QrCodeIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { QrCode } from '@/components/qr-code';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatNumber } from '@/lib/format';
import { wifiQrText } from '@/lib/qr';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { type GuestData, joinCodes } from '../wifi-guest/model';
import { Dot, OffNote, StateBadge, Widget, WidgetLink } from './widget';
import { useWidgetInfo } from './widget-info';

// one call for every Guest Wi-Fi widget on Home

type Net = GuestData['nets'][number];
type Code = ReturnType<typeof joinCodes>[number];

/** The networks in the order of their names, as people read a list. */
function byName(nets: readonly Net[]): Net[] {
  return [...nets].sort((a, b) => a.form.label.localeCompare(b.form.label, undefined, { numeric: true, sensitivity: 'base' }));
}

export function GuestCard(): ReactElement {
  const { data, error } = useRead(dashboardQueries.guest());
  const { data: guests } = useLive(dashboardQueries.guestDevices());
  // one at a time in one column; two side by side wider
  const page = useWidgetInfo().size.w === 1 ? 1 : 2;
  const [start, setStart] = useState(0);
  const [joining, setJoining] = useState<{ label: string; code: Code }>();
  const link = <WidgetLink to={pageLink('wifi-guest')}>Guest Wi-Fi</WidgetLink>;
  if (data === undefined) {
    return (
      <Widget aside={error === undefined ? undefined : link}>
        <OffNote action={null}>
          {error === undefined ? 'Reading the guest networks…' : 'The guest networks’ settings didn’t load.'}
        </OffNote>
      </Widget>
    );
  }
  const nets = byName(data.nets);
  if (nets.length === 0) {
    return (
      <Widget aside={<StateBadge tone="off">None</StateBadge>}>
        <OffNote action={<WidgetLink to={pageLink('wifi-guest')}>Set one up</WidgetLink>}>
          A network of its own for visitors, kept apart from your devices.
        </OffNote>
      </Widget>
    );
  }
  // a network removed elsewhere: back to a page there is
  const first = Math.min(start, Math.max(0, nets.length - page));
  const shown = nets.slice(first, first + page);
  const paged = nets.length > page;
  const last = first + shown.length;
  return (
    <Widget
      status={
        paged
          ? `${shown.length === 1 ? String(last) : `${String(first + 1)}–${String(last)}`} of ${String(nets.length)}`
          : nets.length === 1
            ? undefined
            : `${String(nets.length)} networks`
      }
      aside={
        paged ? (
          <span className="flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={page === 1 ? 'The guest network before' : 'The guest networks before'}
              disabled={first === 0}
              onClick={() => {
                setStart(Math.max(0, first - page));
              }}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label={page === 1 ? 'The next guest network' : 'The next guest networks'}
              disabled={last >= nets.length}
              onClick={() => {
                setStart(Math.min(nets.length - page, first + page));
              }}
            >
              <ChevronRightIcon />
            </Button>
          </span>
        ) : (
          link
        )
      }
    >
      <ul className={cn('grid flex-1 px-5', page === 2 && 'grid-cols-2 gap-x-6 divide-x [&>li+li]:pl-6')}>
        {shown.map((net) => (
          <Network
            key={net.form.id}
            net={net}
            code={joinCodes(net.form, data.radios)[0]}
            devices={guests?.[net.form.id].length}
            onJoin={(code) => {
              setJoining({ label: net.form.label, code });
            }}
          />
        ))}
      </ul>
      <Dialog
        open={joining !== undefined}
        onOpenChange={(open) => {
          if (!open) setJoining(undefined);
        }}
      >
        <DialogContent>
          {joining !== undefined && (
            <>
              <DialogHeader>
                <DialogTitle>Join {joining.label} with a camera</DialogTitle>
                <DialogDescription>Point a phone’s camera at it to join {joining.code.ssid}.</DialogDescription>
              </DialogHeader>
              <div className="flex justify-center">
                <QrCode
                  text={wifiQrText(joining.code.ssid, joining.code.encryption, joining.code.password)}
                  label={`QR code to join ${joining.code.ssid}`}
                  className="size-60 rounded-lg border p-1"
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </Widget>
  );
}

/** One guest network: its name and state, its Wi-Fi name and devices, and its password and join code. */
function Network({
  net,
  code,
  devices,
  onJoin,
}: {
  net: Net;
  code: Code | undefined;
  devices: number | undefined;
  onJoin: (code: Code) => void;
}): ReactElement {
  const [shown, setShown] = useState(false);
  const f = net.form;
  const open = code?.encryption === 'none';
  return (
    <li className="flex min-w-0 flex-col gap-2 text-sm">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <Link {...pageLink('wifi-guest')} className="truncate text-base font-semibold link" title={f.label}>
          {f.label}
        </Link>
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Dot tone={f.enabled ? 'success' : 'off'} />
          {f.enabled ? 'On' : 'Off'}
        </span>
      </div>
      <p className="truncate text-muted-foreground" title={code?.ssid}>
        {code?.ssid ?? (f.enabled ? 'Not on the air' : 'Off the air')}
        {f.enabled && ` · ${devices === undefined ? '…' : `${formatNumber(devices)} device${devices === 1 ? '' : 's'}`}`}
      </p>
      {code !== undefined && (
        <div className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-mono">{open ? 'No password' : shown ? code.password : '••••••••'}</span>
          {!open && (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0"
              aria-label={shown ? `Hide ${f.label}’s password` : `Show ${f.label}’s password`}
              aria-pressed={shown}
              title={shown ? 'Hide' : 'Show'}
              onClick={() => {
                setShown((s) => !s);
              }}
            >
              {shown ? <EyeOffIcon /> : <EyeIcon />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={`QR code to join ${f.label}`}
            title="Join with a camera"
            onClick={() => {
              onJoin(code);
            }}
          >
            <QrCodeIcon />
          </Button>
        </div>
      )}
    </li>
  );
}
