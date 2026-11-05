import { ActivityIcon, GlobeIcon, LoaderCircleIcon, RadarIcon, SettingsIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Live, useLive, WINDOW_SECONDS } from './live';
import { Button } from '@/components/ui/button';
import { usePoll } from '@/hooks/use-poll';
import { type Bucket, type DnsTarget, getHistory, type History, type Route, type Sample } from './api';
import { type ChartLine, csvName, historyLine, type LineSpec, linesToCsv, liveLine } from './chart-data';
import { type DnsLine, dnsLines, providerName } from './dns-lines';
import { LatencyChart } from './latency-chart';
import { type Probe, type ProbeSummary, rating, summarize, summarizeDnsServer } from './score';
import { ScoreRing } from './score-ring';

const pingTargets = [
  { value: '1.1.1.1', label: 'Cloudflare (1.1.1.1)' },
  { value: '8.8.8.8', label: 'Google (8.8.8.8)' },
  { value: '9.9.9.9', label: 'Quad9 (9.9.9.9)' },
] as const;

const probes: readonly { key: Probe; label: string; scaleMs: number }[] = [
  { key: 'gateway', label: 'WAN gateway', scaleMs: 50 },
  { key: 'internet', label: 'Internet', scaleMs: 200 },
  { key: 'dns', label: 'DNS lookup', scaleMs: 400 },
];

const ms = (v: number): string => `${formatNumber(v, v < 10 ? 1 : 0)} ms`;

function ProbeBar({
  label,
  target,
  summary,
  scaleMs,
  silent = false,
}: {
  label: string;
  target: string | undefined;
  summary: ProbeSummary;
  scaleMs: number;
  /** a gateway that never answers pings: not a failure */
  silent?: boolean;
}): ReactElement {
  const value = summary.typical;
  const failing = summary.answered === 0 && !silent;
  const pct = silent ? 0 : value === undefined ? 100 : Math.min(100, (value / scaleMs) * 100);
  const tone = silent ? 'bg-muted-foreground/30' : failing ? 'bg-destructive' : pct > 66 ? 'bg-warning' : 'bg-success';
  return (
    <div className="grid grid-cols-[9rem_1fr_6rem] items-center gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{target ?? '—'}</div>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-[width] duration-500', tone)} style={{ width: `${String(Math.max(pct, 2))}%` }} />
      </div>
      <div className={cn('text-right text-sm font-medium tabular', failing && 'text-destructive', silent && 'text-muted-foreground')}>
        {silent ? 'no ping reply' : failing ? 'no answer' : value === undefined ? '—' : ms(value)}
        {!failing && !silent && summary.loss > 0 && (
          <div className="text-[11px] font-normal text-warning">{formatPercent(summary.loss)} lost</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tracking-tight tabular">{value}</span>
      {hint !== undefined && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

const routeColors = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
// the DNS servers asked now: blue, amber, then paler ones (the probe asks
// four at most); servers asked earlier in the span, and the line from before
// the probe asked each, muted
const dnsColors = [
  'var(--chart-2)',
  'var(--chart-4)',
  'color-mix(in oklab, var(--chart-2) 55%, var(--muted-foreground))',
  'color-mix(in oklab, var(--chart-4) 55%, var(--muted-foreground))',
];
const dnsColor = (l: DnsLine, order: readonly string[]): string =>
  l.current ? (dnsColors[order.indexOf(l.key)] ?? 'var(--chart-2)') : 'var(--muted-foreground)';

/** A DNS server's row: its provider's name when it's one of the DNS page's. */
function dnsRowLabel(d: DnsTarget): string {
  const name = providerName(d.key);
  return name === undefined ? 'DNS lookup' : `DNS · ${name}`;
}

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
          (b) => (b.dns_servers === undefined ? undefined : Object.fromEntries(Object.entries(b.dns_servers).map(([k, v]) => [k, v?.[0] ?? null]))),
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

/** The chart's axis labels: whole numbers. */
const axisMs = (v: number): string => `${formatNumber(v)} ms`;

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
        icon={GlobeIcon}
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
  const r = summary.score === undefined ? undefined : rating(summary.score);
  const targets = status.targets;
  const interval = status.interval ?? 5;
  const stale = samples.length > 0 && status.now - (samples[samples.length - 1]?.t ?? 0) > interval * 3 + 5;
  const [span, setSpan] = useState<Span>(spans[0]);
  const history = usePoll(
    async (): Promise<History | undefined> => (span.step === undefined ? undefined : getHistory(span.seconds, span.step)),
    60_000,
    span.key,
  );
  const dnsTargets = targets?.dns_servers ?? [];
  const dnsOrder = dnsTargets.map((d) => d.key);
  const chart =
    span.step === undefined ? liveChart(samples, interval, status.now) : historyChart(span, history.data, history.loading, status.now, interval);
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

  if (samples.length === 0) {
    return (
      <Alert variant="info">
        <LoaderCircleIcon className="animate-spin" />
        <AlertTitle>Measuring…</AlertTitle>
        <AlertDescription>The first results arrive within a few seconds.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {stale && (
        <Alert variant="warning">
          <ActivityIcon />
          <AlertTitle>No new measurements</AlertTitle>
          <AlertDescription>The probe hasn&apos;t reported for a while; it restarts by itself if it stopped.</AlertDescription>
        </Alert>
      )}
      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,26rem)_1fr]">
        <Card>
          <CardHeading icon={RadarIcon} title="Quality score" description="Over the last 5 minutes" />
          <CardContent className="flex items-center gap-6">
            <ScoreRing score={summary.score} />
            <div className="flex flex-col gap-1">
              <span
                className={cn(
                  'text-2xl font-semibold',
                  r?.tone === 'success' ? 'text-success' : r?.tone === 'warning' ? 'text-warning' : 'text-destructive',
                )}
              >
                {r?.label ?? '—'}
              </span>
              <p className="text-sm text-muted-foreground">
                From internet latency, loss and jitter, DNS speed{summary.gatewaySilent ? '' : ' and the gateway'}.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeading icon={ActivityIcon} title="Response times" description="Typical values over the last 5 minutes" />
          <CardContent>
            <div className="divide-y">
              {probes.map((p) =>
                p.key === 'dns' && dnsTargets.length > 0 && recent.some((s) => s.dns_servers !== undefined) ? (
                  // a row per DNS server the DNS page uses
                  dnsTargets.map((d) => (
                    <ProbeBar
                      key={`dns:${d.key}`}
                      label={dnsRowLabel(d)}
                      scaleMs={p.scaleMs}
                      summary={summarizeDnsServer(recent, d.key)}
                      target={`${targets?.dns_domain ?? ''} @ ${d.addr ?? d.host}`}
                    />
                  ))
                ) : (
                  <ProbeBar
                    key={p.key}
                    label={p.label}
                    scaleMs={p.scaleMs}
                    summary={summary.probes[p.key]}
                    silent={p.key === 'gateway' && summary.gatewaySilent}
                    target={
                      p.key === 'gateway'
                        ? (targets?.gateway ?? undefined)
                        : p.key === 'internet'
                          ? targets?.internet
                          : targets === null
                            ? undefined
                            : `${targets.dns_domain} @ ${targets.dns_server}`
                    }
                  />
                ),
              )}
            </div>
            {dnsTargets.length > 1 && (
              <p className="pt-2 text-xs text-muted-foreground">
                Each DNS server is asked over plain DNS at its address, the same server your encrypted lookups reach; the score uses the
                first.
              </p>
            )}
            {summary.gatewaySilent && (
              <p className="pt-2 text-xs text-muted-foreground">
                The gateway doesn&apos;t answer pings (common with providers), so it&apos;s left out of the score.
              </p>
            )}
            <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
              <Stat label="Typical" value={summary.probes.internet.typical === undefined ? '—' : ms(summary.probes.internet.typical)} hint="internet ping" />
              <Stat label="Worst" value={summary.probes.internet.worst === undefined ? '—' : ms(summary.probes.internet.worst)} hint="95th percentile" />
              <Stat label="Jitter" value={summary.jitter === undefined ? '—' : ms(summary.jitter)} hint="change between pings" />
              <Stat label="Loss" value={formatPercent(summary.probes.internet.loss)} hint="pings without answer" />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeading icon={ActivityIcon} title="Latency" description={chart.description} action={<div className="hidden sm:block">{picker}</div>} />
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
    </div>
  );
}

// ---- settings -------------------------------------------------------------

interface QualityForm {
  enabled: boolean;
  interval: string;
  pingTarget: string;
  customTarget: string;
  dnsDomain: string;
  routes: boolean;
}

async function loadForm(): Promise<QualityForm> {
  const s = (await getConfig('milkflint')).find((x) => x['.name'] === 'netquality');
  const target = str(s, 'ping_target') ?? '1.1.1.1';
  const preset = pingTargets.some((p) => p.value === target);
  return {
    enabled: bool(s, 'enabled', true),
    interval: str(s, 'interval') ?? '5',
    pingTarget: preset ? target : 'custom',
    customTarget: preset ? '' : target,
    dnsDomain: str(s, 'dns_domain') ?? 'openwrt.org',
    routes: bool(s, 'routes', true),
  };
}

const HOST = /^[A-Za-z0-9.:-]+$/;

export function NetworkQualityPage(): ReactElement {
  const live = useLive(2000);
  const { data, error, loading, reload } = useLoad(loadForm);
  const [edit, setEdit] = useState<QualityForm>();
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data;
  const set = <K extends keyof QualityForm>(key: K, value: QualityForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };

  const errors: Partial<Record<keyof QualityForm, string>> = {};
  if (form?.pingTarget === 'custom' && !HOST.test(form.customTarget)) errors.customTarget = 'An IP address or host name.';
  if (form !== undefined && !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(form.dnsDomain)) errors.dnsDomain = 'A domain name, e.g. openwrt.org.';
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);

  const toChanges = (f: QualityForm): Change[] => [
    {
      op: 'set',
      config: 'milkflint',
      section: 'netquality',
      values: {
        enabled: f.enabled ? '1' : '0',
        interval: f.interval,
        ping_target: f.pingTarget === 'custom' ? f.customTarget : f.pingTarget,
        dns_domain: f.dnsDomain,
        routes: f.routes ? '1' : '0',
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Network Quality"
        description="Latency to your gateway, the internet and DNS, measured continuously."
        actions={
          form !== undefined && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{form.enabled ? 'On' : 'Off'}</span>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => {
                  set('enabled', v);
                }}
                aria-label="Network Quality on"
              />
            </label>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {live.data === undefined ? (
          live.error === undefined ? (
            <FormSkeleton />
          ) : (
            <LoadError error={live.error} retry={live.refresh} />
          )
        ) : live.data.status.enabled ? (
          <Results live={live.data} />
        ) : (
          <Alert variant="info">
            <RadarIcon />
            <AlertTitle>Network Quality is off</AlertTitle>
            <AlertDescription>Turn it on to measure latency continuously. It sends one small ping and a DNS query to each DNS server per round, and a ping each to three test servers once a minute.</AlertDescription>
          </Alert>
        )}

        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined ? null : (
          <Card>
            <CardHeading icon={SettingsIcon} title="Settings" description="What to measure, and how often." />
            <CardContent className="divide-y">
              <Field id="nq-target" label="Internet target" hint="Pinged every round. An IP address avoids timing DNS twice.">
                <Select
                  value={form.pingTarget}
                  onValueChange={(v) => {
                    set('pingTarget', v);
                  }}
                >
                  <SelectTrigger id="nq-target">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pingTargets.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              {form.pingTarget === 'custom' && (
                <Field id="nq-custom" label="Custom target" error={errors.customTarget}>
                  <Input
                    id="nq-custom"
                    className="font-mono"
                    value={form.customTarget}
                    aria-invalid={errors.customTarget !== undefined}
                    onChange={(e) => {
                      set('customTarget', e.target.value.trim());
                    }}
                  />
                </Field>
              )}
              <Field
                id="nq-dns"
                label="DNS test domain"
                hint="Looked up at each DNS server the DNS page uses, or your internet provider's when DNS is Automatic."
                error={errors.dnsDomain}
              >
                <Input
                  id="nq-dns"
                  className="font-mono"
                  value={form.dnsDomain}
                  aria-invalid={errors.dnsDomain !== undefined}
                  onChange={(e) => {
                    set('dnsDomain', e.target.value.trim());
                  }}
                />
              </Field>
              <Field id="nq-interval" label="Measure every">
                <Select
                  value={form.interval}
                  onValueChange={(v) => {
                    set('interval', v);
                  }}
                >
                  <SelectTrigger id="nq-interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['2', '5', '10', '30'].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s} seconds
                      </SelectItem>
                    ))}
                    {!['2', '5', '10', '30'].includes(form.interval) && <SelectItem value={form.interval}>{form.interval} seconds</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="nq-routes"
                label="Compare routes"
                hint="Once a minute, one ping each to test servers in London, Frankfurt and New Jersey (Vultr's, made for latency tests)."
              >
                <Switch
                  id="nq-routes"
                  checked={form.routes}
                  onCheckedChange={(v) => {
                    set('routes', v);
                  }}
                />
              </Field>
            </CardContent>
          </Card>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
        onSave={() => {
          if (form !== undefined) void apply(toChanges(form));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
