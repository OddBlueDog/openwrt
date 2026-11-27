// The router's tracked connections as a widget: the total as a tile, or the busiest devices in a table drawn
// from the same model as the LAN & DHCP page's Connections tab.
import { dashboardQueries } from './queries';
import { useLive } from '@/lib/query/use-live';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { DataTable } from '@/components/data-table';
import { formatNumber } from '@/lib/format';
import { pageLink, tabLink } from '@/lib/router';
import { cutText, deviceColumns, pollDelay } from '../lan/connections';
import type { LanTab } from '../lan/leases';
import type { Size } from './layout';
import { OffNote, Widget, WidgetLink } from './widget';
import { Tile } from './tiles';

/** At most how many devices it lists at one row tall, and at two (fewer where they don't fit). */
const SHOWN = { 1: 4, 2: 8 } as const;

const CONNECTIONS = tabLink<LanTab>('lan', 'connections', 'settings');

export function ConnectionsCard({ size }: { size: Size }): ReactElement {
  const { data, error } = useLive(dashboardQueries.connections((last) => pollDelay(10_000, last?.c.cost_ms)));
  const link = <WidgetLink to={CONNECTIONS}>Details</WidgetLink>;

  if (size.w === 1 && size.h === 1) {
    return (
      <Tile
        route="lan"
        to={CONNECTIONS}
        tone={undefined}
        value={data === undefined ? (error === undefined ? '…' : '–') : formatNumber(data.c.total)}
        lines={data === undefined ? [] : [`IPv4 ${formatNumber(data.c.family.ipv4)} · IPv6 ${formatNumber(data.c.family.ipv6)}`]}
        times={[]}
      />
    );
  }
  if (data === undefined) {
    return (
      <Widget>
        {error === undefined ? (
          <p className="px-5 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <OffNote action={link}>The router didn’t say what it’s tracking.</OffNote>
        )}
      </Widget>
    );
  }
  const limit = SHOWN[size.h];
  const shown = Math.min(limit, data.devices.length);
  const cut = cutText(shown, data.devices.length - shown);
  return (
    <Widget status={`${formatNumber(data.c.total)} tracked`} aside={link}>
      <div className="px-5">
        <DataTable
          label="Busiest devices"
          columns={deviceColumns}
          rows={data.devices}
          rowKey={(d) => d.key}
          empty={
            <>
              No connections are tracked.{' '}
              <Link className="link" {...pageLink('lan')}>
                LAN & DHCP
              </Link>
            </>
          }
          compact
          fit
          limit={limit}
        />
      </div>
      {cut !== '' && (
        <p data-fit className="px-5 text-sm text-muted-foreground">
          {cut}
        </p>
      )}
    </Widget>
  );
}
