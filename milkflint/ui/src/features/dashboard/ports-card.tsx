// The router's Ethernet ports, as LuCI's port status shows them: each one
// with a link or not, its speed, and its traffic now; the WAN port first.
// A port says which network it carries only when that isn't the usual (the
// WAN port moved into the LAN, a port on another network, one not used).
// Two across in a narrow widget, three from 24rem, all in a row from 48rem;
// the 1×1 tile, three across, is each port's name and speed. Hovering a port
// (or focusing it) shows the rest: why a link is slow, the fastest the port
// goes, its MAC, its traffic since it started and any faults.
import { EthernetPortIcon } from 'lucide-react';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatBitrate, formatBytes, formatNumber } from '@/lib/format';
import { useDecorativeIcons } from '@/lib/presentation';
import { pageLink } from '@/lib/router';
import { cn } from '@/lib/utils';
import { type Port, speedNote, speedText } from './ports';
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

/** A port's link in words: "Connected at 1 Gbit/s, full duplex". */
function linkText(p: Port): string {
  if (!p.link) return 'No cable, or the device at the other end is off';
  if (p.mbit === undefined) return 'Connected';
  return `Connected at ${speedText(p.mbit)}, ${p.half ? 'half duplex: usually a cable or device fault' : 'full duplex'}`;
}

function Row({ label, children, tone }: { label: string; children: ReactNode; tone?: 'warning' }): ReactElement {
  return (
    <>
      <dt className="opacity-70">{label}</dt>
      <dd className={cn('tabular', tone === 'warning' && 'font-medium text-warning')}>{children}</dd>
    </>
  );
}

/** Everything about a port the cell has no room for. */
function PortDetails({ p }: { p: Port }): ReactElement {
  const note = speedNote(p);
  const net = p.networks.length === 0 ? 'Nothing: not used' : p.networks.join(', ');
  return (
    <TooltipContent side="bottom" align="start" className="max-w-xs text-pretty">
      <p className="font-medium">
        {p.label} <span className="font-normal opacity-70">· {p.device}</span>
      </p>
      <p className="mt-0.5 opacity-80">{linkText(p)}</p>
      {note !== undefined && <p className="mt-0.5 opacity-80">{note}</p>}
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        {p.maxMbit !== undefined && <Row label="Port’s fastest">{speedText(p.maxMbit)}</Row>}
        <Row label="Carries">{net}</Row>
        {p.mac !== undefined && (
          <Row label="MAC">
            <span className="font-mono">{p.mac}</span>
          </Row>
        )}
        {p.link && p.down !== undefined && (
          <Row label="Now">
            <Way dir="down" /> {formatBitrate(p.down)} · <Way dir="up" /> {formatBitrate(p.up ?? 0)}
          </Row>
        )}
        {p.totalDown !== undefined && p.totalUp !== undefined && (
          <Row label="Since it started">
            <Way dir="down" /> {formatBytes(p.totalDown)} · <Way dir="up" /> {formatBytes(p.totalUp)}
          </Row>
        )}
        {p.errors !== undefined && p.errors > 0 && (
          <Row label="Errors" tone="warning">
            {formatNumber(p.errors)} frames
          </Row>
        )}
        {p.dropped !== undefined && p.dropped > 0 && <Row label="Dropped">{formatNumber(p.dropped)} frames</Row>}
      </dl>
    </TooltipContent>
  );
}

/** A port's cell, focusable, with its details on hover or focus. */
function WithDetails({ p, className, children }: { p: Port; className: string; children: ReactNode }): ReactElement {
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger
          aria-label={`${p.label}: ${linkText(p)}`}
          className={cn('w-full min-w-0 cursor-default rounded-sm text-left', className)}
        >
          {children}
        </TooltipTrigger>
        <PortDetails p={p} />
      </Tooltip>
    </li>
  );
}

/** On the 1×1 tile: the port's mark over its name and speed, three across. */
function TinyCell({ p, icons }: { p: Port; icons: boolean }): ReactElement {
  return (
    <WithDetails p={p} className="flex flex-col items-start">
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
    </WithDetails>
  );
}

function PortCell({ p, icons }: { p: Port; icons: boolean }): ReactElement {
  const net = unusual(p);
  return (
    <WithDetails p={p} className="flex items-start gap-2">
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
    </WithDetails>
  );
}

export function PortsCard({ d }: { d: Dashboard }): ReactElement {
  const icons = useDecorativeIcons();
  const size = useWidgetInfo().size;
  const tiny = size.w === 1 && size.h === 1;
  const ports = d.ports;
  const linked = ports.filter((p) => p.link).length;
  const link = <WidgetLink to={pageLink('lan')}>LAN & DHCP</WidgetLink>;
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
