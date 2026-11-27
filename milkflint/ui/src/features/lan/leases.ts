// The router's DHCP leases as rows: one model and one set of columns for the
// LAN & DHCP page's Addresses tab and the Home widgets that show the same.
// IPv6 rows also carry the addresses devices picked themselves (SLAAC): the
// router keeps no record of those, so they are the ones its neighbour table
// has seen (LuCI's host hints) that no lease holds.
import { createElement, type ReactNode } from 'react';
import type { Column } from '@/components/data-table';
import type { TabItem } from '@/components/ui/tabs';
import { namesFromRouter } from '@/lib/api/names';
import { getDhcpLeases, getHostHints, type HostHints, hintName, type Lease, type Lease6 } from '@/lib/api/network';
import { getConfig, str } from '@/lib/api/uci';
import { dhcpv6Mode, type Dhcpv6Mode } from '@/lib/dhcpv6';
import { formatDuration } from '@/lib/format';
import { UNNAMED_DEVICE } from '../clients/model';

export interface LeaseRow {
  key: string;
  name: string | undefined;
  mac: string | undefined;
  /** Leased addresses. */
  addrs: string[];
  /** IPv6 addresses the device picked itself (SLAAC), seen lately by the router. */
  slaac?: string[];
  duid?: string;
  /** Seconds left; false = never ends; ≤ 0 = expired; undefined = unknown. */
  expires: number | false | undefined;
}

/** Named devices A to Z, unnamed ones last. */
function byName(a: LeaseRow, b: LeaseRow): number {
  if (a.name === undefined || b.name === undefined) return a.name === b.name ? 0 : a.name === undefined ? 1 : -1;
  return a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
}

function nameFor(mac: string | undefined, hostname: string | undefined, names: Map<string, string>): string | undefined {
  const named = mac === undefined ? undefined : names.get(mac.toLowerCase());
  return named ?? (hostname === undefined || hostname === '' ? undefined : hostname);
}

export function leaseRows4(v4: Lease[], names: Map<string, string>): LeaseRow[] {
  return v4
    .map((l): LeaseRow => ({
      key: `${l.macaddr.toLowerCase()}/${l.ipaddr ?? ''}`,
      name: nameFor(l.macaddr, l.hostname, names),
      mac: l.macaddr,
      addrs: l.ipaddr === undefined ? [] : [l.ipaddr],
      expires: l.expires,
    }))
    .sort(byName);
}

export function leaseRows6(v6: Lease6[], names: Map<string, string>, hints: HostHints = {}): LeaseRow[] {
  const rows = v6.map((l, i): LeaseRow => {
    const row: LeaseRow = {
      key:
        l.duid === undefined
          ? (l.macaddr?.toLowerCase() ?? `${l.hostname ?? ''}#${String(i)}`)
          : `${l.duid}/${l.ip6addrs.join(',')}`,
      name: nameFor(l.macaddr, l.hostname, names),
      mac: l.macaddr,
      addrs: l.ip6addrs,
      expires: l.expires,
    };
    if (l.duid !== undefined) row.duid = l.duid;
    return row;
  });
  // SLAAC: a device's addresses the router has seen that no lease holds (not
  // link-local), on its lease's row, else on a row of their own
  const leased = new Set(v6.flatMap((l) => l.ip6addrs.map((a) => a.toLowerCase())));
  for (const [rawMac, h] of Object.entries(hints)) {
    const own = (h.ip6addrs ?? []).map((a) => a.toLowerCase()).filter((a) => !a.startsWith('fe80:') && !leased.has(a));
    if (own.length === 0) continue;
    const mac = rawMac.toLowerCase();
    const row = rows.find((r) => r.mac?.toLowerCase() === mac);
    if (row !== undefined) row.slaac = own;
    else
      rows.push({ key: `slaac/${mac}`, name: nameFor(mac, hintName(h), names), mac, addrs: [], slaac: own, expires: undefined });
  }
  return rows.sort(byName);
}

/** The Lease left cell: a SLAAC-only device has no lease. */
export function leaseLeftText(r: LeaseRow): string {
  return r.addrs.length === 0 && r.slaac !== undefined ? 'No lease (SLAAC)' : leftText(r.expires);
}

export const RELAY_LINE = 'DHCPv6 is relayed to your main router, which keeps these leases.';

/** How long a lease has left, in words; empty when the router didn't say. */
export function leftText(expires: number | false | undefined): string {
  if (expires === undefined) return '';
  if (expires === false) return 'Never ends';
  return expires <= 0 ? 'Expired' : formatDuration(expires);
}

const mono = (text: string | undefined) =>
  text === undefined || text === '' ? '' : createElement('span', { className: 'font-mono text-xs' }, text);

const nameCell = (r: LeaseRow): ReactNode =>
  r.name ?? createElement('span', { className: 'text-muted-foreground' }, UNNAMED_DEVICE);
const slaacTag = createElement('span', { className: 'ml-1.5 font-sans text-muted-foreground' }, 'SLAAC');
const addrCell = (r: LeaseRow): ReactNode =>
  createElement(
    'span',
    { className: 'flex flex-col' },
    ...r.addrs.map((a) => createElement('span', { key: a, className: 'font-mono text-xs' }, a)),
    ...(r.slaac ?? []).map((a) => createElement('span', { key: a, className: 'font-mono text-xs' }, a, slaacTag)),
  );

const byLeft = (r: LeaseRow): number | undefined => (r.expires === false ? Number.MAX_SAFE_INTEGER : r.expires);
const nameColumn: Column<LeaseRow> = { label: 'Name', cell: nameCell, sort: (r) => r.name, compact: true };

// every column shows in Home's widgets too (compact): the MAC and DUID are what tell two devices apart
const macColumn: Column<LeaseRow> = { label: 'MAC', cell: (r) => mono(r.mac), sort: (r) => r.mac?.toLowerCase(), compact: true };

export const columns4: readonly Column<LeaseRow>[] = [
  nameColumn,
  { label: 'IPv4 address', cell: addrCell, sort: (r) => r.addrs[0], compact: true },
  macColumn,
  { label: 'Lease left', cell: (r) => leftText(r.expires), sort: byLeft, sortDescFirst: true, compact: true },
];

export const columns6: readonly Column<LeaseRow>[] = [
  nameColumn,
  { label: 'IPv6 addresses', cell: addrCell, compact: true },
  macColumn,
  { label: 'DUID', cell: (r) => mono(r.duid), className: 'break-all', compact: true },
  { label: 'Lease left', cell: leaseLeftText, sort: byLeft, sortDescFirst: true, compact: true },
];

/** Both lease lists with names (IPv6 with the SLAAC addresses seen), and how DHCPv6 is set (server, relay or off). */
export async function loadLeases(): Promise<{ v4: LeaseRow[]; v6: LeaseRow[]; dhcpv6: Dhcpv6Mode }> {
  const [leases, dhcp, hints] = await Promise.all([
    getDhcpLeases(),
    getConfig('dhcp').catch(() => []),
    getHostHints().catch((): HostHints => ({})),
  ]);
  const names = namesFromRouter(leases, hints, dhcp);
  const lan = dhcp.find((s) => s['.type'] === 'dhcp' && str(s, 'interface') === 'lan');
  return {
    v4: leaseRows4(leases.v4, names),
    v6: leaseRows6(leases.v6, names, hints),
    dhcpv6: dhcpv6Mode(str(lan, 'dhcpv6')),
  };
}

export type LanTab = 'settings' | 'addresses' | 'connections';

export const lanTabs: readonly TabItem<LanTab>[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'addresses', label: 'Addresses' },
  { id: 'connections', label: 'Connections' },
];
