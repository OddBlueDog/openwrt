// The Addresses tab: who holds an address from the router now, IPv4 from
// DHCP and IPv6 from DHCPv6, with the IPv6 addresses devices picked
// themselves (SLAAC) that the router has seen, refreshed every 30 s.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import type { ReactElement } from 'react';
import { LoadError } from '@/components/page-states';
import { DataTable } from '@/components/data-table';
import { useLive } from '@/lib/query/use-live';
import { columns4, columns6, RELAY_LINE } from './leases';
import { lanQueries } from './queries';

export const SLAAC_LINE =
  'SLAAC addresses are the ones the router has seen in use lately: a quiet device drops off the list, and phones change their private addresses about once a day, so one device can have several.';

function Heading({ title, children }: { title: string; children: string }): ReactElement {
  return (
    <div>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function AddressesTab(): ReactElement {
  const { data, error, loading, refresh } = useLive(lanQueries.leases());
  if (data === undefined) {
    return loading ? <p className="text-sm text-muted-foreground">Reading…</p> : <LoadError error={error} retry={refresh} />;
  }
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <Heading title="IPv4 leases">Addresses the router's DHCP server has handed out.</Heading>
        <DataTable
          label="IPv4 leases"
          columns={columns4}
          rows={data.v4}
          rowKey={(r) => r.key}
          empty="No device holds an IPv4 lease right now."
        />
      </section>
      <section className="flex flex-col gap-2">
        <Heading title="IPv6 addresses">
          Addresses handed out by DHCPv6, and those devices picked themselves (SLAAC), as many phones do.
        </Heading>
        <DataTable
          label="IPv6 addresses"
          columns={columns6}
          rows={data.v6}
          rowKey={(r) => r.key}
          empty="No device holds a DHCPv6 lease or has been seen with an IPv6 address right now."
        />
        <p className="text-sm text-muted-foreground">{SLAAC_LINE}</p>
        {data.dhcpv6 === 'relay' && <p className="text-sm text-muted-foreground">{RELAY_LINE}</p>}
        {data.dhcpv6 === 'off' && (
          <p className="text-sm text-muted-foreground">
            The DHCPv6 server is off, so only addresses devices picked themselves are listed. It's set on{' '}
            <Link {...pageLink('ipv6')} className="font-medium link">
              IPv6
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  );
}
