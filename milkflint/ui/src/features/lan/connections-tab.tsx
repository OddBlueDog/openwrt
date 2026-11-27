// The Connections tab: a graph of TCP, UDP and other connections while the
// tab is open, what the router is tracking now, a summary of the whole table,
// then the busiest connections (up to 500), for one device or all, IPv4,
// IPv6 or both, and matching the search box. The search filters the rows
// shown at once, and the router searches its whole table for the same words
// (0.4 s after the last key), so a match outside the 500 busiest is found
// too. It reads again after max(5 s, 100 times what the last read cost the
// router), and only while this tab is shown.
import { SearchIcon } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { LoadError } from '@/components/page-states';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQuery } from '@tanstack/react-query';
import { useLive } from '@/lib/query/use-live';
import type { AddressName } from '@/lib/api/names';
import type { getConnections } from './connections-api';
import { ConnectionsGraph } from './connections-graph';
import { recordSample } from './connections-history';
import { lanQueries } from './queries';
import { DataTable } from '@/components/data-table';
import {
  connColumns,
  connRows,
  connSearchText,
  cutText,
  type DeviceSum,
  foldDevices,
  matchesWords,
  searchTerms,
  searchWords,
} from './connections';

type Family = 'all' | 'ipv4' | 'ipv6';
const none = new Map<string, AddressName>();
const num = (n: number): string => n.toLocaleString('en-GB');
const ROWS = 500;
const SEARCH_WAIT_MS = 400;

function Stat({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-base font-medium tabular">{num(value)}</dd>
    </div>
  );
}

export function ConnectionsTab(): ReactElement {
  const [device, setDevice] = useState('all');
  const [family, setFamily] = useState<Family>('all');
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => {
      setAsked(query);
    }, SEARCH_WAIT_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [query]);
  const words = useMemo(() => searchWords(query), [query]);
  const askedWords = searchWords(asked);
  const names = useQuery(lanQueries.addressNames()).data ?? none;
  // The list asked for depends on the device's addresses, which the last answer tells.
  const [known, setKnown] = useState<DeviceSum[]>([]);
  const chosen = known.find((d) => d.key === device);
  // a device that drains out of the list keeps the addresses it last had
  const [kept, setKept] = useState<DeviceSum | undefined>();
  if (chosen !== undefined && (kept?.key !== chosen.key || kept.addrs.join(',') !== chosen.addrs.join(','))) setKept(chosen);
  const current = chosen ?? (kept?.key === device ? kept : undefined);
  const addrs = device === 'all' ? undefined : (current?.addrs ?? (device === 'router' ? ['router'] : [device]));
  // the words, not the owners they name, choose a new read: those change with every answer
  const key = `${device}|${family}|${addrs?.join(',') ?? ''}|${askedWords.join(' ')}`;
  const [shown, setShown] = useState<Awaited<ReturnType<typeof getConnections>> | undefined>();
  const { data, error, loading, refresh, at } = useLive(
    lanQueries.connections(key, () => ({
      rows: ROWS,
      ...(family === 'all' ? {} : { family }),
      ...(addrs === undefined ? {} : { addrs }),
      ...(askedWords.length === 0 ? {} : { search: searchTerms(askedWords, shown?.devices ?? [], names) }),
    })),
  );
  if (data !== undefined && data !== shown) setShown(data);
  useEffect(() => {
    if (data !== undefined) recordSample({ t: at ?? Date.now(), ...data.proto });
  }, [data, at]);
  const devices = useMemo(() => (shown === undefined ? [] : foldDevices(shown.devices, names)), [shown, names]);
  const sameDevices = devices.map((d) => `${d.key}:${d.addrs.join(',')}`).join(';');
  if (sameDevices !== known.map((d) => `${d.key}:${d.addrs.join(',')}`).join(';')) setKnown(devices);
  const rows = useMemo(() => {
    const all = connRows(shown?.rows ?? [], names);
    return words.length === 0 ? all : all.filter((r) => matchesWords(connSearchText(r.c, names.get(r.c.owner)), words));
  }, [shown, names, words]);

  if (shown === undefined) {
    return loading ? <p className="text-sm text-muted-foreground">Reading…</p> : <LoadError error={error} retry={refresh} />;
  }
  const router = devices.find((d) => d.key === 'router');
  const others = devices.filter((d) => d.key !== 'router');
  // the router has searched for these very words when the last answer is for them
  const searched = data !== undefined && words.join(' ') === askedWords.join(' ');
  const matching = rows.length + (searched ? shown.cut : 0);
  const cut = words.length > 0 ? '' : cutText(shown.rows.length, shown.cut);
  return (
    <div className="flex flex-col gap-4">
      <ConnectionsGraph />
      <dl className="flex flex-wrap gap-x-8 gap-y-3" aria-label="Summary">
        <Stat label="Connections" value={shown.total} />
        <Stat label="IPv4" value={shown.family.ipv4} />
        <Stat label="IPv6" value={shown.family.ipv6} />
        <Stat label="TCP" value={shown.proto.tcp} />
        <Stat label="UDP" value={shown.proto.udp} />
        <Stat label="Other" value={shown.proto.other} />
        <Stat label="Offloaded" value={shown.offloaded} />
      </dl>
      <p className="text-sm text-muted-foreground">The router can track up to {num(shown.max)}.</p>
      {shown.partial && (
        <p className="text-sm text-muted-foreground">
          Showing the first {num(shown.total)} of {num(shown.count)} tracked connections.
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <div className="relative w-full sm:w-72">
          <SearchIcon
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label="Search connections"
            placeholder="Search device, address or port"
            value={query}
            className="pl-9"
            onChange={(e) => {
              setQuery(e.target.value);
            }}
          />
        </div>
        <Select value={device} onValueChange={setDevice}>
          <SelectTrigger aria-label="Device" className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All devices</SelectItem>
            {others.map((d) => (
              <SelectItem key={d.key} value={d.key}>
                {d.label} · {num(d.n)}
              </SelectItem>
            ))}
            {current !== undefined && current.key !== 'router' && !others.some((d) => d.key === current.key) && (
              <SelectItem value={current.key}>{current.label} · 0</SelectItem>
            )}
            <SelectItem value="router">The router itself{router === undefined ? '' : ` · ${num(router.n)}`}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={family}
          onValueChange={(v) => {
            setFamily(v === 'ipv4' || v === 'ipv6' ? v : 'all');
          }}
        >
          <SelectTrigger aria-label="Internet protocol" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">IPv4 and IPv6</SelectItem>
            <SelectItem value="ipv4">IPv4</SelectItem>
            <SelectItem value="ipv6">IPv6</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {words.length > 0 && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {matching === 0
            ? 'No connections match.'
            : `${num(matching)} ${matching === 1 ? 'connection matches' : 'connections match'}${
                searched && shown.cut > 0 ? `: the ${num(rows.length)} busiest shown` : ''
              }.`}
        </p>
      )}
      <DataTable
        label="Connections"
        columns={connColumns}
        rows={rows}
        rowKey={(r) => r.id}
        empty={words.length > 0 ? 'No connections match the search.' : 'No connections match.'}
        defaultOrder="Busiest first"
        pageSize={100}
      />
      {cut !== '' && (
        <p className="text-sm text-muted-foreground">{cut}. A sort orders these; the search looks through every connection.</p>
      )}
    </div>
  );
}
