// The Firewall page's opening answer, in plain words from the live config:
// whether the internet can start connections to the router and to your
// devices, and whose rules there are.
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { pageLink, type PageLink } from '@/lib/router';
import type { FirewallData } from './api';
import { zoneTitle } from './model';
import { firewallSummary, namesText, plural, type Reach } from './summary';

function Cell({
  title,
  status,
  children,
  link,
}: {
  title: string;
  status: ReactNode;
  children: ReactNode;
  link?: { to: PageLink; label: string };
}): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-2 p-5">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="flex min-h-6 items-center">{status}</div>
      <p className="text-sm text-foreground">{children}</p>
      {link !== undefined && (
        <Link {...link.to} className="mt-auto inline-flex w-fit items-center gap-0.5 text-sm font-medium link underline-offset-4">
          {link.label}
          <ChevronRightIcon className="size-4" />
        </Link>
      )}
    </div>
  );
}

const reachBadge: Record<Reach, ReactElement> = {
  closed: <Badge variant="success">Closed</Badge>,
  some: <Badge variant="info">Partly open</Badge>,
  open: <Badge variant="destructive">Open</Badge>,
};

const openwrtTail = (n: number): string => (n === 0 ? '.' : `, apart from ${plural(n, 'standard rule')} from OpenWrt.`);

export function FirewallAnswer({ data, upnp }: { data: FirewallData; upnp: number }): ReactElement {
  const s = firewallSummary(data.cfg, data.upnp === true ? upnp : 0);
  const zones = pageLink('firewall', 'zones');
  const { router, devices, rules } = s;

  const routerText =
    router.reach === 'open'
      ? 'The internet zone accepts every connection to the router (its input policy), its login included.'
      : router.reach === 'some'
        ? `Open through ${new Intl.ListFormat('en-GB').format(
            [
              router.opened.length > 0 ? namesText(router.opened) : undefined,
              router.forwards > 0 ? plural(router.forwards, 'port forward') : undefined,
            ].filter((x) => x !== undefined),
          )}${openwrtTail(router.openwrt)}`
        : `Nothing on the internet can start a connection to it${openwrtTail(router.openwrt)}`;

  const opened = [
    devices.forwards > 0 ? plural(devices.forwards, 'port forward') : undefined,
    devices.upnp > 0 ? `${plural(devices.upnp, 'port')} opened by devices (UPnP)` : undefined,
    devices.opened.length > 0 ? `${plural(devices.opened.length, 'rule')} (${namesText(devices.opened)})` : undefined,
  ].filter((x) => x !== undefined);
  const devicesText =
    devices.reach === 'open'
      ? `Any connection from the internet may go on to ${new Intl.ListFormat('en-GB').format(devices.zones.map((z) => zoneTitle(z, data.cfg)))}.`
      : devices.reach === 'some'
        ? `Open through ${new Intl.ListFormat('en-GB').format(opened)}${devices.dmz ? ', one of them every port (DMZ)' : ''}.`
        : `Only replies to what they started get in${openwrtTail(devices.openwrt)}`;

  const extra = [
    rules.page > 0 ? `${String(rules.page)} made by other MilkFlint pages` : undefined,
    rules.off > 0 ? `${String(rules.off)} turned off` : undefined,
    rules.blocks > 0 ? `${plural(rules.blocks, 'device')} blocked from the internet` : undefined,
  ].filter((x) => x !== undefined);

  return (
    <Card className="gap-0 py-0">
      <div className="grid divide-y md:grid-cols-3 md:divide-x md:divide-y-0">
        <Cell
          title="The router, from the internet"
          status={reachBadge[router.reach]}
          {...(router.reach === 'open' ? { link: { to: zones, label: 'Zones' } } : {})}
        >
          {routerText}
        </Cell>
        <Cell
          title="Your devices, from the internet"
          status={
            devices.dmz && devices.reach !== 'open' ? (
              <Badge variant="warning">Every port to one device</Badge>
            ) : (
              reachBadge[devices.reach]
            )
          }
          {...(devices.reach === 'open' ? { link: { to: zones, label: 'Zones' } } : {})}
        >
          {devicesText}
        </Cell>
        <Cell
          title="Rules"
          status={
            <span className="text-sm font-medium tabular">
              {rules.own === 0 ? 'None of yours' : `${String(rules.own)} of yours`} · {String(rules.openwrt)} from OpenWrt
            </span>
          }
        >
          {extra.length > 0
            ? `${extra.join(' · ')}.`
            : rules.own === 0
              ? 'Add one below, or block a device from the internet.'
              : 'Each chain checks its rules in order; the first that matches decides.'}
        </Cell>
      </div>
    </Card>
  );
}
