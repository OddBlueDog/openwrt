// A device's side sheet, opened from its row: how it's connected now, its
// name and reserved address (a DHCP host section), and where to block it or
// see its data usage.
import { type ReactElement, useState } from 'react';
import { InfoRow } from '@/components/card-heading';
import { SignalReading } from '@/components/charts/signal-bars';
import { EditorSheet } from '@/components/editor-sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Change } from '@/lib/api/uci';
import { formatBitrate, formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { DialogField, SwitchRow } from '../firewall/parts';
import { GoLink } from '@/components/page-kit';
import type { ClientsData, Device } from './api';
import { connectionText, deviceLabel, editChanges, nameError, reservedIp, reserveError } from './model';

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
  const [name, setName] = useState(device.name ?? '');
  const [reserve, setReserve] = useState(reservedIp(device.reservation) !== undefined);
  const [ip, setIp] = useState(device.ip ?? '');
  const ipError = reserve ? reserveError(ip, device.mac, data) : undefined;
  const badName = nameError(name);

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
          <Button
            disabled={ipError !== undefined || badName !== undefined}
            onClick={() => {
              onSave(editChanges(device.reservation?.['.name'], device.mac, name, reserve, ip));
            }}
          >
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
      </section>
      <div className="flex flex-col gap-5 border-t px-6 py-5">
        <DialogField
          id="dev-name"
          label="Name"
          hint="Shown on these pages; your other devices can reach it by this name too."
          error={badName}
        >
          <Input
            id="dev-name"
            value={name}
            placeholder="e.g. living-room-tv"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={badName !== undefined}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </DialogField>
        <SwitchRow
          id="dev-reserve"
          checked={reserve}
          onChange={setReserve}
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
        {reserve && (
          <DialogField id="dev-ip" label="IP address" error={ipError}>
            <Input
              id="dev-ip"
              value={ip}
              className="font-mono"
              inputMode="decimal"
              autoComplete="off"
              aria-invalid={ipError !== undefined}
              onChange={(e) => {
                setIp(e.target.value.trim());
              }}
            />
          </DialogField>
        )}
      </div>
      {links && (
        <section aria-labelledby="dev-more" className="flex flex-col gap-3 border-t px-6 py-5">
          <h3 id="dev-more" className="text-sm font-medium">
            More for this device
          </h3>
          <div className="flex flex-col gap-1">
            <GoLink href={`${href('data-statistics')}/${device.mac}`}>Its data usage</GoLink>
            <p className="text-xs text-muted-foreground">What it has downloaded and uploaded this period.</p>
          </div>
          <div className="flex flex-col gap-1">
            <GoLink href={href('firewall')}>Block it from the internet</GoLink>
            <p className="text-xs text-muted-foreground">On the Firewall page, under Block a device: always, or at set times.</p>
          </div>
        </section>
      )}
    </EditorSheet>
  );
}
