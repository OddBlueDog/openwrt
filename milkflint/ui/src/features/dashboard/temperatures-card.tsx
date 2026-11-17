// Each temperature sensor (the CPU, each Wi-Fi radio, the Ethernet ports'
// PHYs) with its reading now, a graph of the last 10 minutes or hour, and its
// lowest and highest in that time. The history is recorded on the router
// (every 10 s, kept in RAM), so it's there when the page opens; the current
// reading comes with the dashboard's own poll. A row of its own on Home.
import { type ReactElement, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { Segmented } from '@/components/ui/segmented';
import { cn } from '@/lib/utils';
import { CHIP_LIMIT_C, HOT_C, WARM_C, temperatureLevel } from './model';
import { sampleSensors, sensorLabel, slotted, STEP_S, useSensorHistory } from './sensors';
import type { Dashboard } from './use-dashboard';
import { Widget } from './widget';
import { useWidgetInfo } from './widget-info';

const windows = {
  '10': { minutes: 10, label: '10 min', description: 'Last 10 minutes' },
  '60': { minutes: 60, label: '1 hour', description: 'Last hour' },
} as const;
type WindowKey = keyof typeof windows;
/** Warm and hot by how close a chip is to protecting itself (model.ts), said in words too, not by colour alone. */
function heat(c: number): { tone: string; word?: string } {
  const level = temperatureLevel(c);
  if (level === 'hot') return { tone: 'text-destructive', word: 'Hot' };
  if (level === 'warm') return { tone: 'text-warning', word: 'Warm' };
  return { tone: 'text-foreground' };
}

export function TemperaturesCard({ d }: { d: Dashboard }): ReactElement {
  const [range, setRange] = useState<WindowKey>('10');
  const sensors = d.stats.temperatures;
  const sample = sampleSensors(sensors);
  const history = useSensorHistory(sensors);
  const shown = windows[range];
  // one row tall and less than the whole width: a line per sensor, its graph between its name and its reading
  const { size } = useWidgetInfo();
  const brief = size.h === 1 && size.w < 4;

  const step = history.data?.interval ?? STEP_S;
  const slots = Math.round((shown.minutes * 60) / step);
  const recorded = history.data !== undefined && history.data.samples.length > 0;

  if (sensors.length === 0) {
    return (
      <Widget>
        <p className="px-5 text-sm text-muted-foreground">This router doesn’t report any temperature sensors.</p>
      </Widget>
    );
  }

  return (
    <Widget
      status={
        sample
          ? 'Sample readings: the dev VM has no sensors (pnpm dev only)'
          : recorded
            ? brief
              ? shown.description
              : `${shown.description}: now, and the lowest to highest`
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
      {/* one row tall and narrower than the whole row: a line per sensor, its name, its graph and its reading.
          Otherwise, narrow (a column, a phone): the reading beside the name, and under them the graph and its
          lowest to highest; wide (a row of its own): as many sensors side by side as fit, each a column */}
      <ul
        className={cn(
          'px-5',
          brief
            ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] gap-x-3 gap-y-1.5'
            : 'flex flex-col gap-3 @2xl:grid @2xl:grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] @2xl:gap-x-6 @2xl:gap-y-5',
        )}
      >
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
          const lowHigh = `Lowest ${lo.toFixed(0)} °C, highest ${hi.toFixed(0)} °C`;
          const reading = (
            <span className={cn('flex items-baseline justify-end gap-2', !brief && '@2xl:justify-start')}>
              <span className={cn('font-semibold tracking-tight tabular', brief ? 'text-base' : 'text-lg @2xl:text-2xl', h.tone)}>
                {t.celsius.toFixed(0)}
                <span className="ml-0.5 text-sm font-medium text-muted-foreground">°C</span>
              </span>
              {h.word !== undefined && <span className={cn('text-xs font-medium', h.tone)}>{h.word}</span>}
            </span>
          );
          const graph = values.every((v) => v === undefined) ? (
            <span className={cn('flex items-center text-xs text-muted-foreground', brief ? 'h-5' : 'h-6 @2xl:h-10')}>
              {brief ? '' : 'No readings recorded yet'}
            </span>
          ) : (
            <Sparkline
              values={values.map((v) => (v === undefined ? undefined : v - floor))}
              max={span}
              slots={slots}
              color="var(--chart-3)"
              className={cn('w-full rounded-sm bg-muted/50', brief ? 'h-5' : 'h-6 @2xl:h-10')}
              label={name}
              format={(v) => `${(v + floor).toFixed(1)} °C`}
              timeOf={(slot) => (history.data === undefined ? undefined : history.data.now - (slots - 1 - slot) * step)}
            />
          );
          return brief ? (
            <li
              key={t.name}
              data-fit
              // the list's columns, so every sensor's graph lines up whatever its reading says
              className="col-span-3 grid min-w-0 grid-cols-subgrid items-center"
              title={lowHigh}
            >
              <span className="truncate text-sm text-muted-foreground" title={t.name}>
                {name}
              </span>
              {graph}
              {reading}
            </li>
          ) : (
            <li
              key={t.name}
              data-fit
              className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 @2xl:flex @2xl:flex-col @2xl:items-stretch @2xl:gap-1.5"
            >
              <span className="truncate text-sm text-muted-foreground" title={t.name}>
                {name}
              </span>
              {reading}
              {graph}
              {/* narrow: lowest to highest in short beside the graph; wide: in words under it */}
              <span className="text-xs whitespace-nowrap text-muted-foreground tabular" title={lowHigh}>
                <span className="@2xl:hidden">
                  {lo.toFixed(0)}–{hi.toFixed(0)} °C
                </span>
                <span className="hidden @2xl:inline">
                  Low {lo.toFixed(0)} · High {hi.toFixed(0)} °C
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <p data-fit className="px-5 text-xs text-muted-foreground">
        Warm from {WARM_C} °C, hot from {HOT_C} °C. The chips start protecting themselves at {CHIP_LIMIT_C} °C: the Wi-Fi slows
        its sending, and at {CHIP_LIMIT_C + 5} °C the router turns itself off.
      </p>
    </Widget>
  );
}
