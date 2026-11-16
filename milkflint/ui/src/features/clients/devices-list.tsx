// The devices as a table on a wide screen and a card each on a phone, with
// the same facts and the same action: a click on a row (or its edit button)
// opens the device's side sheet; on a phone, its edit button.
import { CableIcon, MonitorSmartphoneIcon, PinIcon, SquarePenIcon, WifiIcon } from 'lucide-react';
import type { MouseEvent, ReactElement } from 'react';
import { SignalReading } from '@/components/charts/signal-bars';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatBitrate, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { rowClick } from '../firewall/forms';
import { HeadRow, RowButton } from '../firewall/table-parts';
import type { Device } from './api';
import { connectionText, deviceLabel, reservedIp } from './model';

const columns = [
  { label: 'Device', className: 'pl-5' },
  { label: 'Connection' },
  { label: 'Signal' },
  { label: 'Link speed', className: 'text-right' },
  { label: 'Connected', className: 'text-right' },
  { label: 'Edit', className: 'w-14 pr-4', hidden: true },
] as const;

function KindIcon({ d }: { d: Device }): ReactElement {
  const Icon = d.wifi !== undefined ? WifiIcon : d.online ? CableIcon : MonitorSmartphoneIcon;
  return <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Its name (or that it has none) and whether its address is reserved. */
function Name({ d }: { d: Device }): ReactElement {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cn('truncate font-medium', d.name === undefined && 'font-normal text-muted-foreground')}>
        {deviceLabel(d.name)}
      </span>
      {reservedIp(d.reservation) !== undefined && (
        <Badge variant="secondary" className="h-5 gap-1 px-2 font-normal">
          <PinIcon /> Reserved
        </Badge>
      )}
    </span>
  );
}

/** Online on Wi-Fi or a cable, or offline, in words with a dot. */
function Connection({ d }: { d: Device }): ReactElement {
  return (
    <span className={cn('flex min-w-0 items-center gap-2', !d.online && 'text-muted-foreground')}>
      <span
        aria-hidden="true"
        className={cn('size-2 shrink-0 rounded-full', d.online ? 'bg-success' : 'border border-muted-foreground')}
      />
      <span className="truncate">{connectionText(d)}</span>
    </span>
  );
}

function Address({ d }: { d: Device }): ReactElement {
  return (
    <span className="text-xs break-all text-muted-foreground">
      {d.ip === undefined ? 'no address' : <span className="font-mono">{d.ip}</span>} · <span className="font-mono">{d.mac}</span>
    </span>
  );
}

export function DevicesList({
  devices,
  busy,
  onEdit,
}: {
  devices: readonly Device[];
  busy: boolean;
  onEdit: (mac: string) => void;
}): ReactElement {
  const edit = (d: Device): ReactElement => (
    <RowButton
      label={`Edit ${d.name ?? d.mac}`}
      icon={SquarePenIcon}
      disabled={busy}
      onClick={() => {
        onEdit(d.mac);
      }}
    />
  );
  const open = (d: Device): ((e: MouseEvent<HTMLElement>) => void) =>
    rowClick(() => {
      if (!busy) onEdit(d.mac);
    });
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {/* wide screens: a table */}
      <div className="hidden lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b">
            <HeadRow columns={columns} />
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr
                key={d.mac}
                onClick={open(d)}
                className="cursor-pointer border-b transition-colors duration-fast last:border-b-0 hover:bg-muted/60"
              >
                <td className="w-2/5 max-w-0 py-2.5 pr-3 pl-5">
                  <span className="flex min-w-0 items-center gap-3">
                    <KindIcon d={d} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <Name d={d} />
                      <Address d={d} />
                    </span>
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  <Connection d={d} />
                </td>
                <td className="px-3 py-2.5">
                  {d.wifi === undefined ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <SignalReading dbm={d.wifi.signal} snr={d.wifi.snr} />
                  )}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap tabular">
                  {d.wifi?.rate === undefined ? '—' : formatBitrate(d.wifi.rate)}
                </td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap text-muted-foreground tabular">
                  {d.wifi?.connected === undefined ? '—' : formatDuration(d.wifi.connected)}
                </td>
                <td className="py-1.5 pr-4 pl-2 text-right">{edit(d)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* phones and narrow windows: a card per device */}
      <ul className="divide-y lg:hidden">
        {devices.map((d) => (
          <li key={d.mac} className="flex flex-col gap-2 px-4 py-3">
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-2.5 pt-1">
                <KindIcon d={d} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <Name d={d} />
                  <Address d={d} />
                </span>
              </span>
              <span className="-mr-1 shrink-0">{edit(d)}</span>
            </span>
            <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 pl-6.5 text-sm">
              <Connection d={d} />
              {d.wifi !== undefined && <SignalReading dbm={d.wifi.signal} snr={d.wifi.snr} />}
            </span>
            {d.wifi !== undefined && (d.wifi.rate !== undefined || d.wifi.connected !== undefined) && (
              <span className="flex flex-wrap gap-x-4 pl-6.5 text-xs text-muted-foreground tabular">
                {d.wifi.rate !== undefined && <span>Link {formatBitrate(d.wifi.rate)}</span>}
                {d.wifi.connected !== undefined && <span>Connected {formatDuration(d.wifi.connected)}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
