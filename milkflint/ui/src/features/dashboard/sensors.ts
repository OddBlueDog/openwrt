// The temperature sensors as Home shows them (the Temperatures widget and
// its tile): what each measures, in words, and the history the router
// records (every 10 s, kept in RAM), so it's there when the page opens.
import { dashboardQueries } from './queries';
import { useLive } from '@/lib/query/use-live';
import type { Live } from '@/lib/query/use-live';
import type { Stats } from '@/lib/api/stats';
import { SAMPLE_SENSOR, type SensorHistory, type SensorSample } from './api';
import type { Dashboard } from './use-dashboard';

/** The recorder's interval, if it doesn't say. */
export const STEP_S = 10;

type Sensor = Stats['temperatures'][number];

/** "WAN port", "LAN 1 port", "Wi-Fi 5 GHz", "CPU": what the sensor measures, rather than its driver's name. */
export function sensorLabel(t: Sensor, d: Pick<Dashboard, 'wan' | 'radios'>): string {
  if (typeof t.port === 'string') {
    if (t.port === d.wan?.device || t.port === d.wan?.l3_device) return 'WAN port';
    const lan = /^lan(\d+)$/.exec(t.port);
    return lan === null ? `Port ${t.port}` : `LAN ${lan[1] ?? ''} port`;
  }
  if (typeof t.wiphy === 'string') {
    const band = d.radios.find((r) => r.phy === t.wiphy)?.band;
    return band === undefined ? `Wi-Fi (${t.wiphy})` : `Wi-Fi ${band}`;
  }
  return /cpu/i.test(t.name) ? 'CPU' : t.name;
}

/** One value per `step` seconds over the window, oldest first; gaps where nothing was recorded. */
export function slotted(
  samples: readonly SensorSample[],
  name: string,
  now: number,
  slots: number,
  step: number,
): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: slots }, () => undefined);
  const start = now - (slots - 1) * step;
  for (const s of samples) {
    const i = Math.round((s.t - start) / step);
    const v = s.c[name];
    if (i >= 0 && i < slots && v !== undefined) out[i] = v;
  }
  return out;
}

/** `pnpm dev` on the VM: sample sensors (use-dashboard.ts), with a sample history to match. */
export function sampleSensors(sensors: readonly Sensor[]): boolean {
  return import.meta.env.DEV && sensors.length > 0 && sensors.every((t) => t.name.startsWith(SAMPLE_SENSOR));
}

/** The recorded history, polled at the recorder's pace. */
export function useSensorHistory(sensors: readonly Sensor[]): Live<SensorHistory> {
  const sample = sampleSensors(sensors);
  return useLive(
    dashboardQueries.sensorHistory(sample, async () => (await import('@/dev/sample-sensors')).sampleHistory(sensors)),
  );
}
