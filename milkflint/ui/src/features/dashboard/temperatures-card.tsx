// Each temperature sensor with a small graph of the last 10 minutes or hour
// and its lowest and highest in that time. The history is recorded on the
// router (every 10 s, kept in RAM), so it's there when the page opens; the
// current reading comes with the dashboard's own poll.
import { ThermometerIcon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Sparkline } from '@/components/charts/sparkline';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { usePoll } from '@/hooks/use-poll';
import type { Stats } from '@/lib/api/stats';
import { cn } from '@/lib/utils';
import { getSensorHistory, type SensorSample } from './api';
import type { Dashboard } from './use-dashboard';

const windows = [
  { minutes: 10, label: '10 min', description: 'Last 10 minutes' },
  { minutes: 60, label: '1 hour', description: 'Last hour' },
] as const;
/** The recorder's interval, if it doesn't say. */
const STEP_S = 10;

function tempTone(c: number): string {
  return c >= 85 ? 'text-destructive' : c >= 70 ? 'text-warning' : 'text-foreground';
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
function slotted(samples: readonly SensorSample[], name: string, now: number, slots: number, step: number): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: slots }, () => undefined);
  const start = now - (slots - 1) * step;
  for (const s of samples) {
    const i = Math.round((s.t - start) / step);
    const v = s.c[name];
    if (i >= 0 && i < slots && v !== undefined) out[i] = v;
  }
  return out;
}

export function TemperaturesCard({ d }: { d: Dashboard }): ReactElement | null {
  const [minutes, setMinutes] = useState<number>(windows[0].minutes);
  const history = usePoll(getSensorHistory, STEP_S * 1000);
  const sensors = d.stats.temperatures;
  if (sensors.length === 0) return null;

  const step = history.data?.interval ?? STEP_S;
  const slots = Math.round((minutes * 60) / step);
  const recorded = history.data !== undefined && history.data.samples.length > 0;
  const shown = windows.find((w) => w.minutes === minutes) ?? windows[0];

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Temperatures</CardTitle>
          <CardDescription>
            {recorded
              ? `${shown.description}, lowest and highest`
              : history.error !== undefined && history.data === undefined
                ? 'Now only: this firmware doesn’t record them'
                : 'Recording: the graphs fill in every 10 s'}
          </CardDescription>
        </div>
        <CardAction>
          <div role="group" aria-label="Time shown" className="inline-flex w-fit gap-0.5 rounded-md border p-0.5">
            {windows.map((w) => (
              <Button
                key={w.minutes}
                type="button"
                size="sm"
                variant={minutes === w.minutes ? 'secondary' : 'ghost'}
                className="h-7 px-3"
                aria-pressed={minutes === w.minutes}
                onClick={() => {
                  setMinutes(w.minutes);
                }}
              >
                {w.label}
              </Button>
            ))}
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {sensors.map((t) => {
          const values =
            history.data === undefined ? [] : slotted(history.data.samples, t.name, history.data.now, slots, step);
          const seen = [t.celsius, ...values.filter((v): v is number => v !== undefined)];
          const lo = Math.min(...seen);
          const hi = Math.max(...seen);
          // the graph's scale: this sensor's own range, at least 10 °C tall,
          // so a steady temperature draws flat rather than as big swings
          const span = Math.max(10, hi - lo);
          const floor = (lo + hi - span) / 2;
          return (
            <div key={t.name} className="flex min-w-0 flex-col gap-1 rounded-lg border bg-background/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground" title={t.name}>
                  <ThermometerIcon className="size-3.5 shrink-0" />
                  <span className="truncate">{sensorLabel(t, d)}</span>
                </span>
                <span className={cn('text-lg font-semibold tabular', tempTone(t.celsius))}>{t.celsius.toFixed(0)} °C</span>
              </div>
              <Sparkline
                values={values.map((v) => (v === undefined ? undefined : v - floor))}
                max={span}
                slots={slots}
                color="var(--chart-3)"
                className="h-10"
                label={sensorLabel(t, d)}
                format={(v) => `${(v + floor).toFixed(1)} °C`}
                timeOf={(slot) => (history.data === undefined ? undefined : history.data.now - (slots - 1 - slot) * step)}
              />
              <div className="flex justify-between text-xs text-muted-foreground tabular">
                <span>Low {lo.toFixed(0)} °C</span>
                <span>High {hi.toFixed(0)} °C</span>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
