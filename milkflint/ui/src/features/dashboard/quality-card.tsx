import type { ReactElement } from 'react';
import { niceCeil } from '@/components/charts/path';
import { Sparkline } from '@/components/charts/sparkline';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatNumber, formatPercent } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { useLive, WINDOW_SECONDS } from '../network-quality/live';
import { rating, summarize } from '../network-quality/score';
import { ScoreRing } from '../network-quality/score-ring';

const ms = (v: number | undefined): string => (v === undefined ? '—' : `${formatNumber(v, v < 10 ? 1 : 0)} ms`);

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }): ReactElement {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('font-medium tabular', warn && 'text-warning')}>{value}</dd>
    </div>
  );
}

/** Network Quality's score and latest figures, while it's on. */
export function QualityCard(): ReactElement | null {
  const { data } = useLive(5000);
  if (data?.status.enabled !== true) return null;
  const { status, samples } = data;
  const summary = summarize(
    samples.filter((s) => s.t > status.now - WINDOW_SECONDS),
    status.gateway_answers,
  );
  const r = summary.score === undefined ? undefined : rating(summary.score);
  const internet = summary.probes.internet;
  const pings = samples.map((s) => s.internet ?? undefined);
  const slots = Math.round(3600 / (status.interval ?? 5));
  // the chart's top follows the hour's typical ping, so the baseline stays
  // visible and spikes (cut off at the top) stand out
  const answered = pings.filter((p) => p !== undefined).sort((a, b) => a - b);
  const top = niceCeil(Math.max(20, 4 * (answered[Math.floor(answered.length / 2)] ?? 0)));

  return (
    <Card className="gap-3 overflow-hidden pb-0">
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Network quality</CardTitle>
          <CardDescription>Over the last 5 minutes</CardDescription>
        </div>
        <CardAction>
          <a href={href('network-quality')} className="text-xs text-primary hover:underline">
            Details
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="flex items-center gap-5">
        <ScoreRing score={summary.score} compact />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span
            className={cn(
              'text-lg leading-none font-semibold',
              r === undefined ? 'text-muted-foreground' : r.tone === 'success' ? 'text-success' : r.tone === 'warning' ? 'text-warning' : 'text-destructive',
            )}
          >
            {r?.label ?? 'Measuring…'}
          </span>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <Stat label="Ping" value={ms(internet.typical)} />
            <Stat label="Jitter" value={ms(summary.jitter)} />
            <Stat label="Loss" value={formatPercent(internet.loss)} warn={internet.loss > 0} />
            <Stat label="DNS" value={ms(summary.probes.dns.typical)} />
          </dl>
        </div>
      </CardContent>
      <div>
        <p className="flex justify-between gap-2 px-5 text-[11px] text-muted-foreground">
          <span className="truncate">Ping to {status.targets?.internet ?? 'the internet'}, last hour</span>
          <span className="shrink-0 tabular">0–{ms(top)}</span>
        </p>
        <Sparkline
          values={pings}
          max={top}
          slots={slots}
          className="h-12"
          label="Ping"
          format={(v) => ms(v)}
          timeOf={(slot) => samples[slot - (slots - samples.length)]?.t}
        />
      </div>
    </Card>
  );
}
