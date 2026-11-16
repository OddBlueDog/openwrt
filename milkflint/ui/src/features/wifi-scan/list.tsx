// Every network the scan heard: a table on wide screens and a card per
// network on a phone, filtered by band, by "only on your channels" and by
// name, and sorted. Hover and selection are shared with the radar; a row
// opens the network's details in a side sheet.
import { ArrowDownIcon, ArrowUpIcon, EyeOffIcon, LockIcon, LockOpenIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, useId, useMemo, useState } from 'react';
import { SignalBars } from '@/components/charts/signal-bars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { ScannedNetwork } from './api';
import type { Blip } from './radar';
import { bandLabel, type BandId, channelRange, securityOf, standardLabel } from './spectrum';

type SortKey = 'signal' | 'name' | 'channel';
interface Sort {
  key: SortKey;
  desc: boolean;
}

const sorts: readonly { value: string; label: string; sort: Sort }[] = [
  { value: 'signal', label: 'Strongest first', sort: { key: 'signal', desc: true } },
  { value: 'name', label: 'By name', sort: { key: 'name', desc: false } },
  { value: 'channel', label: 'By channel', sort: { key: 'channel', desc: false } },
];

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}): ReactElement {
  const active = sort.key === sortKey;
  const Arrow = sort.desc ? ArrowDownIcon : ArrowUpIcon;
  return (
    <TableHead className={className} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}>
      <button
        type="button"
        onClick={() => {
          onSort(sortKey);
        }}
        className={cn(
          'inline-flex min-h-6 cursor-pointer items-center gap-1 rounded-sm hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        {active && <Arrow className="size-3" aria-hidden />}
      </button>
    </TableHead>
  );
}

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
  const [sort, setSort] = useState<Sort>({ key: 'signal', desc: true });

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const shown = blips.filter(
      (b) =>
        (band === 'all' || b.network.band === band) &&
        (!mineOnly || b.shares) &&
        (q === '' || (b.network.ssid ?? 'hidden').toLowerCase().includes(q) || b.network.bssid.includes(q)),
    );
    const dir = sort.desc ? -1 : 1;
    return shown.sort((a, b) => {
      const x = a.network;
      const y = b.network;
      if (sort.key === 'name') {
        // hidden ones last either way
        if ((x.ssid === null) !== (y.ssid === null)) return x.ssid === null ? 1 : -1;
        return dir * (x.ssid ?? '').localeCompare(y.ssid ?? '', 'en-GB', { sensitivity: 'base' });
      }
      if (sort.key === 'channel') return x.mhz !== y.mhz ? dir * (x.mhz - y.mhz) : (y.signal ?? -200) - (x.signal ?? -200);
      return dir * ((x.signal ?? -200) - (y.signal ?? -200));
    });
  }, [blips, band, mineOnly, query, sort]);

  const onSort = (key: SortKey): void => {
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key === 'signal' }));
  };
  const empty = !scanned
    ? 'Nothing yet: scan to see the networks around the router.'
    : blips.length === 0
      ? 'The scan heard no other network.'
      : 'No network matches.';
  const rowProps = (bssid: string): { onPointerEnter: () => void; onPointerLeave: () => void; onClick: () => void } => ({
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
      {/* one row of filters: band, your channels, a name; on a phone the sort too */}
      <div className={cn('flex flex-wrap items-center gap-x-5 gap-y-3 border-b px-5 pb-4', blips.length === 0 && 'hidden')}>
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
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:w-56 sm:flex-none">
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
          <Select
            value={sorts.find((s) => s.sort.key === sort.key && s.sort.desc === sort.desc)?.value ?? ''}
            onValueChange={(v) => {
              const s = sorts.find((x) => x.value === v);
              if (s !== undefined) setSort(s.sort);
            }}
          >
            <SelectTrigger className="w-40 lg:hidden" aria-label="Sort">
              <SelectValue placeholder="Sorted" />
            </SelectTrigger>
            <SelectContent>
              {sorts.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* wide screens: a table */}
      <div className={cn('hidden transition-opacity lg:block', stale && 'opacity-60')}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Network" sortKey="name" sort={sort} onSort={onSort} />
              <SortHead label="Signal" sortKey="signal" sort={sort} onSort={onSort} />
              <SortHead label="Channel" sortKey="channel" sort={sort} onSort={onSort} />
              <TableHead>Wi-Fi</TableHead>
              <TableHead>Security</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ network: n, shares }) => (
              <TableRow
                key={n.bssid}
                aria-selected={n.bssid === selected}
                tabIndex={0}
                className={cn(
                  'cursor-pointer focus-visible:bg-accent',
                  n.bssid === focused && 'bg-muted/60',
                  n.bssid === selected && 'bg-primary-subtle hover:bg-primary-subtle',
                )}
                {...rowProps(n.bssid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(n.bssid);
                  }
                }}
              >
                <TableCell className="max-w-72">
                  <Name n={n} shares={shares} />
                </TableCell>
                <TableCell>
                  <Signal n={n} />
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 tabular">
                    <span>
                      {channelRange(n)}
                      <span className="text-muted-foreground"> · {n.width} MHz</span>
                    </span>
                    {shares && yourChannel}
                  </span>
                  <span className="block text-xs text-muted-foreground">{bandLabel(n.band)}</span>
                </TableCell>
                <TableCell className="text-muted-foreground">{standardLabel(n.standard)}</TableCell>
                <TableCell>
                  <SecurityText n={n} />
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="py-8 text-center whitespace-normal text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* phones and narrow windows: a card per network */}
      <ul className={cn('divide-y transition-opacity lg:hidden', stale && 'opacity-60')} aria-label="Networks">
        {rows.map(({ network: n, shares }) => (
          <li key={n.bssid}>
            <button
              type="button"
              className={cn(
                'flex w-full cursor-pointer flex-col gap-1.5 px-5 py-3 text-left text-sm hover:bg-muted/60',
                n.bssid === selected && 'bg-primary-subtle',
              )}
              {...rowProps(n.bssid)}
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
          </li>
        ))}
        {rows.length === 0 && <li className="px-5 py-8 text-center text-sm text-muted-foreground">{empty}</li>}
      </ul>
    </div>
  );
}
