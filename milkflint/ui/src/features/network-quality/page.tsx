import { ActivityIcon, GlobeIcon, LoaderCircleIcon, RadarIcon, SettingsIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { ThroughputChart } from '@/components/charts/throughput-chart';
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
import { type Bucket, type DnsTarget, getHistory, type History, type Route, type Sample, type Stat } from './api';
import { type DnsLine, dnsLines, providerName } from './dns-lines';
import { type Probe, type ProbeSummary, rating, summarize, summarizeDnsServer, summarizeRoute } from './score';
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

const ROUTE_EVERY = 30;
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
// probe's minute history merged into `step`-second buckets.
const spans = [
  { key: '1h', label: '1 hour', seconds: 3600, step: undefined, spanLabel: '1 h' },
  { key: '24h', label: '24 hours', seconds: 86400, step: 120, spanLabel: '24 h' },
  { key: '7d', label: '7 days', seconds: 7 * 86400, step: 900, spanLabel: '7 d' },
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

/** One value per bucket of the history (its typical), undefined where nothing was recorded or answered. */
function historySeries(history: History, pick: (b: Bucket) => Stat | undefined): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: Math.round((history.now - history.start) / history.step) }, () => undefined);
  for (const b of history.buckets) {
    const v = pick(b)?.[0];
    if (b.i < out.length && v !== null && v !== undefined) out[b.i] = v;
  }
  return out;
}

/** What the charts show for the chosen span. */
interface ChartData {
  slots: number;
  routeSlots: number;
  spanLabel: string;
  /** The Latency card's description: how often a point is. */
  description: string;
  /** Values for a probe (live samples or history buckets). */
  probe: (key: Probe) => (number | undefined)[];
  /** A line per DNS server. */
  dns: DnsLine[];
  route: (key: string) => (number | undefined)[];
  /** Epoch seconds of a slot of each chart, for hovering. */
  timeOf: (slot: number) => number | undefined;
  routeTimeOf: (slot: number) => number | undefined;
  /** Shown instead of the charts, e.g. while history loads. */
  note?: string | undefined;
}

/** The time of a slot when `rounds` are drawn right-aligned in `slots`. */
const roundTime =
  (rounds: readonly Sample[], slots: number) =>
  (slot: number): number | undefined =>
    rounds[slot - (slots - rounds.length)]?.t;

function liveChart(samples: readonly Sample[], interval: number, dnsOrder: readonly string[]): ChartData {
  const rounds = samples.filter((s) => s.routes !== undefined);
  const slots = Math.round(3600 / interval);
  const routeSlots = Math.round(3600 / ROUTE_EVERY);
  return {
    slots,
    routeSlots,
    spanLabel: '1 h',
    description: `Every ${String(interval)} s; gaps are probes with no answer`,
    probe: (key) => samples.map((s) => s[key] ?? undefined),
    dns: dnsLines(
      samples,
      (s) => s.dns_servers,
      (s) => s.dns,
      dnsOrder,
    ),
    route: (key) => rounds.map((s) => s.routes?.[key] ?? undefined),
    timeOf: roundTime(samples, slots),
    routeTimeOf: roundTime(rounds, routeSlots),
  };
}

function historyChart(span: Span, history: History | undefined, loading: boolean, dnsOrder: readonly string[]): ChartData {
  const empty = (): (number | undefined)[] => [];
  const description = `Typical per ${String((span.step ?? 60) / 60)} min over the last ${span.label}; gaps: no answer or not recorded`;
  if (history === undefined) {
    const slots = Math.round(span.seconds / (span.step ?? 60));
    return {
      slots,
      routeSlots: slots,
      spanLabel: span.spanLabel,
      description,
      probe: empty,
      dns: [],
      route: empty,
      timeOf: () => undefined,
      routeTimeOf: () => undefined,
      note: loading ? 'Loading history…' : 'History unavailable.',
    };
  }
  const slots = Math.round((history.now - history.start) / history.step);
  const timeOf = (slot: number): number => history.start + slot * history.step;
  const bySlot: (Bucket | undefined)[] = Array.from({ length: slots }, () => undefined);
  for (const b of history.buckets) if (b.i < slots) bySlot[b.i] = b;
  return {
    slots,
    routeSlots: slots,
    spanLabel: span.spanLabel,
    description,
    probe: (key) => historySeries(history, (b) => b[key]),
    dns: dnsLines(
      bySlot,
      (b) => (b?.dns_servers === undefined ? undefined : Object.fromEntries(Object.entries(b.dns_servers).map(([k, v]) => [k, v?.[0] ?? null]))),
      (b) => b?.dns?.[0],
      dnsOrder,
    ),
    route: (key) => historySeries(history, (b) => b.routes?.[key]),
    timeOf,
    routeTimeOf: timeOf,
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

/** The UK, Europe and US servers: whether a slowdown is the line or a route abroad. */
function Routes({
  routes,
  recent,
  chart,
  picker,
}: {
  routes: readonly Route[];
  recent: readonly Sample[];
  chart: ChartData;
  picker: ReactNode;
}): ReactElement {
  const color = (i: number): string => routeColors[i % routeColors.length] ?? 'var(--chart-1)';
  return (
    <Card>
      <CardHeading
        icon={GlobeIcon}
        title="Routes"
        description={`A server each in the UK, Europe and the US, pinged every ${String(ROUTE_EVERY)} s. Not part of the score.`}
        action={picker}
      />
      <CardContent>
        <div className="divide-y">
          {routes.map((r) => (
            <ProbeBar key={r.key} label={r.label} target={r.host} scaleMs={200} summary={summarizeRoute(recent, r.key)} />
          ))}
        </div>
        <p className="pt-2 pb-4 text-xs text-muted-foreground">
          If all three get slower together, it&apos;s your line; if only the far ones do, it&apos;s the route there.
        </p>
        <div className="mb-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
          {routes.map((r, i) => (
            <span key={r.key} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: color(i) }} />
              {r.label}
            </span>
          ))}
        </div>
        {chart.note !== undefined ? (
          <ChartNote>{chart.note}</ChartNote>
        ) : (
          <ThroughputChart
            label="Route latency"
            slots={chart.routeSlots}
            spanLabel={chart.spanLabel}
            format={(v) => `${formatNumber(v)} ms`}
            hoverFormat={ms}
            timeOf={chart.routeTimeOf}
            minMax={50}
            series={routes.map((r, i) => ({ label: r.label, color: color(i), values: chart.route(r.key) }))}
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
  const chart = span.step === undefined ? liveChart(samples, interval, dnsOrder) : historyChart(span, history.data, history.loading, dnsOrder);
  // the latency chart's lines: internet, each DNS server, the gateway
  const lines = [
    { label: 'Internet', color: 'var(--chart-1)', values: chart.probe('internet') },
    ...chart.dns.map((l) => ({ label: l.key === '' ? l.label : `DNS · ${l.label}`, color: dnsColor(l, dnsOrder), values: l.values })),
    { label: 'Gateway', color: 'var(--chart-3)', values: chart.probe('gateway') },
  ];
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
        <CardHeading icon={ActivityIcon} title="Latency" description={chart.description} action={picker} />
        <CardContent>
          <div className="mb-3 flex flex-wrap gap-5 text-xs text-muted-foreground">
            {lines.map((l) => (
              <span key={l.label} className="flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          {chart.note !== undefined ? (
            <ChartNote>{chart.note}</ChartNote>
          ) : (
            <ThroughputChart
              label="Latency"
              slots={chart.slots}
              spanLabel={chart.spanLabel}
              format={(v) => `${formatNumber(v)} ms`}
              hoverFormat={ms}
              timeOf={chart.timeOf}
              minMax={50}
              series={lines}
            />
          )}
        </CardContent>
      </Card>

      {targets?.routes !== undefined && targets.routes.length > 0 && (
        <Routes routes={targets.routes} recent={recent} chart={chart} picker={picker} />
      )}
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
