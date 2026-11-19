// The Network quality page: the probe's live answer first (the score, the
// internet ping, its jitter and loss, each probe's typical time), then the
// latency and route charts with their tables, loss strip and CSV, then what
// to measure. Its on/off sits in the page header, as on Smart Queue.
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';
import { formatNumber } from '@/lib/format';
import { PowerSwitch } from '@/components/power-switch';
import { QualityNow, QualityOff } from './answer';
import { type Bucket, getHistory, type History, type Route, type Sample } from './api';
import { type ChartLine, csvName, historyLine, type LineSpec, linesToCsv, liveLine } from './chart-data';
import { type DnsLine, dnsLines } from './dns-lines';
import { ms } from './format';
import { LatencyChart } from './latency-chart';
import { type Live, useLive, WINDOW_SECONDS } from './live';
import { summarize } from './score';

const pingTargets = [
  { value: '1.1.1.1', label: 'Cloudflare (1.1.1.1)' },
  { value: '8.8.8.8', label: 'Google (8.8.8.8)' },
  { value: '9.9.9.9', label: 'Quad9 (9.9.9.9)' },
] as const;

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
  const history = usePoll(
    async (): Promise<History | undefined> => (span.step === undefined ? undefined : getHistory(span.seconds, span.step)),
    60_000,
    span.key,
  );
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

interface QualityForm {
  enabled: boolean;
  interval: string;
  pingTarget: string;
  customTarget: string;
  dnsDomain: string;
  /** A DNS server to time instead of the ones devices use; '' for those. */
  dnsServer: string;
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
    dnsServer: str(s, 'dns_server') ?? '',
    routes: bool(s, 'routes', true),
  };
}

const HOST = /^[A-Za-z0-9.:-]+$/;
// an IPv4 address, #port optional (the probe's dns-path.uc takes the same)
const DNS_SERVER = /^(\d{1,3}\.){3}\d{1,3}(#\d{1,5})?$/;

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
  if (form !== undefined && !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(form.dnsDomain))
    errors.dnsDomain = 'A domain name, e.g. openwrt.org.';
  if (form !== undefined && form.dnsServer !== '' && !DNS_SERVER.test(form.dnsServer))
    errors.dnsServer = 'An IPv4 address, with #port when it isn’t 53, e.g. 127.0.0.1#5354.';
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
        ...(f.dnsServer === '' ? {} : { dns_server: f.dnsServer }),
        routes: f.routes ? '1' : '0',
      },
    },
    ...(f.dnsServer === '' && data?.dnsServer !== undefined && data.dnsServer !== ''
      ? [{ op: 'unset' as const, config: 'milkflint', section: 'netquality', options: ['dns_server'] }]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Network quality"
        description="Latency to your gateway, the internet and DNS, measured continuously."
        actions={
          form !== undefined && (
            <PowerSwitch
              name="Network quality"
              on={form.enabled}
              saved={data?.enabled}
              onChange={(v) => {
                set('enabled', v);
              }}
            />
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
          <QualityOff />
        )}

        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined ? null : (
          <Card>
            <CardHeading title="Settings" description="What to measure, and how often." />
            <CardContent className="divide-y">
              <Field
                id="nq-target"
                label="Internet target"
                hint="Pinged every round."
                why="An IP address avoids timing a DNS lookup as well as the ping. Saved as milkflint.netquality.ping_target."
              >
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
                hint="Looked up at each DNS server your devices’ lookups go to."
                why="The DNS page’s servers, your internet provider’s when DNS is Automatic, or a DNS program on the router set up outside MilkFlint (ctrld, AdGuard Home, Unbound…). Saved as milkflint.netquality.dns_domain."
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
              <Field
                id="nq-dns-server"
                label="DNS server to test"
                hint="Leave empty to test the servers your devices’ lookups go to."
                why="For a setup the router can’t follow by itself. An IPv4 address, with #port when it isn’t 53: 127.0.0.1#5354 for a program on the router. Saved as milkflint.netquality.dns_server."
                error={errors.dnsServer}
              >
                <Input
                  id="nq-dns-server"
                  className="font-mono"
                  placeholder="Automatic"
                  value={form.dnsServer}
                  aria-invalid={errors.dnsServer !== undefined}
                  onChange={(e) => {
                    set('dnsServer', e.target.value.trim());
                  }}
                />
              </Field>
              <Field
                id="nq-interval"
                label="Measure every"
                hint="How often a round of measurements runs."
                why="Saved as milkflint.netquality.interval."
              >
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
                    {!['2', '5', '10', '30'].includes(form.interval) && (
                      <SelectItem value={form.interval}>{form.interval} seconds</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </Field>
              <Field
                id="nq-routes"
                label="Compare routes"
                hint="Once a minute, one ping each to test servers in London, Frankfurt and New Jersey."
                why="Vultr’s, made for latency tests. They’re not part of the score. Saved as milkflint.netquality.routes."
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
