// Each temperature sensor (the CPU, each Wi-Fi radio, the Ethernet ports'
// PHYs) with its reading now, a graph of the last 10 minutes or hour, and its
// lowest and highest in that time. The history is recorded on the router
// (every 10 s, kept in RAM), so it's there when the page opens; the current
// reading comes with the dashboard's own poll. A row of its own on Home.
import { ThermometerIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { Segmented } from '@/components/ui/segmented';
import { usePoll } from '@/hooks/use-poll';
import type { Stats } from '@/lib/api/stats';
import { cn } from '@/lib/utils';
import { getSensorHistory, SAMPLE_SENSOR, type SensorHistory, type SensorSample } from './api';
import { CHIP_LIMIT_C, HOT_C, WARM_C, temperatureLevel } from './model';
import type { Dashboard } from './use-dashboard';
import { Widget } from './widget';

const windows = {
  '10': { minutes: 10, label: '10 min', description: 'Last 10 minutes' },
  '60': { minutes: 60, label: '1 hour', description: 'Last hour' },
} as const;
type WindowKey = keyof typeof windows;
/** The recorder's interval, if it doesn't say. */
const STEP_S = 10;

/** Warm and hot by how close a chip is to protecting itself (model.ts), said in words too, not by colour alone. */
function heat(c: number): { tone: string; word?: string } {
  const level = temperatureLevel(c);
  if (level === 'hot') return { tone: 'text-destructive', word: 'Hot' };
  if (level === 'warm') return { tone: 'text-warning', word: 'Warm' };
  return { tone: 'text-foreground' };
}

/** "WAN port", "LAN 1 port", "Wi-Fi 5 GHz", "CPU": what the sensor measures, rather than its driver's name. */
function sensorLabel(t: Stats['temperatures'][number], d: Dashboard): string {
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
function slotted(
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

export function TemperaturesCard({ d }: { d: Dashboard }): ReactElement {
  const [range, setRange] = useState<WindowKey>('10');
  const sensors = d.stats.temperatures;
  // `pnpm dev` on the VM: sample sensors (use-dashboard.ts), with a sample history to match
  const sample = import.meta.env.DEV && sensors.length > 0 && sensors.every((t) => t.name.startsWith(SAMPLE_SENSOR));
  const history = usePoll(
    async (): Promise<SensorHistory> =>
      sample ? (await import('@/dev/sample-sensors')).sampleHistory(sensors) : getSensorHistory(),
    STEP_S * 1000,
    sample ? 'sample' : '',
  );
  const shown = windows[range];

  const step = history.data?.interval ?? STEP_S;
  const slots = Math.round((shown.minutes * 60) / step);
  const recorded = history.data !== undefined && history.data.samples.length > 0;

  if (sensors.length === 0) {
    return (
      <Widget icon={ThermometerIcon} title="Temperatures">
        <p className="px-5 text-sm text-muted-foreground">This router doesn’t report any temperature sensors.</p>
      </Widget>
    );
  }

  return (
    <Widget
      icon={ThermometerIcon}
      title="Temperatures"
      status={
        sample
          ? 'Sample readings: the dev VM has no sensors (pnpm dev only)'
          : recorded
            ? `${shown.description}: now, and the lowest to highest`
            : history.error !== undefined && history.data === undefined
              ? 'Now only: this firmware doesn’t record them'
              : 'Recording: the graphs fill in every 10 s'
      }
      aside={
        <Segmented
          label="Time shown"
          value={range}
          options={(Object.keys(windows) as WindowKey[]).map((key) => ({ value: key, label: windows[key].label }))}
          onChange={setRange}
        />
      }
    >
      {/* narrow (half a row, a phone): a compact row per sensor, the reading beside its name and the
          graph under it; wide (a row of its own): as many sensors side by side as fit, each a column */}
      <ul className="flex flex-col gap-3 px-5 @2xl:grid @2xl:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] @2xl:gap-x-6 @2xl:gap-y-5">
        {sensors.map((t) => {
          const name = sensorLabel(t, d);
          const values = history.data === undefined ? [] : slotted(history.data.samples, t.name, history.data.now, slots, step);
          const seen = [t.celsius, ...values.filter((v): v is number => v !== undefined)];
          const lo = Math.min(...seen);
          const hi = Math.max(...seen);
          // the graph's scale: this sensor's own range, at least 10 °C tall,
          // so a steady temperature draws flat rather than as big swings
          const span = Math.max(10, hi - lo);
          const floor = (lo + hi - span) / 2;
          const h = heat(t.celsius);
          return (
            <li
              key={t.name}
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @2xl:flex @2xl:flex-col @2xl:items-stretch @2xl:gap-1.5"
            >
              <span className="truncate text-sm text-muted-foreground" title={t.name}>
                {name}
              </span>
              <span className="flex items-baseline justify-end gap-2 @2xl:justify-start">
                <span className={cn('text-lg font-semibold tracking-tight tabular @2xl:text-2xl', h.tone)}>
                  {t.celsius.toFixed(0)}
                  <span className="ml-0.5 text-sm font-medium text-muted-foreground">°C</span>
                </span>
                {h.word !== undefined && <span className={cn('text-xs font-medium', h.tone)}>{h.word}</span>}
              </span>
              {values.every((v) => v === undefined) ? (
                <span className="flex h-6 items-center text-xs text-muted-foreground @2xl:h-10">No readings recorded yet</span>
              ) : (
                <Sparkline
                  values={values.map((v) => (v === undefined ? undefined : v - floor))}
                  max={span}
                  slots={slots}
                  color="var(--chart-3)"
                  className="h-6 w-full rounded-sm bg-muted/50 @2xl:h-10"
                  label={name}
                  format={(v) => `${(v + floor).toFixed(1)} °C`}
                  timeOf={(slot) => (history.data === undefined ? undefined : history.data.now - (slots - 1 - slot) * step)}
                />
              )}
              <span className="text-xs text-muted-foreground tabular">
                Low {lo.toFixed(0)} · High {hi.toFixed(0)} °C
              </span>
            </li>
          );
        })}
      </ul>
      <p className="px-5 text-xs text-muted-foreground">
        Warm from {WARM_C} °C, hot from {HOT_C} °C. The chips start protecting themselves at {CHIP_LIMIT_C} °C: the Wi-Fi slows
        its sending, and at {CHIP_LIMIT_C + 5} °C the router turns itself off.
      </p>
    </Widget>
  );
}
