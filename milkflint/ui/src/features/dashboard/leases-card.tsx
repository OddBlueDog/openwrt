// The DHCP leases as a widget: a count as a tile, or the same table the LAN & DHCP page's Addresses tab draws
// (its columns, compact), as many rows as the widget has room for.
import { lanQueries } from '../lan/queries';
import { useLive } from '@/lib/query/use-live';
import type { ReactElement } from 'react';
import { DataTable } from '@/components/data-table';
import { formatNumber } from '@/lib/format';
import { pageLink, tabLink } from '@/lib/router';
import { columns4, columns6, RELAY_LINE } from '../lan/leases';
import type { LanTab } from '../lan/leases';
import type { Size } from './layout';
import { OffNote, Widget, WidgetLink } from './widget';
import { Tile } from './tiles';

/** At most how many leases it lists at one row tall, and at two (fewer where they don't fit). */
const SHOWN = { 1: 4, 2: 8 } as const;

const ADDRESSES = tabLink<LanTab>('lan', 'addresses', 'settings');

export function LeasesCard({ family, size }: { family: 'v4' | 'v6'; size: Size }): ReactElement {
  const { data, error } = useLive(lanQueries.leases());
  const v4 = family === 'v4';
  const title = v4 ? 'IPv4 leases' : 'IPv6 leases';
  const link = <WidgetLink to={ADDRESSES}>Details</WidgetLink>;
  // leases only: a device seen with SLAAC addresses alone has none
  const rows = data === undefined ? undefined : data[family].filter((r) => r.addrs.length > 0);

  // IPv6 leases only exist where this router serves DHCPv6
  const state = v4 || data === undefined || data.dhcpv6 === 'server' ? undefined : data.dhcpv6;
  if (size.w === 1 && size.h === 1) {
    return (
      <Tile
        route="lan"
        to={ADDRESSES}
        tone={undefined}
        value={
          state !== undefined
            ? state === 'relay'
              ? 'Relayed'
              : 'Off'
            : rows === undefined
              ? error === undefined
                ? '…'
                : '–'
              : formatNumber(rows.length)
        }
        lines={state !== undefined || rows === undefined ? [] : [rows.length === 1 ? 'lease' : 'leases']}
        times={[]}
      />
    );
  }
  if (rows === undefined) {
    return (
      <Widget>
        {error === undefined ? (
          <p className="px-5 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <OffNote action={<WidgetLink to={pageLink('lan')}>LAN & DHCP</WidgetLink>}>
            The router didn’t say who has a lease.
          </OffNote>
        )}
      </Widget>
    );
  }
  return (
    <Widget status={rows.length === 0 ? undefined : `${formatNumber(rows.length)} in all`} aside={link}>
      {rows.length === 0 && state !== undefined ? (
        <OffNote action={<WidgetLink to={pageLink('ipv6')}>IPv6</WidgetLink>}>
          {state === 'relay' ? RELAY_LINE : 'The DHCPv6 server is off.'}
        </OffNote>
      ) : (
        <div className="px-5">
          <DataTable
            label={title}
            columns={v4 ? columns4 : columns6}
            rows={rows}
            rowKey={(r) => r.key}
            empty={v4 ? 'No device has an IPv4 lease.' : 'No device has an IPv6 lease.'}
            compact
            fit
            limit={SHOWN[size.h]}
          />
        </div>
      )}
    </Widget>
  );
}
