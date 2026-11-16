// Beside a guest network's settings: the devices on it now, and what they may
// reach (as the firewall has it, which the Firewall page can change).
import { CheckIcon, XIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { SignalReading } from '@/components/charts/signal-bars';
import { Card, CardContent } from '@/components/ui/card';
import { formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import type { Guest } from './api';
import { type Access, labelOf, type NetForm } from './model';

function Can({ yes, children }: { yes: boolean; children: ReactNode }): ReactElement {
  return (
    <li className="flex items-start gap-2.5 text-sm">
      {yes ? (
        <CheckIcon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
      ) : (
        <XIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span>
        <span className="sr-only">{yes ? 'Can reach: ' : 'Can’t reach: '}</span>
        {children}
      </span>
    </li>
  );
}

/** A guest's address (in mono, an identifier), then its band and time connected. */
function GuestLine({ ip, rest }: { ip: string | undefined; rest: readonly (string | undefined)[] }): ReactElement {
  const words = rest.filter((x) => x !== undefined).join(' · ');
  return (
    <div className="truncate text-xs text-muted-foreground tabular">
      {ip !== undefined && <span className="font-mono">{ip}</span>}
      {ip !== undefined && words !== '' && ' · '}
      {words}
    </div>
  );
}

export function ConnectedNow({ guests, on }: { guests: readonly Guest[] | undefined; on: boolean }): ReactElement {
  return (
    <Card className="gap-0">
      <CardHeading
        title="Connected now"
        status={
          guests === undefined
            ? 'Looking…'
            : guests.length === 0
              ? on
                ? 'No devices right now.'
                : 'This network is off.'
              : `${String(guests.length)} device${guests.length === 1 ? '' : 's'}, strongest first.`
        }
      />
      {guests !== undefined && guests.length > 0 && (
        <ul className="mt-3 divide-y border-t">
          {guests.map((g) => (
            <li key={g.mac} className="flex flex-col gap-0.5 px-5 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{g.name ?? g.mac}</span>
                <SignalReading dbm={g.signal} snr={g.snr} className="shrink-0" />
              </div>
              <GuestLine ip={g.ip} rest={[g.band, g.connected === undefined ? undefined : formatDuration(g.connected)]} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function WhatItGets({
  form,
  access,
  others,
}: {
  form: NetForm;
  access: Access;
  others: readonly NetForm[];
}): ReactElement {
  const limit = [
    form.downMbit === '' ? undefined : `${form.downMbit} Mbit/s down`,
    form.upMbit === '' ? undefined : `${form.upMbit} Mbit/s up`,
  ].filter((x) => x !== undefined);
  const zones = `${href('firewall')}/zones`;
  return (
    <Card>
      <CardHeading title="What its devices get" />
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          <Can yes={access.internet}>
            The internet
            {!access.internet
              ? ': turned off on the Firewall page'
              : limit.length > 0
                ? `, at up to ${limit.join(' and ')} between them`
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
          <Can yes={!form.isolate}>Each other</Can>
        </ul>
        {access.fromLan && (
          <p className="text-xs text-muted-foreground">
            Your devices may reach these, as set on the{' '}
            <a href={zones} className="font-medium link underline-offset-4">
              Firewall page
            </a>
            .
          </p>
        )}
        <p className="border-t pt-3 text-xs text-muted-foreground">
          Set up as OpenWrt’s own guide does it, so it shows in LuCI too: Network → Interfaces ({form.id}), Wireless, Firewall,
          and DHCP and DNS. On the{' '}
          <a href={zones} className="font-medium link underline-offset-4">
            Firewall page
          </a>{' '}
          it’s zone <span className="font-mono">{form.id}</span>.
        </p>
      </CardContent>
    </Card>
  );
}
