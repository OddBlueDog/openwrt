// The Port forwards page: what the internet can reach at home. It opens on
// the answer (which ports are open to which devices, and whether anything on
// the internet can reach the router at all), then the forwards themselves:
// from the internet, the redirects inside the network, and the ports devices
// opened through UPnP. Opening a port starts from the device, in a side
// sheet. Saves go through the firewall's apply with rollback, as on the
// Firewall page; the hit counts come from the running ruleset.
import { DoorOpenIcon, MonitorIcon, RouterIcon } from 'lucide-react';
import { type ReactElement, useCallback } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { href } from '@/lib/router';
import { type FirewallData, getCounters, getUpnpMappings, getWarnings, loadFirewall, type UpnpMapping } from '../firewall/api';
import { FirewallDialogs } from '../firewall/dialogs';
import type { Actions } from '../firewall/forms';
import { CheckWarnings } from '../firewall/warnings';
import { useFirewallActions } from '../firewall/use-actions';
import { plural } from '../firewall/summary';
import { ForwardsTable } from './forwards-table';
import { type ForwardsSummary, forwardsSummary, headline } from './summary';

/** Whether anything on the internet can reach the router, and what to do when it can't. */
function Reachable({ s }: { s: ForwardsSummary }): ReactElement {
  const address = s.address ?? '';
  const body =
    s.reach === 'public'
      ? {
          badge: <Badge variant="success">Reachable</Badge>,
          text: (
            <>
              The router’s internet address is <span className="font-mono">{address}</span>. Open ports answer there.
            </>
          ),
        }
      : s.reach === 'none'
        ? {
            badge: <Badge variant="secondary">No address</Badge>,
            text: (
              <>
                The router has no IPv4 internet address right now, so nothing from the internet reaches it.{' '}
                <a href={href('internet')} className="font-medium link underline-offset-4">
                  Check the internet connection
                </a>
              </>
            ),
          }
        : s.reach === 'cgnat'
          ? {
              badge: <Badge variant="warning">Not reachable</Badge>,
              text: (
                <>
                  The router’s internet address, <span className="font-mono">{address}</span>, is one your provider shares between
                  customers (CGNAT). Ask them for a public address, or use IPv6 or a VPN service instead.
                </>
              ),
            }
          : {
              badge: <Badge variant="warning">Not reachable</Badge>,
              text: (
                <>
                  The router’s internet address, <span className="font-mono">{address}</span>, is a private one: it’s behind
                  another router, like your provider’s. Forward the same port on that router to this one, or put it in bridge
                  (modem) mode.
                </>
              ),
            };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-muted-foreground">From the internet</h3>
      <div>{body.badge}</div>
      <p className="text-sm text-foreground">{body.text}</p>
    </div>
  );
}

/** The answer: how many ports are open to which devices, and whether the internet can get here at all. */
function Answer({
  data,
  mappings,
  actions,
}: {
  data: FirewallData;
  mappings: readonly UpnpMapping[] | undefined;
  actions: Actions;
}): ReactElement {
  const s = forwardsSummary(data.cfg, data.wanAddress, data.upnp, mappings);
  const name = (ip: string | undefined): string => (ip === undefined ? 'This router' : (data.names.byIp.get(ip) ?? ip));
  const sub = [
    s.forwards > 0 || s.off > 0
      ? `${plural(s.forwards, 'port forward')} on${s.off > 0 ? `, ${String(s.off)} off` : ''}`
      : undefined,
    s.upnp === undefined
      ? data.upnp === undefined
        ? undefined
        : 'UPnP off'
      : `${plural(s.upnp, 'port')} opened by devices (UPnP)`,
  ].filter((x) => x !== undefined);
  return (
    <Card className="gap-0 py-0">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
            <div className="flex min-w-0 flex-col gap-1">
              <h2 className="text-lg font-semibold tracking-tight">{headline(s)}</h2>
              {sub.length > 0 && <p className="text-sm text-muted-foreground">{sub.join(' · ')}</p>}
            </div>
            <Button
              disabled={actions.applying}
              onClick={() => {
                actions.editForward(undefined);
              }}
            >
              <DoorOpenIcon /> Open a port
            </Button>
          </div>
          {s.destinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No port forward is on and no device has opened a port: start one with Open a port.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-lg border">
              {s.destinations.map((d) => (
                <li key={d.ip ?? 'router'} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                  <span className="flex min-w-0 items-center gap-2 sm:w-56 sm:shrink-0">
                    {d.ip === undefined ? (
                      <RouterIcon className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="truncate text-sm font-medium">{name(d.ip)}</span>
                    {d.ip !== undefined && name(d.ip) !== d.ip && (
                      <span className="truncate font-mono text-xs text-muted-foreground">{d.ip}</span>
                    )}
                  </span>
                  <span className="flex min-w-0 flex-wrap gap-1.5">
                    {d.ports.map((p, i) => (
                      <span
                        key={`${p.text}-${String(i)}`}
                        title={p.name}
                        className="inline-flex h-6 items-center gap-1.5 rounded-md border bg-muted/60 px-2 text-xs whitespace-nowrap tabular"
                      >
                        {p.text}
                        {p.upnp && <span className="text-muted-foreground">UPnP</span>}
                      </span>
                    ))}
                    {d.dmz && <Badge variant="warning">DMZ</Badge>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t p-5 lg:border-t-0 lg:border-l">
          <Reachable s={s} />
        </div>
      </div>
    </Card>
  );
}

export function PortForwardsPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadFirewall);
  const counters = usePoll(
    async () => (data === undefined ? undefined : getCounters()),
    10_000,
    data === undefined ? '' : 'loaded',
  );
  const mappings = usePoll(getUpnpMappings, 15_000);
  const warnings = usePoll(getWarnings, 60_000);
  const refreshCounters = counters.refresh;
  const refreshWarnings = warnings.refresh;
  const onApplied = useCallback(() => {
    reload();
    refreshCounters();
    refreshWarnings();
  }, [reload, refreshCounters, refreshWarnings]);
  const { state, actions, dialog, setDialog, save } = useFirewallActions(onApplied);

  return (
    <>
      <PageHeader
        title="Port forwards"
        description="Let something on the internet reach a device at home, such as a game console or a camera."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <CheckWarnings warnings={warnings.data} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          data !== undefined && (
            <>
              <Answer data={data} mappings={mappings.data} actions={actions} />
              <ForwardsTable data={data} counters={counters.data} mappings={mappings.data} actions={actions} />
              <p className="text-sm text-muted-foreground">
                Rules for what may reach the router and your devices are on the{' '}
                <a href={href('firewall')} className="font-medium link underline-offset-4">
                  Firewall
                </a>{' '}
                page.
              </p>
              <FirewallDialogs
                dialog={dialog}
                data={data}
                confirm={actions.confirm}
                onClose={() => {
                  setDialog(undefined);
                }}
                onSave={save}
              />
            </>
          )
        )}
      </div>
    </>
  );
}
