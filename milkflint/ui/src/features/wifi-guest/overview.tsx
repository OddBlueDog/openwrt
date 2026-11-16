// Guest Wi-Fi's opening answer: each guest network, on or off, the name it
// broadcasts on which bands, the devices on it now and the QR code to join
// it. With more than one, a row picks the network whose settings show below.
import { type ReactElement, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { QrCode } from '@/components/qr-code';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { wifiQrText } from '@/lib/qr';
import { cn } from '@/lib/utils';
import type { Guest } from './api';
import type { GuestId } from './guest';
import { type JoinCode, joinCodes, labelOf, type NetForm, networkSummary, type Radio } from './model';

/** The QR code to join, small, opening a larger one (one per band when the bands differ). */
function JoinButton({ label, codes }: { label: string; codes: readonly JoinCode[] }): ReactElement | null {
  const [open, setOpen] = useState(false);
  const first = codes[0];
  if (first === undefined) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        aria-label={`Show the QR code to join ${label}`}
        className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-card p-1 pr-3 text-sm font-medium transition-colors duration-fast hover:border-primary"
      >
        <span className="rounded-md bg-white p-0.5" aria-hidden>
          <QrCode text={wifiQrText(first.ssid, first.encryption, first.password)} label="QR code" className="block size-10" />
        </span>
        Join
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Join {label} with a camera</DialogTitle>
            <DialogDescription>Point a phone’s camera at the code to join without typing the password.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap justify-center gap-6">
            {codes.map((c) => (
              <figure key={c.key} className="flex flex-col items-center gap-1.5">
                <QrCode
                  text={wifiQrText(c.ssid, c.encryption, c.password)}
                  label={`QR code to join ${c.ssid}`}
                  className="size-56 rounded-lg border bg-white p-1"
                />
                <figcaption className="text-xs text-muted-foreground">
                  {c.band === undefined ? c.ssid : `${c.ssid} · ${c.band}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function devicesText(guests: readonly Guest[] | undefined, on: boolean): string {
  if (!on) return 'Off the air';
  if (guests === undefined) return '…';
  return guests.length === 0 ? 'No devices now' : `${String(guests.length)} device${guests.length === 1 ? '' : 's'} now`;
}

export function GuestOverview({
  forms,
  saved,
  radios,
  guests,
  selected,
  onSelect,
}: {
  /** As edited: new networks not saved yet among them. */
  forms: readonly NetForm[];
  /** As on the router: what's on air, and what its code joins. */
  saved: readonly NetForm[];
  radios: readonly Radio[];
  /** The devices on each network now; undefined until the first look. */
  guests: Record<GuestId, readonly Guest[]> | undefined;
  selected: GuestId | undefined;
  onSelect: (id: GuestId) => void;
}): ReactElement {
  const choosing = forms.length > 1;
  return (
    <Card className="gap-0 pb-0">
      <CardHeading
        title={forms.length === 1 ? 'Your guest network' : 'Your guest networks'}
        description={
          choosing ? 'On the air now, with its devices. Pick one for its settings below.' : 'On the air now, with its devices.'
        }
      />
      <ul className="mt-4 divide-y border-t">
        {forms.map((f) => {
          const was = saved.find((s) => s.id === f.id);
          const shown = was ?? f;
          const label = labelOf(f);
          const status =
            was === undefined ? (
              <Badge variant="info">Not saved yet</Badge>
            ) : was.enabled ? (
              <Badge variant="success">On</Badge>
            ) : (
              <Badge variant="outline">Off</Badge>
            );
          const body = (
            <>
              <span className="flex min-w-0 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{label}</span>
                  {status}
                </span>
                <span className="text-sm break-words text-muted-foreground sm:truncate">{networkSummary(shown, radios)}</span>
              </span>
              <span className="text-sm tabular sm:text-right">
                {was === undefined ? 'Saving sets it up' : devicesText(guests?.[f.id], was.enabled)}
              </span>
            </>
          );
          const isSelected = choosing && f.id === selected;
          return (
            <li
              key={f.id}
              className={cn(
                'flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:flex-nowrap',
                isSelected && 'bg-primary-subtle',
              )}
            >
              {choosing ? (
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    onSelect(f.id);
                  }}
                  className="-my-1 grid min-w-0 flex-1 cursor-pointer gap-1 rounded-md py-1 text-left sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4"
                >
                  {body}
                </button>
              ) : (
                <div className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_10rem] sm:items-center sm:gap-4">
                  {body}
                </div>
              )}
              {was !== undefined && <JoinButton label={label} codes={joinCodes(was, radios)} />}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
