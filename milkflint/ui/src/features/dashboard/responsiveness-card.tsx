// How quickly the internet answers, and Network Quality's view of it in one
// card: the latest ping and the score, at rest against under load (paired
// with the line's traffic while Home is open, load-store.ts), the hour's
// typical, worst, lost, jitter, DNS lookup and gateway, and the hour as a
// chart with the busy stretches Home saw shaded.
import type { ReactElement, ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import type { Poll } from '@/hooks/use-poll';
import { formatNumber, formatPercent } from '@/lib/format';
import { href } from '@/lib/router';
import { timeTicks } from '../network-quality/chart-data';
import { type Live, WINDOW_SECONDS } from '../network-quality/live';
import { rating, summarize } from '../network-quality/score';
import { useLoadPairs } from './load-store';
import { loadSummary, ms, pingScale, responsiveness } from './model';
import { TimeChart } from './time-chart';
import { Figure, OffNote, StateBadge, Widget, WidgetLink } from './widget';

const HOUR = 3600;

function hhmm(t: number): string {
  return new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** A small figure with a note below it (e.g. the difference from at rest). */
function Reading({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex flex-col">
        <span className="text-base font-semibold tabular">{children}</span>
        {note !== undefined && <span className="text-xs text-muted-foreground tabular">{note}</span>}
      </dd>
    </div>
  );
}

const quietly = (text: string): ReactElement => <span className="text-sm font-normal text-muted-foreground">{text}</span>;

export function ResponsivenessCard({ live }: { live: Poll<Live> }): ReactElement {
  const pairs = useLoadPairs();
  const link = <WidgetLink href={href('network-quality')}>Network quality</WidgetLink>;

  if (live.data === undefined) {
    return (
      <Widget aside={live.error === undefined ? undefined : link}>
        {live.error === undefined ? (
          <div className="flex flex-col gap-3 px-5">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <OffNote action={link}>Network Quality didn’t answer, so there are no pings to show.</OffNote>
        )}
      </Widget>
    );
  }

  const { status, samples } = live.data;
  if (!status.enabled) {
    return (
      <Widget aside={<StateBadge tone="off">Not measured</StateBadge>}>
        <OffNote action={<WidgetLink href={href('network-quality')}>Turn on Network Quality</WidgetLink>}>
          Network Quality pings the internet every few seconds to show how quickly it answers.
        </OffNote>
      </Widget>
    );
  }

  const r = responsiveness(samples, status.now);
  const from = status.now - HOUR;
  const hourSamples = samples.filter((s) => s.t > from);
  const answered = hourSamples.flatMap((s) => (s.internet === null ? [] : [s.internet]));
  const { top, cut } = pingScale(answered);
  const lost = hourSamples.filter((s) => s.internet === null).map((s) => s.t);
  const step = status.interval ?? 5;
  const ticks = timeTicks(from, status.now);
  const target = status.targets?.internet;
  const load = loadSummary(
    pairs.filter((p) => p.t > from),
    step,
  );
  const since = pairs.find((p) => p.t > from)?.t;
  const delta = load.underLoad === undefined || load.atRest === undefined ? undefined : load.underLoad - load.atRest;
  // Network Quality's parts over the hour, and its score as its own page gives it (the last 5 minutes)
  const hourly = summarize(hourSamples, status.gateway_answers);
  const score = summarize(
    samples.filter((s) => s.t > status.now - WINDOW_SECONDS),
    status.gateway_answers,
  ).score;
  const scored = score === undefined ? undefined : rating(score);
  const time = (v: number | undefined): string => (v === undefined ? '—' : ms(v));

  return (
    <Widget
      status={target === undefined ? undefined : `Ping to ${target}`}
      aside={
        <>
          <StateBadge tone={r.state.tone}>{r.state.label}</StateBadge>
          {link}
        </>
      }
    >
      {/* the chart takes the height the widget has spare */}
      <div className="grid flex-1 grid-rows-[auto_1fr] gap-x-6 gap-y-4 px-5 @lg:grid-cols-[13rem_minmax(0,1fr)] @lg:grid-rows-1">
        <dl className="grid grid-cols-3 content-start gap-x-4 gap-y-3 @lg:grid-cols-2">
          <div className="col-span-2 flex flex-col @lg:col-span-1">
            <dt className="text-xs text-muted-foreground">Ping now</dt>
            <dd className="text-3xl font-semibold tracking-tight tabular">
              {r.now === undefined ? (
                '—'
              ) : r.now === null ? (
                <span className="text-destructive">Lost</span>
              ) : (
                formatNumber(r.now, r.now < 10 ? 1 : 0)
              )}
              {r.now !== undefined && r.now !== null && (
                <span className="ml-1 text-base font-medium text-muted-foreground">ms</span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-col">
            <dt className="text-xs text-muted-foreground">Score</dt>
            <dd className="flex flex-col items-start gap-1">
              <span className="text-xl font-semibold tabular">
                {score ?? '—'}
                <span className="ml-0.5 text-xs font-normal text-muted-foreground">/100</span>
              </span>
              {scored === undefined ? quietly('Measuring…') : <StateBadge tone={scored.tone}>{scored.label}</StateBadge>}
            </dd>
          </div>
          <Reading label="At rest">
            {load.paired === 0 ? quietly('Measuring…') : load.atRest === undefined ? quietly('Not seen') : ms(load.atRest)}
          </Reading>
          <Reading
            label="Under load"
            note={delta === undefined ? undefined : `${delta >= 0 ? '+' : '−'}${ms(Math.abs(delta))} on rest`}
          >
            {load.paired === 0 ? quietly('Measuring…') : load.underLoad === undefined ? quietly('None seen') : ms(load.underLoad)}
          </Reading>
          <Figure label="Typical" value={r.hour.typical === undefined ? '—' : ms(r.hour.typical)} />
          <Figure label="Worst" value={r.hour.worst === undefined ? '—' : ms(r.hour.worst)} />
          <Figure label="Lost" value={formatPercent(r.hour.loss)} tone={r.hour.loss > 0.02 ? 'warning' : undefined} />
          {/* these go before the graph does, when the widget is short of room */}
          <Figure fit={1} label="Jitter" value={time(hourly.jitter)} />
          <Figure fit={1} label="DNS lookup" value={time(hourly.probes.dns.typical)} />
          {!hourly.gatewaySilent && <Figure fit={1} label="Gateway" value={time(hourly.probes.gateway.typical)} />}
        </dl>
        <div className="flex min-w-0 flex-col gap-1">
          <TimeChart
            fill
            lines={[
              { label: 'Ping', color: 'var(--chart-1)', points: hourSamples.map((s) => [s.t, s.internet] as const), area: true },
            ]}
            from={from}
            to={status.now}
            max={top}
            step={step}
            format={(v) => `${String(Math.round(v))} ms`}
            hoverFormat={ms}
            label={`Ping over the last hour: typically ${r.hour.typical === undefined ? 'unknown' : ms(r.hour.typical)}, ${formatPercent(r.hour.loss)} lost`}
            xLabels={[
              { t: from, label: '1 h ago' },
              ...ticks.filter((t) => t.t - from > 900 && status.now - t.t > 900),
              { t: status.now, label: 'Now' },
            ]}
            marks={lost.length === 0 ? undefined : { label: 'Lost', color: 'var(--destructive)', times: lost }}
            bands={load.stretches.map((b, i) => ({
              ...b,
              // the newest stretch is labelled; older ones would crowd it
              label: i === load.stretches.length - 1 ? `Busy line ${hhmm(b.from)}` : undefined,
            }))}
            className="min-h-24"
          />
          <p data-fit className="text-xs text-muted-foreground">
            {since === undefined
              ? 'At rest and under load: measuring while Home is open.'
              : load.busy === 0
                ? `No load seen since you opened Home (${hhmm(since)}).`
                : `At rest and under load: since ${hhmm(since)}, while Home is open; shaded where the line was busy.`}{' '}
            Typical (the median), worst (the slowest 5%), lost, jitter, DNS lookup and gateway: the last hour; the score, as on
            Network quality: the last 5 minutes.
            {lost.length > 0 && ' Ticks along the foot are pings that got no answer.'}
            {cut !== undefined && ` The scale stops at ${String(top)} ms; the highest was ${ms(cut)}.`}
          </p>
        </div>
      </div>
    </Widget>
  );
}
