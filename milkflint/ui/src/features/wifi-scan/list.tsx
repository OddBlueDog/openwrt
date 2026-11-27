// Every network the scan heard: a table on wide screens and a card per
// network on a phone, filtered by band, by "only on your channels" and by
// name, and sorted (strongest first to start; by name, hidden ones last; by
// channel, the strongest first on each). Hover and selection are shared
// with the radar; a row opens the network's details in a side sheet.
import { EyeOffIcon, LockIcon, LockOpenIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, useId, useMemo, useState } from 'react';
import { SignalBars } from '@/components/charts/signal-bars';
import { type Column, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { ScannedNetwork } from './api';
import type { Blip } from './radar';
import { bandLabel, type BandId, channelRange, securityOf, standardLabel } from './spectrum';

function Name({ n, shares }: { n: ScannedNetwork; shares: boolean }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <span className={cn('size-2 shrink-0 rounded-full', shares ? 'bg-primary' : 'bg-foreground/50')} aria-hidden="true" />
      <span className="flex min-w-0 flex-col">
        <span className={cn('flex min-w-0 items-center gap-1.5 font-medium', n.ssid === null && 'text-muted-foreground italic')}>
          {n.ssid === null && <EyeOffIcon className="size-3.5 shrink-0" aria-hidden />}
          <span className="truncate">{n.ssid ?? 'Hidden network'}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          <span className="font-mono">{n.bssid}</span>
          {n.wps?.name !== undefined && ` · ${n.wps.name}`}
        </span>
      </span>
    </span>
  );
}

function Signal({ n }: { n: ScannedNetwork }): ReactElement {
  return (
    <span className="flex items-center gap-2 whitespace-nowrap tabular">
      <SignalBars dbm={n.signal ?? undefined} />
      {n.signal === null ? '—' : `${String(n.signal)} dBm`}
    </span>
  );
}

function SecurityText({ n }: { n: ScannedNetwork }): ReactElement {
  const security = securityOf(n);
  const Icon = security.open ? LockOpenIcon : LockIcon;
  return (
    <span className={cn('inline-flex items-center gap-1.5', security.weak ? 'text-warning' : 'text-muted-foreground')}>
      <Icon className="size-3.5" aria-hidden />
      {security.label}
    </span>
  );
}

const yourChannel = <Badge>Your channel</Badge>;

/** Network, Signal and Channel sort; a hidden network's name and a missing signal last either way. */
const columns: readonly Column<Blip>[] = [
  {
    label: 'Network',
    cell: ({ network: n, shares }) => <Name n={n} shares={shares} />,
    sort: ({ network: n }) => n.ssid ?? undefined,
    sortLabel: 'By name',
    className: 'max-w-72',
  },
  {
    label: 'Signal',
    cell: ({ network: n }) => <Signal n={n} />,
    sort: ({ network: n }) => n.signal ?? undefined,
    sortDescFirst: true,
    sortLabel: 'Strongest first',
  },
  {
    label: 'Channel',
    cell: ({ network: n, shares }) => (
      <>
        <span className="flex items-center gap-2 whitespace-nowrap tabular">
          <span>
            {channelRange(n)}
            <span className="text-muted-foreground"> · {n.width} MHz</span>
          </span>
          {shares && yourChannel}
        </span>
        <span className="block text-xs text-muted-foreground">{bandLabel(n.band)}</span>
      </>
    ),
    sort: ({ network: n }) => n.mhz,
    sortLabel: 'By channel',
  },
  { label: 'Wi-Fi', cell: ({ network: n }) => standardLabel(n.standard), className: 'whitespace-nowrap text-muted-foreground' },
  { label: 'Security', cell: ({ network: n }) => <SecurityText n={n} />, className: 'whitespace-nowrap' },
];

export function NetworkList({
  stale,
  blips,
  bands,
  scanned,
  focused,
  selected,
  onFocus,
  onSelect,
}: {
  /** From a scan a while ago: shown fainter. */
  stale: boolean;
  blips: readonly Blip[];
  bands: readonly BandId[];
  /** A scan has finished at some point. */
  scanned: boolean;
  focused: string | undefined;
  selected: string | undefined;
  onFocus: (bssid: string | undefined) => void;
  onSelect: (bssid: string) => void;
}): ReactElement {
  const id = useId();
  const [band, setBand] = useState<BandId | 'all'>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState('');

  // strongest first: the table's sort keeps that order among networks it can't tell apart (on one channel)
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return blips
      .filter(
        (b) =>
          (band === 'all' || b.network.band === band) &&
          (!mineOnly || b.shares) &&
          (q === '' || (b.network.ssid ?? 'hidden').toLowerCase().includes(q) || b.network.bssid.includes(q)),
      )
      .sort((a, b) => (b.network.signal ?? -200) - (a.network.signal ?? -200));
  }, [blips, band, mineOnly, query]);
  const empty = !scanned
    ? 'Nothing yet: scan to see the networks around the router.'
    : blips.length === 0
      ? 'The scan heard no other network.'
      : 'No network matches.';
  const pointer = (bssid: string): { onPointerEnter: () => void; onPointerLeave: () => void; onClick: () => void } => ({
    onPointerEnter: () => {
      onFocus(bssid);
    },
    onPointerLeave: () => {
      onFocus(undefined);
    },
    onClick: () => {
      onSelect(bssid);
    },
  });

  return (
    <div className="flex flex-col">
      {/* one row of filters: band, your channels, a name */}
      <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3 px-5 pb-4', blips.length === 0 && 'hidden')}>
        {bands.length > 1 && (
          <div role="group" aria-label="Band" className="inline-flex w-fit gap-0.5 rounded-lg border p-0.5">
            {(['all', ...bands] as const).map((b) => (
              <Button
                key={b}
                type="button"
                size="sm"
                variant={band === b ? 'secondary' : 'ghost'}
                className="h-7 px-2.5"
                aria-pressed={band === b}
                onClick={() => {
                  setBand(b);
                }}
              >
                {b === 'all' ? 'All bands' : bandLabel(b)}
              </Button>
            ))}
          </div>
        )}
        <span className="flex items-center gap-2">
          <Switch id={`${id}-mine`} checked={mineOnly} onCheckedChange={setMineOnly} />
          <label htmlFor={`${id}-mine`} className="text-sm">
            Only on your channels
          </label>
        </span>
        <div className="relative w-full min-w-0 sm:ml-auto sm:w-56">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            value={query}
            placeholder="Find a network"
            aria-label="Find a network by name or address"
            className="pl-9"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
      </div>

      {/* a table on a wide card, a card per network on a narrow one, with a Sort menu */}
      <DataTable
        label="Networks"
        columns={columns}
        rows={rows}
        rowKey={({ network: n }) => n.bssid}
        empty={empty}
        initialSort={{ id: 'Signal', desc: true }}
        framed={false}
        inset
        wide="md"
        className={cn('transition-opacity', stale && 'opacity-60')}
        rowProps={({ network: n }) => ({
          'aria-selected': n.bssid === selected,
          tabIndex: 0,
          className: cn(
            'cursor-pointer focus-visible:bg-accent',
            n.bssid === focused && 'bg-muted/60',
            n.bssid === selected && 'bg-primary-subtle hover:bg-primary-subtle',
          ),
          ...pointer(n.bssid),
          onKeyDown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onSelect(n.bssid);
            }
          },
        })}
        card={({ network: n, shares }) => (
          <button
            type="button"
            className={cn(
              'flex w-full cursor-pointer flex-col gap-1.5 px-5 py-3 text-left text-sm hover:bg-muted/60',
              n.bssid === selected && 'bg-primary-subtle',
            )}
            {...pointer(n.bssid)}
          >
            <span className="flex w-full items-start justify-between gap-3">
              <Name n={n} shares={shares} />
              <Signal n={n} />
            </span>
            <span className="flex flex-col gap-1 pl-4.5 text-xs text-muted-foreground tabular">
              <span>
                Channel {channelRange(n)} · {n.width} MHz · {bandLabel(n.band)} · {standardLabel(n.standard)}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <SecurityText n={n} />
                {shares && yourChannel}
              </span>
            </span>
          </button>
        )}
      />
    </div>
  );
}
