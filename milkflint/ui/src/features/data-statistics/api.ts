import { z } from 'zod';
import { getInterfaces } from '@/lib/api/network';
import { bool, getConfig, type Section, str } from '@/lib/api/uci';
import { call } from '@/lib/ubus';
import type { DataUsageForm } from './model';

const periodsSchema = z.object({
  installed: z.boolean(),
  /** Off: nlbwmon is stopped and counts nothing. Absent from older routers, where it's always on. */
  enabled: z.boolean().optional(),
  periods: z.array(z.string()),
});

export function getPeriods(): Promise<z.output<typeof periodsSchema>> {
  return call('milkflint.traffic', 'periods', {}, periodsSchema);
}

const tableSchema = z.object({
  columns: z.array(z.string()),
  data: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
});

export interface UsageRow {
  key: string;
  ip: string | undefined;
  conns: number;
  /** Bytes the device received (its download). */
  rx: number;
  /** Bytes the device sent (its upload). */
  tx: number;
}

/** nlbwmon's table for a period ('' = current), as rows by device (mac) or by application (layer7). */
export async function getUsage(period: string, group: 'mac' | 'layer7'): Promise<UsageRow[]> {
  const t = await call('milkflint.traffic', 'usage', { period, group }, tableSchema);
  const col = (name: string): number => t.columns.indexOf(name);
  const [cKey, cIp, cConns, cRx, cTx] = [col(group), col('ip'), col('conns'), col('rx_bytes'), col('tx_bytes')];
  const num = (v: string | number | null | undefined): number => (typeof v === 'number' ? v : 0);
  const rows = new Map<string, UsageRow>();
  for (const r of t.data) {
    const key = String(r[cKey] ?? 'other');
    const row = rows.get(key) ?? { key, ip: undefined, conns: 0, rx: 0, tx: 0 };
    const ip = cIp >= 0 ? r[cIp] : undefined;
    if (typeof ip === 'string' && !ip.includes(':')) row.ip = ip;
    row.conns += num(r[cConns]);
    row.rx += num(r[cRx]);
    row.tx += num(r[cTx]);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.rx + b.tx - (a.rx + a.tx));
}

/** The router's own IPv4 addresses: its traffic isn't a device's. */
export async function loadRouterIps(): Promise<Set<string>> {
  const ifaces = await getInterfaces().catch(() => []);
  return new Set(ifaces.flatMap((i) => (i['ipv4-address'] ?? []).map((a) => a.address)));
}

/** "1 Oct 2026" for an accounting period's start (YYYY-MM-DD). */
export function periodStart(start: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

/** Counting's settings as saved, with what the form can't change. */
export interface DataUsageSettings extends DataUsageForm {
  /** milkflint.datastats, the on/off: missing on routers from before it */
  toggle: boolean;
  /** nlbwmon's own section, with the accounting period */
  section: string | undefined;
}

export async function loadSettings(): Promise<DataUsageSettings> {
  const [nlbwmon, milkflint] = await Promise.all([
    getConfig('nlbwmon').catch((): Section[] => []),
    getConfig('milkflint').catch((): Section[] => []),
  ]);
  const s = nlbwmon.find((x) => x['.type'] === 'nlbwmon');
  const ds = milkflint.find((x) => x['.name'] === 'datastats');
  const interval = str(s, 'database_interval') ?? '1';
  return {
    toggle: ds !== undefined,
    enabled: bool(ds, 'enabled', true),
    history: bool(ds, 'history', false),
    section: s?.['.name'],
    day: /^\d+$/.test(interval) ? interval : 'custom',
  };
}
