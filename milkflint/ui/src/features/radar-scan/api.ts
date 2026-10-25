import { z } from 'zod';
import { call } from '@/lib/ubus';

const pulse = z.object({
  /** periodic, long or hw: the chip's three pulse lists */
  kind: z.string(),
  /** the chip's timestamp, its units */
  start: z.number(),
  /** the chip's units, not converted */
  width: z.number(),
  /** signed, the chip's units (no calibration) */
  power: z.number(),
});

/** One radar report from the chip (MilkFlint's mt7915 driver keeps the last 8, debugfs rdd_reports). */
const report = z
  .object({
    seq: z.number(),
    /** unix seconds */
    time: z.number().optional(),
    /** the radio's channel then: control MHz, width MHz, centre MHz */
    freq: z.number().optional(),
    width: z.number().optional(),
    center: z.number().optional(),
    /** which of the chip's radar patterns matched */
    type: z.number().optional(),
    long: z.number().optional(),
    constant: z.number().optional(),
    staggered: z.number().optional(),
    periodic_pulses: z.number().optional(),
    long_pulses: z.number().optional(),
    hw_pulses: z.number().optional(),
    /** pulse repetition interval, the chip's units */
    pri_const: z.number().optional(),
    pri_stg: z.array(z.number()).optional(),
    pulses: z.array(pulse),
  })
  .loose();
export type ChipReport = z.output<typeof report>;

const block = z.object({
  /** control channel MHz, width MHz, centre MHz, and the 20 MHz channels it covers */
  freq: z.number(),
  width: z.number(),
  center: z.number(),
  channels: z.array(z.number()),
  status: z.enum(['waiting', 'listening', 'clear', 'radar', 'stopped', 'skipped', 'failed']),
  started: z.number().optional(),
  ended: z.number().optional(),
  elapsed: z.number().optional(),
  /** seconds into listening when radar was first heard */
  heard_after: z.number().optional(),
  /** channels radar put off limits during it */
  off_limits: z.array(z.number()).optional(),
  /** the chip's reports while it listened */
  reports: z.array(report).optional(),
  error: z.string().optional(),
});
export type ScanBlock = z.output<typeof block>;

const scanStatus = z.object({
  state: z.enum(['none', 'starting', 'running', 'done']),
  /** the scan's process is alive */
  alive: z.boolean().optional(),
  /** unix seconds, by the router's clock */
  now: z.number(),
  started: z.number().optional(),
  ended: z.number().optional(),
  /** how long each block is listened to */
  seconds: z.number().optional(),
  radio: z.string().optional(),
  phy: z.string().optional(),
  blocks: z.array(block).optional(),
  stopped: z.boolean().optional(),
  error: z.string().nullish(),
});
export type ScanStatus = z.output<typeof scanStatus>;

export interface BlockRequest {
  freq: number;
  width: number;
  center: number;
}

export function getScanStatus(): Promise<ScanStatus> {
  return call('milkflint.radarscan', 'status', {}, scanStatus);
}

/** Listen on these blocks of the 5 GHz radio, `seconds` each; its network is down meanwhile. */
export async function startScan(radio: string, phy: string, blocks: readonly BlockRequest[], seconds: number): Promise<void> {
  const res = await call(
    'milkflint.radarscan',
    'start',
    { radio, phy, blocks, seconds },
    z.object({ started: z.boolean().optional(), error: z.string().optional() }),
  );
  if (res.error !== undefined) throw new Error(res.error === 'busy' ? 'A radar scan is already running.' : `The router refused the scan (${res.error}).`);
}

export async function stopScan(): Promise<void> {
  await call('milkflint.radarscan', 'stop', {}, z.object({ stopping: z.boolean() }));
}

/** The chip's last radar reports, newest last; null when the Wi-Fi driver doesn't keep them. */
export function getChipReports(phy: string): Promise<ChipReport[] | null> {
  return call('milkflint.radarscan', 'reports', { phy }, z.object({ reports: z.array(report).nullable() })).then((r) => r.reports);
}
