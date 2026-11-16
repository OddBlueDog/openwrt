// Sample temperature sensors for `pnpm dev` only. The QEMU VM has no sensors,
// so Home's Temperatures card would never show there; when the router
// reports none, the dashboard fills in these (behind import.meta.env.DEV, so
// the built UI leaves this file out). Readings drift slowly and the same way
// on every poll, so the card's graphs, lows and highs look like a router's.
import { SAMPLE_SENSOR, type SensorHistory } from '@/features/dashboard/api';
import type { Stats } from '@/lib/api/stats';

type Sensor = Stats['temperatures'][number];

interface Shape {
  key: string;
  /** a typical reading, the drift around it, its period in seconds */
  base: number;
  swing: number;
  period: number;
  where: { wiphy?: string; port?: string };
}

/** The Flint 2's kinds: the CPU, each radio, the WAN port's PHY and a LAN port's. */
function shapes(phys: readonly string[], wanPort: string | undefined): Shape[] {
  return [
    // a quiet router's usual readings
    { key: 'cpu', base: 42, swing: 1, period: 1500, where: {} },
    ...phys.map((phy, i) => ({ key: phy, base: 48 - i, swing: 1, period: 1100 + 300 * i, where: { wiphy: phy } })),
    { key: 'wan-phy', base: 46, swing: 1, period: 1800, where: { port: wanPort ?? 'wan' } },
    { key: 'lan5-phy', base: 45, swing: 0.5, period: 2100, where: { port: 'lan5' } },
  ];
}

const reading = (s: Shape, t: number): number => s.base + s.swing * Math.sin((2 * Math.PI * t) / s.period);

export function sampleTemperatures(phys: readonly string[], wanPort: string | undefined): Sensor[] {
  const t = Date.now() / 1000;
  return shapes(phys, wanPort).map((s) => ({ name: `${SAMPLE_SENSOR}${s.key}`, celsius: reading(s, t), ...s.where }));
}

/** The last hour at the recorder's 10 s, for the same sensors. */
export function sampleHistory(sensors: readonly Sensor[]): SensorHistory {
  const now = Math.floor(Date.now() / 10_000) * 10;
  const byName = new Map(
    shapes(
      sensors.flatMap((s) => (typeof s.wiphy === 'string' ? [s.wiphy] : [])),
      sensors.find((s) => s.name.endsWith('wan-phy'))?.port ?? undefined,
    ).map((s) => [`${SAMPLE_SENSOR}${s.key}`, s]),
  );
  const samples = Array.from({ length: 360 }, (_, i) => {
    const t = now - (359 - i) * 10;
    const c: Record<string, number> = {};
    for (const [name, s] of byName) c[name] = reading(s, t);
    return { t, c };
  });
  return { now, interval: 10, samples };
}
