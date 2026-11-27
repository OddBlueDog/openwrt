// The VPN pages on Home: Send through a VPN (its tunnel, wg_out) and Remote
// access (wg_in, a peer per device). Both read WireGuard's live state, only
// while they're on Home, every 10 s; Remote access reads its devices' names
// once.
import { dashboardQueries } from './queries';
import { useLive } from '@/lib/query/use-live';
import { useRead } from '@/lib/query/use-read';
import type { ReactElement } from 'react';
import { isConnected, splitEndpoint, type Tunnel, type WgInterface } from '@/lib/api/wireguard';
import { formatBytes, formatDurationShort, formatNumber } from '@/lib/format';
import { pageLink } from '@/lib/router';
import { tunnelLine } from '../vpn-client/model';
import { SERVER } from '../remote-access/sections';
import { CLIENT } from '../vpn-client/sections';
import { cn } from '@/lib/utils';
import { EMPTY_GOES } from './fit';
import { Dot, OffNote, StateBadge, Way, Widget, WidgetLink } from './widget';

// one call for the VPN and Remote access widgets (and any repeat of either): they read the same status

function useTunnel(name: string): {
  iface: WgInterface | undefined;
  now: number;
  ready: boolean;
  failed: boolean;
  tunnel: Tunnel | null;
} {
  const { data, error } = useLive(dashboardQueries.tunnels());
  return {
    iface: data?.interfaces.find((i) => i.name === name),
    now: data?.now ?? 0,
    tunnel: data?.tunnel ?? null,
    ready: data !== undefined,
    failed: data === undefined && error !== undefined,
  };
}

const ago = (now: number, t: number): string => (t <= 0 ? 'never' : `${formatDurationShort(Math.max(0, now - t))} ago`);

function Row({ label, children }: { label: string; children: ReactElement | string }): ReactElement {
  return (
    <div data-fit className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular">{children}</dd>
    </div>
  );
}

export function VpnCard(): ReactElement {
  const { iface, now, ready, failed, tunnel } = useTunnel(CLIENT);
  // the kill switch is network.wg_out_kill, there and not disabled
  const kill = useRead(dashboardQueries.vpnKillSwitch()).data === true;
  const link = <WidgetLink to={pageLink('vpn-client')}>VPN</WidgetLink>;
  if (!ready) {
    return (
      <Widget aside={failed ? link : undefined}>
        <OffNote action={null}>{failed ? 'The router didn’t say how its VPN is.' : 'Reading the VPN’s state…'}</OffNote>
      </Widget>
    );
  }
  const peer = iface?.peers[0];
  if (iface === undefined || peer === undefined) {
    return (
      <Widget aside={<StateBadge tone="off">Off</StateBadge>}>
        <OffNote action={<WidgetLink to={pageLink('vpn-client')}>Send through a VPN</WidgetLink>}>
          Sends your devices’ traffic through a VPN provider’s server.
        </OffNote>
      </Widget>
    );
  }
  const up = isConnected(peer, now);
  // a short form of the page's line: when it stopped answering, or that its DNS isn't
  const note = tunnelLine(tunnel, kill, (e) => new Date(e * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  return (
    <Widget
      aside={
        <>
          <StateBadge tone={up ? 'success' : 'warning'}>{up ? 'Connected' : 'Not answering'}</StateBadge>
          {link}
        </>
      }
    >
      <dl className="flex flex-1 flex-col gap-1.5 px-5 text-sm">
        <Row label="Server">{peer.endpoint === null ? 'Not known yet' : splitEndpoint(peer.endpoint).host}</Row>
        <Row label="Last answer">{ago(now, peer.latest_handshake)}</Row>
        {note !== undefined && (
          <p data-fit className="text-muted-foreground">
            {note}
          </p>
        )}
        {/* what went through it since it came up, at the widget's foot */}
        <div data-fit className="mt-auto flex flex-wrap items-baseline justify-between gap-x-3 border-t pt-2">
          <dt className="text-muted-foreground">Through it</dt>
          <dd className="ml-auto flex gap-3 font-medium whitespace-nowrap tabular">
            <span>
              <Way dir="down" /> {formatBytes(peer.rx_bytes)}
            </span>
            <span>
              <Way dir="up" /> {formatBytes(peer.tx_bytes)}
            </span>
          </dd>
        </div>
      </dl>
    </Widget>
  );
}

export function RemoteAccessCard(): ReactElement {
  const { iface, now, ready, failed } = useTunnel(SERVER);
  const { data: names } = useRead(dashboardQueries.peerNames());
  const link = <WidgetLink to={pageLink('remote-access')}>Remote access</WidgetLink>;
  if (!ready) {
    return (
      <Widget aside={failed ? link : undefined}>
        <OffNote action={null}>
          {failed ? 'The router didn’t say how Remote access is.' : 'Reading Remote access’s state…'}
        </OffNote>
      </Widget>
    );
  }
  if (iface === undefined) {
    return (
      <Widget aside={<StateBadge tone="off">Off</StateBadge>}>
        <OffNote action={<WidgetLink to={pageLink('remote-access')}>Set up Remote access</WidgetLink>}>
          Reach your home network from your phone or laptop, wherever you are.
        </OffNote>
      </Widget>
    );
  }
  const peers = iface.peers.map((p) => ({ p, up: isConnected(p, now), name: names?.get(p.public_key) ?? 'A device' }));
  const connected = peers.filter((x) => x.up);
  // connected first, then the most recently seen
  const shown = [...peers].sort((a, b) => (a.up === b.up ? b.p.latest_handshake - a.p.latest_handshake : a.up ? -1 : 1));
  return (
    <Widget
      aside={
        <>
          <StateBadge tone="success">On</StateBadge>
          {link}
        </>
      }
    >
      <div className="flex flex-col px-5">
        <span className="text-xs text-muted-foreground">Connected now</span>
        <span className="text-3xl font-semibold tracking-tight tabular">
          {formatNumber(connected.length)}
          <span className="ml-1 text-base font-normal text-muted-foreground">of {formatNumber(peers.length)}</span>
        </span>
      </div>
      {shown.length > 0 && (
        <ul className={cn('mt-auto flex flex-col gap-1 px-5 text-sm', EMPTY_GOES)} aria-label="Its devices">
          {shown.slice(0, 3).map(({ p, up, name }) => (
            <li key={p.public_key} data-fit className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <Dot tone={up ? 'success' : 'off'} />
                <span className="truncate">{name}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {up ? 'connected' : ago(now, p.latest_handshake)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Widget>
  );
}
