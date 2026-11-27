// The Connections tab's model: how long to wait between reads, one device per
// MAC, what the table's cells say, the search (the same text the router
// searches) and the cut text.
import { createElement } from 'react';
import type { Column } from '@/components/data-table';
import type { AddressName } from '@/lib/api/names';
import { formatBytes, formatNumber } from '@/lib/format';
import type { Conn, Connections, SearchTerm } from './connections-api';

/** The next read waits the base, or 100 times what the router spent on the last one if that is longer. */
export function pollDelay(base: number, costMs: number | undefined): number {
  return costMs === undefined ? base : Math.max(base, 100 * costMs);
}

export interface DeviceSum {
  /** The MAC, "router", or the address when no MAC is known. */
  key: string;
  label: string;
  addrs: string[];
  n: number;
  bytes: number;
}

/** What a device is called wherever connections are listed: its name, else its MAC, else its address. */
export function connLabel(addr: string, who: AddressName | undefined): string {
  return addr === 'router' ? 'The router itself' : (who?.name ?? who?.mac ?? addr);
}

/** One entry per device: a MAC's IPv4 and IPv6 addresses become one, busiest first. */
export function foldDevices(devices: Connections['devices'], names: Map<string, AddressName>): DeviceSum[] {
  const byKey = new Map<string, DeviceSum>();
  for (const d of devices) {
    const who = d.addr === 'router' ? undefined : names.get(d.addr);
    const key = d.addr === 'router' ? 'router' : (who?.mac ?? d.addr);
    const label = connLabel(d.addr, who);
    const sum = byKey.get(key);
    if (sum === undefined) byKey.set(key, { key, label, addrs: [d.addr], n: d.n, bytes: d.bytes });
    else {
      sum.addrs.push(d.addr);
      sum.n += d.n;
      sum.bytes += d.bytes;
      if (who?.name !== undefined && sum.label === who.mac) sum.label = who.name;
    }
  }
  return [...byKey.values()].sort((a, b) => b.bytes - a.bytes);
}

export function cutText(shown: number, cut: number): string {
  return cut === 0 ? '' : `The ${String(shown)} busiest of ${String(shown + cut)}`;
}

export interface ConnRow {
  c: Conn;
  /** The device's name, else its MAC, else its address. */
  label: string;
  id: string;
}

/** The table's rows: one per connection, with its device's name and a key unique among them. */
export function connRows(rows: readonly Conn[], names: Map<string, AddressName>): ConnRow[] {
  return rows.map((c, i) => ({
    c,
    label: connLabel(c.owner, names.get(c.owner)),
    id: `${c.owner}|${c.l4}|${String(c.lport)}|${c.remote}|${String(c.rport)}|${String(i)}`,
  }));
}

/** The Protocol cell: "TCP · established · inbound". */
export function protocolText(c: Conn): string {
  return `${c.l4.toUpperCase()}${c.state === null ? '' : ` · ${c.state.toLowerCase().replace(/_/g, ' ')}`}${c.inbound ? ' · inbound' : ''}`;
}

/** The Remote cell: the address and its port, an IPv6 address in brackets. */
export function remoteText(c: Conn): string {
  return c.rport === null ? c.remote : c.l3 === 'ipv6' ? `[${c.remote}]:${String(c.rport)}` : `${c.remote}:${String(c.rport)}`;
}

/**
 * A connection as the search reads it, in lower case: the router's
 * search_text() (features/connections/rpcd.uc) word for word, then the
 * device's name and MAC, which only the page knows.
 */
export function connSearchText(c: Conn, who: AddressName | undefined): string {
  const state = c.state === null ? '' : c.state.toLowerCase().replace(/_/g, ' ');
  const head = `${c.l3} ${c.l4} ${state} ${c.inbound ? 'inbound' : ''} ${c.offloaded ? 'offloaded' : ''} ${c.owner} ${remoteText(c)} ${c.lport === null ? '' : String(c.lport)}`;
  return `${head} ${connLabel(c.owner, who)} ${who?.mac ?? ''}`.toLowerCase();
}

/** The search box's words, as the router takes them: lower case, at most 8, each cut to 64 characters. */
export function searchWords(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w !== '')
    .slice(0, 8)
    .map((w) => w.slice(0, 64));
}

/** A connection whose text holds every word. */
export function matchesWords(text: string, words: readonly string[]): boolean {
  return words.every((w) => text.includes(w));
}

/**
 * The words for the router (milkflint.connections list's search), each with
 * the owners its devices' names and MACs match, as the router can't name
 * them; at most 64 owners a word, as the router takes.
 */
export function searchTerms(
  words: readonly string[],
  devices: Connections['devices'],
  names: Map<string, AddressName>,
): SearchTerm[] {
  return words.map((text) => {
    const owners = devices
      .filter((d) => {
        const who = d.addr === 'router' ? undefined : names.get(d.addr);
        return connLabel(d.addr, who).toLowerCase().includes(text) || (who?.mac?.toLowerCase().includes(text) ?? false);
      })
      .map((d) => d.addr)
      .slice(0, 64);
    return owners.length === 0 ? { text } : { text, owners };
  });
}

const mono = (text: string) => createElement('span', { className: 'font-mono text-xs break-all' }, text);

/** The Connections tab's columns: each sorts but the offloaded flag; the router sends them busiest first. */
export const connColumns: readonly Column<ConnRow>[] = [
  { label: 'Net', cell: (r) => (r.c.l3 === 'ipv4' ? 'IPv4' : 'IPv6'), sort: (r) => r.c.l3 },
  { label: 'Protocol', cell: (r) => protocolText(r.c), sort: (r) => protocolText(r.c) },
  { label: 'Device', cell: (r) => r.label, sort: (r) => r.label, className: 'break-all' },
  { label: 'Remote', cell: (r) => mono(remoteText(r.c)), sort: (r) => remoteText(r.c), className: 'break-all' },
  {
    label: 'Sent',
    cell: (r) => formatBytes(r.c.out_bytes),
    sort: (r) => r.c.out_bytes,
    sortDescFirst: true,
    sortLabel: 'Most sent first',
    className: 'tabular text-right',
  },
  {
    label: 'Received',
    cell: (r) => formatBytes(r.c.in_bytes),
    sort: (r) => r.c.in_bytes,
    sortDescFirst: true,
    sortLabel: 'Most received first',
    className: 'tabular text-right',
  },
  {
    label: 'Offloaded',
    hidden: true,
    cell: (r) => (r.c.offloaded ? 'Offloaded' : ''),
    className: 'text-xs text-muted-foreground',
  },
];

/** The busiest devices, one row each (the Connections widget on Home draws them). */
export const deviceColumns: readonly Column<DeviceSum>[] = [
  { label: 'Device', compact: true, cell: (d) => d.label },
  { label: 'Connections', compact: true, className: 'tabular text-right', cell: (d) => formatNumber(d.n) },
  { label: 'Data', compact: true, className: 'tabular text-right', cell: (d) => formatBytes(d.bytes) },
];
