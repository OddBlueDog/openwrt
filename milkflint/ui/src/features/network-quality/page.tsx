// The Network quality page: the probe's live answer first (the score, the
// internet ping, its jitter and loss, each probe's typical time), then the
// latency and route charts with their tables, loss strip and CSV, then what
// to measure. Its on/off sits in the page header, as on Smart Queue.
import { useQuery } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { FormSaveBar, SelectField, SwitchField, TextField } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { formatNumber } from '@/lib/format';
import { PowerSwitch } from '@/components/power-switch';
import { QualityNow, QualityOff } from './answer';
import { type Bucket, getHistory, type History, type Route, type Sample } from './api';
import { pingTargets, type QualityForm, qualityFormSchema, toChanges } from './model';
import { qualityQueries } from './queries';
import { type ChartLine, csvName, historyLine, type LineSpec, linesToCsv, liveLine } from './chart-data';
import { type DnsLine, dnsLines } from './dns-lines';
import { ms } from './format';
import { LatencyChart } from './latency-chart';
import { type Live, useLive as useLiveQuality, WINDOW_SECONDS } from './live';
import { summarize } from './score';

const routeColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
// the DNS servers asked now: the theme's series 2, 4, 5 and 6 (the probe
// asks four at most); servers asked earlier in the span, and the line from
// before the probe asked each, muted
const dnsColors = ['var(--chart-2)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];
const dnsColor = (l: DnsLine, order: readonly string[]): string =>
  l.current ? (dnsColors[order.indexOf(l.key)] ?? 'var(--chart-2)') : 'var(--muted-foreground)';

// The charts' time span: the last hour from the live samples, or the
// probe's minute history merged into `step`-second buckets. `csvStep` is
// the CSV's: finer than the chart where the router can read it quickly.
const spans = [
  { key: '1h', label: '1 hour', seconds: 3600, step: undefined, csvStep: undefined, spanLabel: '1 h' },
  { key: '24h', label: '24 hours', seconds: 86400, step: 120, csvStep: 60, spanLabel: '24 h' },
  { key: '7d', label: '7 days', seconds: 7 * 86400, step: 900, csvStep: 900, spanLabel: '7 d' },
] as const;
type Span = (typeof spans)[number];

function SpanPicker({ span, onChange }: { span: Span; onChange: (s: Span) => void }): ReactElement {
  return (
    <div role="group" aria-label="Time shown" className="inline-flex w-fit gap-0.5 rounded-md border p-0.5">
      {spans.map((s) => (
        <Button
          key={s.key}
          type="button"
          size="sm"
          variant={span.key === s.key ? 'secondary' : 'ghost'}
          className="h-7 px-3"
          aria-pressed={span.key === s.key}
          onClick={() => {
            onChange(s);
          }}
        >
          {s.label}
        </Button>
      ))}
    </div>
  );
}

/** What the lines are read from. */
type Source = { samples: readonly Sample[]; history?: undefined } | { samples?: undefined; history: History };

const toLines = (specs: readonly LineSpec[], source: Source): ChartLine[] =>
  specs.map((spec) => (source.history === undefined ? liveLine(spec, source.samples) : historyLine(spec, source.history)));

/** The latency chart's lines: internet, each DNS server, the gateway (unless it has never answered). */
function latencyLines(source: Source, dnsOrder: readonly string[], gatewayAnswers: boolean | null | undefined): ChartLine[] {
  const dns =
    source.history === undefined
      ? dnsLines(
          source.samples,
          (s) => s.dns_servers,
          (s) => s.dns,
          dnsOrder,
        )
      : dnsLines(
          source.history.buckets,
          (b) =>
            b.dns_servers === undefined
              ? undefined
              : Object.fromEntries(Object.entries(b.dns_servers).map(([k, v]) => [k, v?.[0] ?? null])),
          (b) => b.dns?.[0],
          dnsOrder,
        );
  const dnsSpec = (l: DnsLine): LineSpec => ({
    key: `dns:${l.key}`,
    label: l.key === '' ? l.label : `DNS · ${l.label}`,
    color: dnsColor(l, dnsOrder),
    // the line from before the probe asked each server reads the single value
    sample: (s) => (l.key === '' ? (s.dns_servers === undefined ? s.dns : undefined) : s.dns_servers?.[l.key]),
    bucket: (b: Bucket) => (l.key === '' ? (b.dns_servers === undefined ? b.dns : undefined) : b.dns_servers?.[l.key]),
  });
  const lines = toLines(
    [
      { key: 'internet', label: 'Internet', color: 'var(--chart-1)', sample: (s) => s.internet, bucket: (b) => b.internet },
      ...dns.map(dnsSpec),
      {
        key: 'gateway',
        label: 'Gateway',
        color: 'var(--chart-3)',
        countLoss: gatewayAnswers !== false,
        sample: (s) => s.gateway,
        bucket: (b) => b.gateway,
      },
    ],
    source,
  );
  return lines.filter((l) => l.key !== 'gateway' || l.points.some((p) => p.v !== undefined));
}

const routeLines = (routes: readonly Route[], source: Source): ChartLine[] =>
  toLines(
    routes.map((r, i) => ({
      key: r.key,
      label: r.label,
      detail: r.host,
      color: routeColors[i % routeColors.length] ?? 'var(--chart-1)',
      // a sample between the route rounds has none: not asked
      sample: (s) => (s.routes === undefined ? undefined : (s.routes[r.key] ?? null)),
      bucket: (b) => b.routes?.[r.key],
    })),
    source,
  );

/** What the charts show for the chosen span. */
interface ChartData {
  start: number;
  end: number;
  spanLabel: string;
  /** The Latency card's description: how often a point is. */
  description: string;
  source?: Source | undefined;
  /** Shown instead of the charts, e.g. while history loads. */
  note?: string | undefined;
}

function liveChart(samples: readonly Sample[], interval: number, now: number): ChartData {
  return {
    start: now - 3600,
    end: now,
    spanLabel: '1 h',
    description: `Measured every ${String(interval)} s; each point is one measurement`,
    source: { samples },
  };
}

function historyChart(span: Span, history: History | undefined, loading: boolean, now: number, interval: number): ChartData {
  const step = (span.step ?? 60) / 60;
  const description = `Measured every ${String(interval)} s. Each point covers ${String(step)} min: the line is the typical time, the shading reaches the slowest.`;
  if (history === undefined) {
    return {
      start: now - span.seconds,
      end: now,
      spanLabel: span.spanLabel,
      description,
      note: loading ? 'Loading history…' : 'History unavailable.',
    };
  }
  return {
    start: history.start,
    end: history.now,
    spanLabel: span.spanLabel,
    description,
    source: { history },
    note:
      history.days === 0
        ? 'History is off (milkflint.netquality.history_days).'
        : history.buckets.length === 0
          ? `No history yet: a point is added every ${history.step % 900 === 0 ? '15 minutes' : 'minute'}.`
          : undefined,
  };
}

function ChartNote({ children }: { children: ReactNode }): ReactElement {
  return <div className="flex h-52 items-center justify-center text-sm text-muted-foreground">{children}</div>;
}

/** The chart's axis labels: whole numbers, in seconds from 10 s so a long stall's scale stays short. */
const axisMs = (v: number): string => (v >= 10_000 ? `${formatNumber(v / 1000)} s` : `${formatNumber(v)} ms`);

/** The UK, Europe and US servers: whether a slowdown is the line or a route abroad. */
function Routes({
  routes,
  chart,
  picker,
  csv,
}: {
  routes: readonly Route[];
  chart: ChartData;
  picker: ReactNode;
  csv: () => Promise<{ name: string; text: string }>;
}): ReactElement {
  return (
    <Card>
      <CardHeading
        title="Routes"
        description="A server each in the UK, Europe and the US, pinged once a minute. Not part of the score."
        action={<div className="hidden sm:block">{picker}</div>}
      />
      <CardContent>
        <div className="pb-3 sm:hidden">{picker}</div>
        <p className="pb-3 text-xs text-muted-foreground">
          If all three get slower together, it&apos;s your line; if only the far ones do, it&apos;s the route there.
        </p>
        {chart.note !== undefined || chart.source === undefined ? (
          <ChartNote>{chart.note}</ChartNote>
        ) : (
          <LatencyChart
            label="Route latency"
            lines={routeLines(routes, chart.source)}
            start={chart.start}
            end={chart.end}
            spanLabel={chart.spanLabel}
            format={axisMs}
            hoverFormat={ms}
            csv={csv}
          />
        )}
      </CardContent>
    </Card>
  );
}

function Results({ live }: { live: Live }): ReactElement {
  const { status, samples } = live;
  const recent = samples.filter((s) => s.t > status.now - WINDOW_SECONDS);
  const summary = summarize(recent, status.gateway_answers);
  const targets = status.targets;
  const interval = status.interval ?? 5;
  const [span, setSpan] = useState<Span>(spans[0]);
  const history = useLive({
    ...qualityQueries.history(span.seconds, span.step ?? 0),
    enabled: span.step !== undefined,
  });
  const dnsOrder = (targets?.dns_servers ?? []).map((d) => d.key);
  const chart =
    span.step === undefined
      ? liveChart(samples, interval, status.now)
      : historyChart(span, history.data, history.loading, status.now, interval);
  const routes = targets?.routes ?? [];
  const gatewayAnswers = status.gateway_answers;
  // the CSV's data: as charted for the hour and the 7 days, by the minute for the 24 hours
  const csvSource = async (): Promise<Source> => {
    if (span.step === undefined) return { samples };
    if (span.csvStep === span.step && history.data !== undefined) return { history: history.data };
    return { history: await getHistory(span.seconds, span.csvStep) };
  };
  const latencyCsv = async (): Promise<{ name: string; text: string }> => ({
    name: csvName('latency', span.key, status.now),
    text: linesToCsv(latencyLines(await csvSource(), dnsOrder, gatewayAnswers)),
  });
  const routesCsv = async (): Promise<{ name: string; text: string }> => ({
    name: csvName('routes', span.key, status.now),
    text: linesToCsv(routeLines(routes, await csvSource())),
  });
  const picker = <SpanPicker span={span} onChange={setSpan} />;

  return (
    <div className="flex flex-col gap-4">
      <QualityNow status={status} samples={samples} recent={recent} summary={summary} />
      {samples.length > 0 && (
        <>
          <Card>
            <CardHeading
              title="Latency"
              description={chart.description}
              action={<div className="hidden sm:block">{picker}</div>}
            />
            <CardContent>
              <div className="pb-3 sm:hidden">{picker}</div>
              {chart.note !== undefined || chart.source === undefined ? (
                <ChartNote>{chart.note}</ChartNote>
              ) : (
                <LatencyChart
                  label="Latency"
                  lines={latencyLines(chart.source, dnsOrder, gatewayAnswers)}
                  start={chart.start}
                  end={chart.end}
                  spanLabel={chart.spanLabel}
                  format={axisMs}
                  hoverFormat={ms}
                  csv={latencyCsv}
                />
              )}
            </CardContent>
          </Card>
          {routes.length > 0 && <Routes routes={routes} chart={chart} picker={picker} csv={routesCsv} />}
        </>
      )}
    </div>
  );
}

// ---- settings -------------------------------------------------------------

export function NetworkQualityPage(): ReactElement {
  const live = useLiveQuality(2000);
  const settings = useQuery(qualityQueries.settings());
  const results =
    live.data === undefined ? (
      live.error === undefined ? (
        <FormSkeleton />
      ) : (
        <LoadError error={live.error} retry={live.refresh} />
      )
    ) : live.data.status.enabled ? (
      <Results live={live.data} />
    ) : (
      <QualityOff />
    );
  if (settings.data === undefined) {
    return (
      <QualityLayout
        results={results}
        settings={settings.error === null ? null : <LoadError error={settings.error} retry={() => void settings.refetch()} />}
      />
    );
  }
  return <QualityWithSettings saved={settings.data} results={results} />;
}

/** The page: its header (with the on/off once the settings are read), the results, the settings, the save bar. */
function QualityLayout({
  power,
  results,
  status,
  settings,
  saveBar,
}: {
  power?: ReactNode;
  results: ReactNode;
  status?: ReactNode;
  settings: ReactNode;
  saveBar?: ReactNode;
}): ReactElement {
  return (
    <>
      <PageHeader
        title="Network quality"
        description="Latency to your gateway, the internet and DNS, measured continuously."
        actions={power}
      />
      <div className="flex flex-col gap-4">
        {status}
        {results}
        {settings}
      </div>
      {saveBar}
    </>
  );
}

function QualityWithSettings({ saved, results }: { saved: QualityForm; results: ReactNode }): ReactElement {
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: qualityFormSchema,
    saved,
    onSave: (values) => apply(toChanges(values, saved)),
  });
  const { form } = settings;
  const values = useFormValues(form);
  const intervals = ['2', '5', '10', '30'];

  return (
    <QualityLayout
      power={
        <PowerSwitch
          name="Network quality"
          on={values.enabled}
          saved={saved.enabled}
          onChange={(v) => {
            form.setFieldValue('enabled', v);
          }}
        />
      }
      status={<ApplyStatus state={state} />}
      results={results}
      settings={
        <Card>
          <CardHeading title="Settings" description="What to measure, and how often." />
          <CardContent className="divide-y">
            <form.Field name="pingTarget">
              {(field) => (
                <SelectField
                  field={field}
                  id="nq-target"
                  label="Internet target"
                  hint="Pinged every round."
                  why="An IP address avoids timing a DNS lookup as well as the ping. Saved as milkflint.netquality.ping_target."
                  options={[
                    ...pingTargets.map((p) => ({ value: p.value, label: p.label })),
                    { value: 'custom', label: 'Custom' },
                  ]}
                />
              )}
            </form.Field>
            {values.pingTarget === 'custom' && (
              <form.Field name="customTarget">
                {(field) => <TextField field={field} id="nq-custom" label="Custom target" className="font-mono" trim />}
              </form.Field>
            )}
            <form.Field name="dnsDomain">
              {(field) => (
                <TextField
                  field={field}
                  id="nq-dns"
                  label="DNS test domain"
                  hint="Looked up at each DNS server your devices’ lookups go to."
                  why="The DNS page’s servers, your internet provider’s when DNS is Automatic, or a DNS program on the router set up outside MilkFlint (ctrld, AdGuard Home, Unbound…). Saved as milkflint.netquality.dns_domain."
                  className="font-mono"
                  trim
                />
              )}
            </form.Field>
            <form.Field name="dnsServer">
              {(field) => (
                <TextField
                  field={field}
                  id="nq-dns-server"
                  label="DNS server to test"
                  hint="Leave empty to test the servers your devices’ lookups go to."
                  why="For a setup the router can’t follow by itself. An IPv4 address, with #port when it isn’t 53: 127.0.0.1#5354 for a program on the router. Saved as milkflint.netquality.dns_server."
                  className="font-mono"
                  placeholder="Automatic"
                  trim
                />
              )}
            </form.Field>
            <form.Field name="interval">
              {(field) => (
                <SelectField
                  field={field}
                  id="nq-interval"
                  label="Measure every"
                  hint="How often a round of measurements runs."
                  why="Saved as milkflint.netquality.interval."
                  options={[
                    ...intervals.map((s) => ({ value: s, label: `${s} seconds` })),
                    ...(intervals.includes(values.interval)
                      ? []
                      : [{ value: values.interval, label: `${values.interval} seconds` }]),
                  ]}
                />
              )}
            </form.Field>
            <form.Field name="routes">
              {(field) => (
                <SwitchField
                  field={field}
                  id="nq-routes"
                  label="Compare routes"
                  hint="Once a minute, one ping each to test servers in London, Frankfurt and New Jersey."
                  why="Vultr’s, made for latency tests. They’re not part of the score. Saved as milkflint.netquality.routes."
                />
              )}
            </form.Field>
          </CardContent>
        </Card>
      }
      saveBar={<FormSaveBar settings={settings} busy={state.phase === 'applying'} />}
    />
  );
}
