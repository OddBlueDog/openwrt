// A device's side sheet, opened from its row: how it's connected now, its
// name and reserved address (a DHCP host section), its Device control state
// (paused, off until…) with the way there, and its data usage.
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, useMemo, useState } from 'react';
import { DeviceLive } from '@/components/device-live';
import { InfoRow } from '@/components/card-heading';
import { SignalReading } from '@/components/charts/signal-bars';
import { EditorSheet } from '@/components/editor-sheet';
import { Button } from '@/components/ui/button';
import { TextField } from '@/components/form';
import type { Change } from '@/lib/api/uci';
import { formatBitrate, formatDuration } from '@/lib/format';
import { firstSeenText } from '@/lib/api/seen';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { pageLink } from '@/lib/router';
import { SwitchRow } from '../firewall/parts';
import { GoLink } from '@/components/page-kit';
import type { ClientsData, Device } from './api';
import { connectionText, deviceFormSchema, deviceLabel, editChanges, reservedIp } from './model';
import { clientsQueries } from './queries';

export function DeviceSheet({
  device,
  data,
  links,
  onClose,
  onSave,
}: {
  device: Device;
  data: ClientsData;
  /** the Firewall and Data usage pages are there (router mode) */
  links: boolean;
  onClose: () => void;
  onSave: (changes: Change[]) => void;
}): ReactElement {
  const schema = useMemo(() => deviceFormSchema(device.mac, data), [device.mac, data]);
  // what the sheet opened with: the list refreshing under it doesn't change what's being typed
  const [saved] = useState(() => ({
    name: device.name ?? '',
    reserve: reservedIp(device.reservation) !== undefined,
    ip: device.ip ?? '',
  }));
  const settings = useSettingsForm({
    schema,
    saved,
    onSave: (f) => {
      onSave(editChanges(device.reservation?.['.name'], device.mac, f.name, f.reserve, f.ip));
    },
  });
  const { form } = settings;
  const values = useFormValues(form);
  const valid = Object.keys(formErrors(schema, values)).length === 0;
  // when the router first saw it, read once the sheet opens
  const seen = useQuery(clientsQueries.seen()).data;
  const firstSeen = seen === undefined ? undefined : firstSeenText(seen, device.mac);
  // its Device control state, read once the sheet opens (router mode only)
  const control = useQuery({ ...clientsQueries.control(device.mac), enabled: links }).data ?? undefined;

  return (
    <EditorSheet
      title={deviceLabel(device.name)}
      description={<span className="font-mono break-all">{device.mac}</span>}
      onClose={onClose}
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid} onClick={settings.save}>
            Save &amp; apply
          </Button>
        </>
      }
    >
      <section aria-labelledby="dev-now" className="px-6 pt-4 pb-2">
        <h3 id="dev-now" className="sr-only">
          Now
        </h3>
        <InfoRow label="Connection">{connectionText(device)}</InfoRow>
        <InfoRow label="Address">{device.ip === undefined ? 'None yet' : <span className="font-mono">{device.ip}</span>}</InfoRow>
        {device.wifi !== undefined && (
          <>
            <InfoRow label="Signal">
              <SignalReading dbm={device.wifi.signal} snr={device.wifi.snr} empty="—" className="justify-end" />
            </InfoRow>
            <InfoRow label="Link speed">{device.wifi.rate === undefined ? '—' : formatBitrate(device.wifi.rate)}</InfoRow>
            <InfoRow label="Connected for">
              {device.wifi.connected === undefined ? '—' : formatDuration(device.wifi.connected)}
            </InfoRow>
          </>
        )}
        {device.leaseExpires !== undefined && device.leaseExpires > 0 && (
          <InfoRow label="Address lease">{formatDuration(device.leaseExpires)} left</InfoRow>
        )}
        {/* nothing is live for an offline device; in access point mode a wired device's bridged traffic isn't counted */}
        {device.online && (links || device.wifi !== undefined) && (
          <DeviceLive mac={device.mac} link={device.wifi !== undefined ? 'wifi' : 'wired'} />
        )}
        {firstSeen !== undefined && <p className="py-2 text-sm text-muted-foreground">{firstSeen}</p>}
      </section>
      <div className="flex flex-col gap-5 border-t px-6 py-5">
        <form.Field name="name">
          {(field) => (
            <TextField
              field={field}
              id="dev-name"
              label="Name"
              layout="stacked"
              hint="Shown on these pages; your other devices can reach it by this name too."
              placeholder="e.g. living-room-tv"
              autoComplete="off"
              spellCheck={false}
            />
          )}
        </form.Field>
        <SwitchRow
          id="dev-reserve"
          checked={values.reserve}
          onChange={(v) => {
            form.setFieldValue('reserve', v);
          }}
          title="Always give it the same address"
          hint="Handy for port forwards and printers."
          why={
            <>
              A DHCP reservation: a host section in <code className="font-mono">/etc/config/dhcp</code> with its MAC address and{' '}
              <code className="font-mono">ip</code>. The device moves to it when it next renews its address; reconnecting it moves
              it at once.
            </>
          }
        />
        {values.reserve && (
          <form.Field name="ip">
            {(field) => (
              <TextField
                field={field}
                id="dev-ip"
                label="IP address"
                layout="stacked"
                className="font-mono"
                inputMode="decimal"
                autoComplete="off"
                trim
              />
            )}
          </form.Field>
        )}
      </div>
      {links && (
        <section aria-labelledby="dev-more" className="flex flex-col gap-3 border-t px-6 py-5">
          <h3 id="dev-more" className="text-sm font-medium">
            More for this device
          </h3>
          <div className="flex flex-col gap-1">
            <GoLink to={pageLink('data-statistics', device.mac)}>Its data usage</GoLink>
            <p className="text-xs text-muted-foreground">What it has downloaded and uploaded this period.</p>
          </div>
          <div className="flex flex-col gap-1">
            <GoLink to={pageLink('device-control', device.mac)}>
              {control === undefined ? 'When it may use the internet' : 'Device control'}
            </GoLink>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {control === undefined
                ? 'On Device control: a bedtime, school hours, a pause, or blocked always.'
                : `${control.who === undefined ? '' : `${control.who} · `}${control.text}${control.next === undefined ? '' : `. ${control.next}`}.`}
            </p>
          </div>
        </section>
      )}
    </EditorSheet>
  );
}
