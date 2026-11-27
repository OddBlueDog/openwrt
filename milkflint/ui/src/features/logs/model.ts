// The Logs page's settings form: milkflint.logs as the settings card edits
// it (no checks: every value comes from a switch or a list).
import { z } from 'zod';

export const logSettingsSchema = z.object({
  persist: z.boolean(),
  /** MB per log */
  size: z.string(),
  wifi: z.boolean(),
  /** seconds between samples: the Wi-Fi log's devices, the debug counters */
  interval: z.string(),
  /** Wi-Fi log: how busy each channel was, and with what (wifi_channel) */
  channel: z.boolean(),
  /** Wi-Fi log: the MU/OFDMA and beamforming counters once a minute, and the driver's statistics for them (wifi_mu) */
  mu: z.boolean(),
  /** Wi-Fi log: ask devices how they hear the router, 802.11k (wifi_rrm) */
  rrm: z.boolean(),
  /** Wi-Fi log: the Network Quality rounds (wifi_net) */
  net: z.boolean(),
  /** the radar log: hostapd's radar events, kept on the router's storage (radar) */
  radar: z.boolean(),
  /** debug log: the load and packets at each hop every interval (debug_counters) */
  counters: z.boolean(),
  /** debug log: everything at once when the internet or a device stops (debug_snapshot) */
  snapshot: z.boolean(),
  /** the DNS log: slow and unanswered lookups, a summary every minute (dns) */
  dns: z.boolean(),
  /** the kernel's memory error checker, KFENCE, whose reports the Crashes tab shows (kfence) */
  kfence: z.boolean(),
  /** dnsmasq's section, whose logqueries goes with `dns`; not edited */
  dnsmasq: z.union([z.string(), z.undefined()]),
});

/** milkflint.logs, as the settings card edits it. */
export type LogSettings = z.infer<typeof logSettingsSchema>;
