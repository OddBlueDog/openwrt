// The VPN pages on Home: Send through a VPN (its tunnel, wg_out) and Remote
// access (wg_in, a peer per device). Both read WireGuard's live state, only
// while they're on Home, every 10 s; Remote access reads its devices' names
// once.
import type { ReactElement } from 'react';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getConfig, str } from '@/lib/api/uci';
import { getWgStatus, isConnected, splitEndpoint, type WgInterface } from '@/lib/api/wireguard';
import { formatBytes, formatDurationShort, formatNumber } from '@/lib/format';
import { href } from '@/lib/router';
import { SERVER } from '../remote-access/sections';
import { CLIENT } from '../vpn-client/sections';
import { sharedCall } from '@/lib/shared-call';
import { cn } from '@/lib/utils';
import { EMPTY_GOES } from './fit';
import { Dot, OffNote, StateBadge, Way, Widget, WidgetLink } from './widget';

const WG_MS = 10_000;

// one call for the VPN and Remote access widgets (and any repeat of either): they read the same status
const readTunnels = sharedCall(getWgStatus);

function useTunnel(name: string): { iface: WgInterface | undefined; now: number; ready: boolean; failed: boolean } {
  const { data, error } = usePoll(readTunnels, WG_MS);
  return {
    iface: data?.interfaces.find((i) => i.name === name),
    now: data?.now ?? 0,
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
  const { iface, now, ready, failed } = useTunnel(CLIENT);
  const link = <WidgetLink href={href('vpn-client')}>VPN</WidgetLink>;
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
        <OffNote action={<WidgetLink href={href('vpn-client')}>Send through a VPN</WidgetLink>}>
          Sends your devices’ traffic through a VPN provider’s server.
        </OffNote>
      </Widget>
    );
  }
  const up = isConnected(peer, now);
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

/** Each device's name on Remote access, by its public key (the page keeps them as the peers' descriptions). */
async function peerNames(): Promise<Map<string, string>> {
  const sections = await getConfig('network');
  return new Map(
    sections
      .filter((s) => s['.type'] === `wireguard_${SERVER}`)
      .flatMap((s) => {
        const key = str(s, 'public_key');
        const name = str(s, 'description');
        return key === undefined || name === undefined ? [] : [[key, name] as const];
      }),
  );
}

// one call for every Remote access widget on Home
const readPeerNames = sharedCall(peerNames);

export function RemoteAccessCard(): ReactElement {
  const { iface, now, ready, failed } = useTunnel(SERVER);
  const { data: names } = useLoad(readPeerNames);
  const link = <WidgetLink href={href('remote-access')}>Remote access</WidgetLink>;
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
        <OffNote action={<WidgetLink href={href('remote-access')}>Set up Remote access</WidgetLink>}>
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
