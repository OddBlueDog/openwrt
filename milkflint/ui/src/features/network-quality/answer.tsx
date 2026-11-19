// Network quality's opening answer: the score and its rating, the internet
// ping, its worst, jitter and loss over the last 5 minutes, and each probe's
// typical time (the gateway, the internet target, each DNS server). While the
// probe is off or just started, what it does and what comes next.
import { ActivityIcon, LoaderCircleIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DnsTarget, Sample, Status } from './api';
import { dnsNotes, providerName } from './dns-lines';
import { ms } from './format';
import { type Probe, type ProbeSummary, rating, type Summary, summarizeDnsServer } from './score';
import { ScoreRing } from './score-ring';

const probes: readonly { key: Probe; label: string; scaleMs: number }[] = [
  { key: 'gateway', label: 'WAN gateway', scaleMs: 50 },
  { key: 'internet', label: 'Internet', scaleMs: 200 },
  { key: 'dns', label: 'DNS lookup', scaleMs: 400 },
];

/** A DNS server's row: its provider's name when it's one of the DNS page's. */
function dnsRowLabel(d: DnsTarget): string {
  const name = providerName(d.key);
  return name === undefined ? 'DNS lookup' : `DNS · ${name}`;
}

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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-2.5 sm:grid-cols-[9rem_minmax(0,1fr)_6rem]">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="truncate font-mono text-xs text-muted-foreground">{target ?? '—'}</div>
      </div>
      <div className="col-span-2 row-start-2 h-2 overflow-hidden rounded-full bg-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div
          className={cn('h-full rounded-full transition-[width] duration-slow', tone)}
          style={{ width: `${String(Math.max(pct, 2))}%` }}
        />
      </div>
      <div
        className={cn('text-right text-sm font-medium tabular', failing && 'text-destructive', silent && 'text-muted-foreground')}
      >
        {silent ? 'no ping reply' : failing ? 'no answer' : value === undefined ? '—' : ms(value)}
        {!failing && !silent && summary.loss > 0 && (
          <div className="text-xs font-normal text-warning">{formatPercent(summary.loss)} lost</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-semibold tracking-tight tabular">{value}</dd>
      <dd className="text-xs text-muted-foreground">{hint}</dd>
    </div>
  );
}

function Frame({ badge, description, children }: { badge: ReactNode; description: string; children: ReactNode }): ReactElement {
  return (
    <Card>
      <CardHeading title="Quality now" status={description} action={badge} />
      <CardContent className="flex flex-col gap-5">{children}</CardContent>
    </Card>
  );
}

/** The probe is off: what it does and costs, and how to turn it on. */
export function QualityOff(): ReactElement {
  return (
    <Frame badge={<Badge variant="outline">Off</Badge>} description="Nothing is measured">
      <p className="max-w-prose text-sm">
        Turn Network quality on at the top of the page and save to measure latency continuously. Each round sends one small ping
        to the gateway and the internet target and a DNS query to each DNS server, and once a minute a ping to each of three test
        servers.
      </p>
    </Frame>
  );
}

export function QualityNow({
  status,
  samples,
  recent,
  summary,
}: {
  status: Status;
  samples: readonly Sample[];
  recent: readonly Sample[];
  summary: Summary;
}): ReactElement {
  const interval = status.interval ?? 5;
  if (samples.length === 0) {
    return (
      <Frame badge={<Badge variant="info">Measuring</Badge>} description={`Measured every ${String(interval)} s`}>
        <Note tone="info" icon={<LoaderCircleIcon className="animate-spin" />} title="Measuring…">
          The first results arrive within a few seconds.
        </Note>
      </Frame>
    );
  }
  const r = summary.score === undefined ? undefined : rating(summary.score);
  const targets = status.targets;
  const dnsTargets = targets?.dns_servers ?? [];
  const stale = status.now - (samples[samples.length - 1]?.t ?? 0) > interval * 3 + 5;
  const internet = summary.probes.internet;
  return (
    <Frame
      badge={r === undefined ? <Badge variant="secondary">No score yet</Badge> : <Badge variant={r.tone}>{r.label}</Badge>}
      description={`Over the last 5 minutes, measured every ${String(interval)} s`}
    >
      {stale && (
        <Note tone="warning" icon={<ActivityIcon />} title="No new measurements">
          The probe hasn’t reported for a while; it restarts by itself if it stopped.
        </Note>
      )}
      <div className="grid gap-6 xl:grid-cols-2 xl:gap-0">
        <div className="flex flex-col gap-4 xl:pr-6">
          <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
            <ScoreRing score={summary.score} />
            <dl className="grid w-full grid-cols-2 gap-x-6 gap-y-4">
              <Stat label="Ping" value={internet.typical === undefined ? '—' : ms(internet.typical)} hint="internet, typical" />
              <Stat label="Worst" value={internet.worst === undefined ? '—' : ms(internet.worst)} hint="95th percentile" />
              <Stat label="Jitter" value={summary.jitter === undefined ? '—' : ms(summary.jitter)} hint="change between pings" />
              <Stat label="Loss" value={formatPercent(internet.loss)} hint="pings without answer" />
            </dl>
          </div>
          <p className="text-xs text-muted-foreground">
            The score is out of 100, from internet latency, loss and jitter, DNS speed
            {summary.gatewaySilent ? '' : ' and the gateway'}.
          </p>
        </div>
        <section aria-labelledby="nq-response" className="flex flex-col border-t pt-4 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6">
          <h3 id="nq-response" className="text-sm font-medium">
            Response times
          </h3>
          <p className="text-xs text-muted-foreground">Typical values over the last 5 minutes</p>
          <div className="divide-y">
            {probes.map((p) =>
              p.key === 'dns' && dnsTargets.length > 0 && recent.some((s) => s.dns_servers !== undefined) ? (
                // a row per DNS server devices’ lookups go to
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
          {dnsNotes(dnsTargets.map((d) => d.key)).map((n) => (
            <p key={n} className="pt-2 text-xs text-muted-foreground">
              {n}
            </p>
          ))}
          {summary.gatewaySilent && (
            <p className="pt-2 text-xs text-muted-foreground">
              The gateway doesn’t answer pings (common with providers), so it’s left out of the score.
            </p>
          )}
        </section>
      </div>
    </Frame>
  );
}
