// The router's Ethernet ports, as LuCI's port status shows them: each one
// with a link or not, its speed, and its traffic now; the WAN port first.
// A port says which network it carries only when that isn't the usual (the
// WAN port moved into the LAN, a port on another network, one not used).
// Two across in a narrow widget, three from 24rem, all in a row from 48rem;
// the 1×1 tile, three across, is each port's name and speed.
import { EthernetPortIcon } from 'lucide-react';
import type { CSSProperties, ReactElement } from 'react';
import { formatBitrate } from '@/lib/format';
import { useDecorativeIcons } from '@/lib/presentation';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { type Port, speedText } from './ports';
import type { Dashboard } from './use-dashboard';
import { Dot, OffNote, Way, Widget, WidgetLink } from './widget';
import { useWidgetInfo } from './widget-info';

/** "2.5G": a speed where a port's cell is narrow. */
function shortSpeed(mbit: number): string {
  return mbit >= 1000 ? `${String(mbit / 1000)}G` : `${String(mbit)}M`;
}

/** What the port carries, when it isn't what its label says. */
function unusual(p: Port): string | undefined {
  if (p.networks.length === 0) return 'Not used';
  const usual = p.wan ? 'Internet' : 'LAN';
  return p.networks.length === 1 && p.networks[0] === usual ? undefined : p.networks.join(', ');
}

/** A port's whole state in words, for a screen reader and a pointer's hover. */
function described(p: Port): string {
  const link =
    !p.link || p.mbit === undefined
      ? p.link
        ? 'connected'
        : 'not connected'
      : `connected at ${speedText(p.mbit)}${p.half ? ', half duplex' : ''}`;
  const max = p.maxMbit === undefined ? '' : `; the port goes up to ${speedText(p.maxMbit)}`;
  const net = unusual(p);
  return `${p.label}: ${link}${max}${net === undefined ? '' : `; ${net}`}`;
}

/** On the 1×1 tile: the port's mark over its name and speed, three across. */
function TinyCell({ p, icons }: { p: Port; icons: boolean }): ReactElement {
  return (
    <li className="flex min-w-0 flex-col items-start" title={described(p)}>
      <span className="sr-only">{described(p)}</span>
      {icons ? (
        <EthernetPortIcon
          aria-hidden="true"
          className={cn('size-4 shrink-0', p.link ? 'text-success' : 'text-muted-foreground/60')}
        />
      ) : (
        <Dot tone={p.link ? 'success' : 'off'} className="my-1" />
      )}
      <span aria-hidden="true" className="max-w-full truncate text-sm font-medium">
        {p.label}
      </span>
      <span
        aria-hidden="true"
        className={cn('max-w-full truncate text-xs tabular', p.half ? 'text-warning' : 'text-muted-foreground')}
      >
        {!p.link ? 'No link' : p.mbit === undefined ? 'On' : shortSpeed(p.mbit)}
      </span>
    </li>
  );
}

function PortCell({ p, icons }: { p: Port; icons: boolean }): ReactElement {
  const net = unusual(p);
  return (
    <li className="flex min-w-0 items-start gap-2" title={described(p)}>
      {icons ? (
        <EthernetPortIcon
          aria-hidden="true"
          className={cn('mt-0.5 size-4 shrink-0', p.link ? 'text-success' : 'text-muted-foreground/60')}
        />
      ) : (
        <Dot tone={p.link ? 'success' : 'off'} className="mt-1.5" />
      )}
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium">{p.label}</span>
        <span className={cn('truncate text-xs tabular', p.half ? 'text-warning' : 'text-muted-foreground')}>
          {!p.link ? (
            'No link'
          ) : p.mbit === undefined ? (
            'Connected'
          ) : (
            <>
              <span className="@sm:hidden">{shortSpeed(p.mbit)}</span>
              <span className="hidden @sm:inline">{speedText(p.mbit)}</span>
              {p.half && ', half'}
            </>
          )}
        </span>
        {net !== undefined && (
          <span data-fit="2" className="truncate text-xs text-muted-foreground">
            {net}
          </span>
        )}
        {p.link && p.down !== undefined && (
          // down and up on lines of their own, where there's room for them
          <span data-fit className="hidden flex-col text-xs text-muted-foreground tabular @sm:flex">
            <span className="truncate">
              <Way dir="down" /> {formatBitrate(p.down)}
            </span>
            <span className="truncate">
              <Way dir="up" /> {formatBitrate(p.up ?? 0)}
            </span>
          </span>
        )}
      </div>
    </li>
  );
}

export function PortsCard({ d }: { d: Dashboard }): ReactElement {
  const icons = useDecorativeIcons();
  const size = useWidgetInfo().size;
  const tiny = size.w === 1 && size.h === 1;
  const ports = d.ports;
  const linked = ports.filter((p) => p.link).length;
  const link = <WidgetLink href={href('lan')}>LAN</WidgetLink>;
  if (ports.length === 0) {
    return (
      <Widget>
        <OffNote action={link}>The router didn’t say which Ethernet ports it has.</OffNote>
      </Widget>
    );
  }
  return (
    <Widget
      // the tile says it port by port, with no room for a line more
      status={tiny ? undefined : linked === 0 ? 'None connected' : `${String(linked)} of ${String(ports.length)} connected`}
      aside={link}
    >
      {tiny ? (
        <ul aria-label="Ethernet ports" className="grid grid-cols-3 content-start gap-x-2 gap-y-1.5 px-5">
          {ports.map((p) => (
            <TinyCell key={p.device} p={p} icons={icons} />
          ))}
        </ul>
      ) : (
        <ul
          aria-label="Ethernet ports"
          // all in a row from 48rem: as many columns as there are ports
          style={{ '--ports': ports.length } as CSSProperties}
          className="grid grid-cols-2 content-start gap-x-3 gap-y-3 px-5 @sm:grid-cols-3 @sm:gap-y-4 @3xl:grid-cols-[repeat(var(--ports),minmax(0,1fr))]"
        >
          {ports.map((p) => (
            <PortCell key={p.device} p={p} icons={icons} />
          ))}
        </ul>
      )}
    </Widget>
  );
}
