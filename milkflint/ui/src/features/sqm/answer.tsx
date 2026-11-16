// The Smart Queue page's opening answer: whether the line is shaped, at
// what speeds, and whether CAKE keeps the queues short (its own figures
// for each direction, every 2 s). While it's off: what it does, and how to
// set it up, with the pages that measure the line.
import { ArrowDownIcon, ArrowUpIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBitrate, formatNumber, formatPercent } from '@/lib/format';
import { href } from '@/lib/router';
import { SHAPING_BUSY } from '../dashboard/model';
import { delayMs } from './cake';
import type { LiveDirection, SqmLive } from './live';
import { shareOfLimit } from './surface';

/** A link to another page inside a sentence. */
function PageLink({ to, children }: { to: Parameters<typeof href>[0]; children: ReactNode }): ReactElement {
  return (
    <a href={href(to)} className="font-medium text-primary underline underline-offset-4 hover:decoration-2">
      {children}
    </a>
  );
}

function Figure({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium tabular">{value}</dd>
    </div>
  );
}

/** One direction: how long packets wait in CAKE, how much of the shaped speed is in use, and what CAKE did to keep it so. */
function DirectionCell({ d }: { d: LiveDirection }): ReactElement {
  const s = d.summary;
  const name = d.download ? 'Download' : 'Upload';
  const Icon = d.download ? ArrowDownIcon : ArrowUpIcon;
  const share = shareOfLimit(d.rate, s.bandwidth);
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {name}
        </h3>
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{d.dev}</span>
      </div>
      <dl className="flex flex-col gap-0.5">
        <dt className="text-xs text-muted-foreground">Queue delay</dt>
        <dd className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-semibold tracking-tight tabular">{delayMs(s.avgDelayUs)}</span>
          <span className="text-sm text-muted-foreground tabular">
            average · peak <span className="font-medium text-foreground">{delayMs(s.peakDelayUs)}</span>
          </span>
        </dd>
      </dl>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground tabular">
          <span>
            <span className="font-medium text-foreground">{d.rate === undefined ? '—' : formatBitrate(d.rate)}</span> of{' '}
            {s.bandwidth === undefined ? 'no limit' : `${formatBitrate(s.bandwidth)} shaped`}
          </span>
          {share !== undefined && <span>{formatPercent(share)} in use</span>}
        </div>
        <Progress
          value={(share ?? 0) * 100}
          aria-label={`${name}, share of its shaped speed in use`}
          indicatorClassName={
            share !== undefined && share >= SHAPING_BUSY ? 'bg-warning' : d.download ? 'bg-chart-2' : 'bg-chart-1'
          }
        />
      </div>
      <dl className="grid grid-cols-3 gap-3 border-t pt-3">
        <Figure label="Dropped" value={formatNumber(s.drops)} />
        <Figure label="ECN-marked" value={formatNumber(s.ecnMarks)} />
        <Figure label="Active flows" value={formatNumber(s.flows)} />
      </dl>
    </div>
  );
}

/** What Smart Queue is for and how to set it up, while it has never shaped or is off. */
function SetUp(): ReactElement {
  return (
    <CardContent className="grid gap-4 lg:grid-cols-2 lg:gap-0">
      <div className="flex flex-col gap-2 lg:pr-6">
        <h3 className="text-sm font-medium">What it does</h3>
        <p className="max-w-prose text-sm">
          When the line is full, a queue builds up in your modem or at your provider, and everything waits behind it, calls and
          games included. Smart Queue shapes traffic just below your line’s speed, so the queue stays on the router, where CAKE
          keeps it short and fair.
        </p>
      </div>
      <div className="flex flex-col gap-2 border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
        <h3 className="text-sm font-medium">To set it up</h3>
        <ol className="flex max-w-prose list-decimal flex-col gap-1.5 pl-5 text-sm marker:text-muted-foreground">
          <li>
            Measure your line’s download and upload speeds with Smart Queue off: a speed test from a device on a cable, or a run
            on the <PageLink to="test-bench">Test bench</PageLink>.
          </li>
          <li>Enter about 90% of each below, and choose your connection type.</li>
          <li>
            Turn Smart Queue on at the top of the page and save. While the line is busy,{' '}
            <PageLink to="network-quality">Network quality</PageLink> shows whether latency stays low.
          </li>
        </ol>
      </div>
    </CardContent>
  );
}

export function ShapingNow({
  live,
  problems,
  savedOn,
}: {
  live: { data: SqmLive | undefined; error: unknown };
  /** what's not running as saved, once it has lasted past a restart */
  problems: readonly string[];
  /** Smart Queue as saved */
  savedOn: boolean;
}): ReactElement {
  const directions = live.data?.directions ?? [];
  const unavailable = live.error !== undefined && live.data === undefined;
  const badge =
    problems.length > 0 ? (
      <Badge variant="destructive">Not as saved</Badge>
    ) : directions.length > 0 ? (
      <Badge variant="success">Shaping</Badge>
    ) : live.data === undefined ? (
      <Badge variant="secondary">{unavailable ? 'Unknown' : 'Reading…'}</Badge>
    ) : savedOn ? (
      <Badge variant="info">Starting</Badge>
    ) : (
      <Badge variant="outline">Off</Badge>
    );
  const description =
    directions.length > 0
      ? 'CAKE’s own figures for each direction, every 2 s'
      : unavailable
        ? 'The router doesn’t give CAKE’s figures now'
        : savedOn
          ? 'Smart Queue is on; CAKE’s figures show here once it runs'
          : 'Smart Queue is off: nothing is shaped';

  return (
    <Card className={directions.length > 0 ? 'pb-0' : undefined}>
      <CardHeading title="Shaping now" status={description} action={badge} />
      {problems.length > 0 && (
        <CardContent>
          <Note tone="destructive" icon={<TriangleAlertIcon />} title="Smart Queue isn’t running as saved">
            <div className="flex flex-col gap-1">
              {problems.map((p) => (
                <span key={p}>{p}</span>
              ))}
              <span>
                sqm-scripts may have failed to start CAKE with these settings: the <PageLink to="logs">Logs</PageLink> have its
                messages.
              </span>
            </div>
          </Note>
        </CardContent>
      )}
      {directions.length > 0 ? (
        <div className="grid divide-y border-t md:grid-cols-2 md:divide-x md:divide-y-0">
          {directions.map((d) => (
            <DirectionCell key={d.dev} d={d} />
          ))}
        </div>
      ) : (
        !savedOn && problems.length === 0 && <SetUp />
      )}
    </Card>
  );
}
