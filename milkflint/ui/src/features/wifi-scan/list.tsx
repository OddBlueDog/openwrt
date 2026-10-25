// Every network the scan heard, in a table that filters and sorts, and
// that shares its hover and selection with the radar.
import { ArrowDownIcon, ArrowUpIcon, EyeOffIcon, LockIcon, LockOpenIcon, SearchIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { SignalBars } from '@/components/charts/signal-bars';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import type { Blip } from './radar';
import { bandLabel, type BandId, channelRange, securityOf, standardLabel } from './spectrum';

type SortKey = 'signal' | 'name' | 'channel';

function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: SortKey;
  sort: { key: SortKey; desc: boolean };
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
        className={cn('inline-flex items-center gap-1 hover:text-foreground', active && 'text-foreground')}
      >
        {label}
        {active && <Arrow className="size-3" />}
      </button>
    </TableHead>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-8 rounded-md px-3 text-xs font-medium transition-colors',
        active ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function NetworkList({
  stale,
  blips,
  bands,
  focused,
  selected,
  onFocus,
  onSelect,
}: {
  /** From a scan a while ago: shown fainter. */
  stale: boolean;
  blips: readonly Blip[];
  bands: readonly BandId[];
  focused: string | undefined;
  selected: string | undefined;
  onFocus: (bssid: string | undefined) => void;
  onSelect: (bssid: string) => void;
}): ReactElement {
  const [band, setBand] = useState<BandId | 'all'>('all');
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'signal', desc: true });

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 px-5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Band">
          <Chip
            active={band === 'all'}
            onClick={() => {
              setBand('all');
            }}
          >
            All
          </Chip>
          {bands.map((b) => (
            <Chip
              key={b}
              active={band === b}
              onClick={() => {
                setBand(b);
              }}
            >
              {bandLabel(b)}
            </Chip>
          ))}
          <Chip
            active={mineOnly}
            onClick={() => {
              setMineOnly((v) => !v);
            }}
          >
            On your channels
          </Chip>
        </div>
        <div className="relative ml-auto w-full sm:w-56">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            placeholder="Find a network"
            aria-label="Find a network"
            className="h-8 pl-9"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
      </div>
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
        <TableBody className={cn('transition-opacity', stale && 'opacity-60')}>
          {rows.map(({ network: n, shares }) => {
            const security = securityOf(n);
            const isSelected = n.bssid === selected;
            return (
              <TableRow
                key={n.bssid}
                aria-selected={isSelected}
                tabIndex={0}
                className={cn(
                  'cursor-pointer outline-none focus-visible:bg-accent',
                  n.bssid === focused && 'bg-muted/60',
                  isSelected && 'bg-primary/8 hover:bg-primary/10',
                )}
                onPointerEnter={() => {
                  onFocus(n.bssid);
                }}
                onPointerLeave={() => {
                  onFocus(undefined);
                }}
                onClick={() => {
                  onSelect(n.bssid);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(n.bssid);
                  }
                }}
              >
                <TableCell className="max-w-72">
                  <div className="flex items-center gap-2.5">
                    <span className={cn('size-2 shrink-0 rounded-full', shares ? 'bg-primary' : 'bg-foreground/50')} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className={cn('flex items-center gap-1.5 truncate font-medium', n.ssid === null && 'text-muted-foreground italic')}>
                        {n.ssid === null && <EyeOffIcon className="size-3.5 shrink-0" />}
                        <span className="truncate">{n.ssid ?? 'Hidden network'}</span>
                      </div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {n.bssid}
                        {n.wps?.name !== undefined && ` · ${n.wps.name}`}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-2 tabular">
                    <SignalBars dbm={n.signal ?? undefined} />
                    {n.signal === null ? '—' : `${String(n.signal)} dBm`}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2 tabular">
                    <span>
                      {channelRange(n)}
                      <span className="text-muted-foreground"> · {n.width} MHz</span>
                    </span>
                    {shares && (
                      <Badge variant="outline" className="border-primary/40 text-primary">
                        Your channel
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{bandLabel(n.band)}</div>
                </TableCell>
                <TableCell className="text-muted-foreground">{standardLabel(n.standard)}</TableCell>
                <TableCell>
                  <span className={cn('inline-flex items-center gap-1.5', security.weak ? 'text-warning' : 'text-muted-foreground')}>
                    {security.open ? <LockOpenIcon className="size-3.5" /> : <LockIcon className="size-3.5" />}
                    {security.label}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
          {rows.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                {blips.length === 0 ? 'No networks yet: scan to look for them.' : 'No network matches.'}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
