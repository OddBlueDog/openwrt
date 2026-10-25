import { z } from 'zod';
import { call } from '@/lib/ubus';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';

export type LogKind = 'system' | 'kernel' | 'wifi' | 'radar' | 'debug' | 'crash';

/**
 * The last `lines` lines of the system log, the kernel log, the Wi-Fi log,
 * the radar log, the debug log or the kernel's crash reports. With the logs
 * kept across reboots, the system and kernel logs come from the router's
 * saved copy, which goes back past the last restart.
 */
export function readLog(kind: LogKind, lines: number): Promise<string[]> {
  return call('milkflint.logs', 'read', { kind, lines }, z.object({ lines: z.array(z.string()) })).then((r) => r.lines);
}

const statusSchema = z.object({
  persist: z.boolean(),
  wifi: z.boolean(),
  /** what the Wi-Fi log adds to its device lines (absent from older routers) */
  channel: z.boolean().optional(),
  mu: z.boolean().optional(),
  rrm: z.boolean().optional(),
  net: z.boolean().optional(),
  /** the radar log (absent from older routers) */
  radar: z.boolean().optional(),
  /** the debug log's counters and snapshots (absent from older routers) */
  counters: z.boolean().optional(),
  snapshot: z.boolean().optional(),
  /** the log keeper is running */
  recording: z.boolean(),
  /** where the logs are written */
  dir: z.string(),
  /** the saved system log's size, both halves; null when it isn't saved */
  system_bytes: z.number().nullable(),
  wifi_bytes: z.number().nullable(),
  radar_bytes: z.number().nullish(),
  debug_bytes: z.number().nullish(),
  /** the kernel's crash reports kept since the last restart (pstore) */
  crash_reports: z.number().optional(),
});
export type LogStatus = z.output<typeof statusSchema>;

export function getLogStatus(): Promise<LogStatus> {
  return call('milkflint.logs', 'status', {}, statusSchema);
}

/** milkflint.logs, as the settings card edits it. */
export interface LogSettings {
  persist: boolean;
  /** MB per log */
  size: string;
  wifi: boolean;
  /** seconds between samples: the Wi-Fi log's devices, the debug counters */
  interval: string;
  /** Wi-Fi log: how busy each channel was, and with what (wifi_channel) */
  channel: boolean;
  /** Wi-Fi log: the MU/OFDMA and beamforming counters once a minute, and the driver's statistics for them (wifi_mu) */
  mu: boolean;
  /** Wi-Fi log: ask devices how they hear the router, 802.11k (wifi_rrm) */
  rrm: boolean;
  /** Wi-Fi log: the Network Quality rounds (wifi_net) */
  net: boolean;
  /** the radar log: hostapd's radar events, kept on the router's storage (radar) */
  radar: boolean;
  /** debug log: the load and packets at each hop every interval (debug_counters) */
  counters: boolean;
  /** debug log: everything at once when the internet or a device stops (debug_snapshot) */
  snapshot: boolean;
}

export async function getLogSettings(): Promise<LogSettings> {
  const s = (await getConfig('milkflint')).find((x) => x['.name'] === 'logs');
  return {
    persist: bool(s, 'persist', false),
    size: str(s, 'size') ?? '3',
    wifi: bool(s, 'wifi', true),
    interval: str(s, 'wifi_interval') ?? '10',
    channel: bool(s, 'wifi_channel', true),
    mu: bool(s, 'wifi_mu', true),
    rrm: bool(s, 'wifi_rrm', true),
    net: bool(s, 'wifi_net', true),
    radar: bool(s, 'radar', true),
    counters: bool(s, 'debug_counters', false),
    snapshot: bool(s, 'debug_snapshot', false),
  };
}

export function logSettingsChanges(f: LogSettings): Change[] {
  return [
    {
      op: 'set',
      config: 'milkflint',
      section: 'logs',
      values: {
        persist: f.persist ? '1' : '0',
        size: f.size,
        wifi: f.wifi ? '1' : '0',
        wifi_interval: f.interval,
        wifi_channel: f.channel ? '1' : '0',
        wifi_mu: f.mu ? '1' : '0',
        wifi_rrm: f.rrm ? '1' : '0',
        wifi_net: f.net ? '1' : '0',
        radar: f.radar ? '1' : '0',
        debug_counters: f.counters ? '1' : '0',
        debug_snapshot: f.snapshot ? '1' : '0',
      },
    },
  ];
}
