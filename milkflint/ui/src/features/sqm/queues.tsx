// How Smart Queue runs, below its settings: each direction's CAKE queues
// (one, or multi-queue CAKE's one per network-card queue, each with its
// rate, CPU and delay), each priority tin's delay, and what every CPU does
// for the network (the lanes Performance Tuning shows too). Every 2 s.
import { TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { CardHeading } from '@/components/card-heading';
import { CpuLanes } from '@/components/cpu-lanes';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { queueKey } from '@/hooks/use-network-live';
import { formatBitrate } from '@/lib/format';
import { pathSentence } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { delayMs } from './cake';
import type { LiveDirection, SqmLive } from './live';
import { queueNumber } from './surface';

const tinNames: Record<string, string[]> = {
  besteffort: ['All traffic'],
  diffserv3: ['Bulk', 'Best effort', 'Voice'],
  diffserv4: ['Bulk', 'Best effort', 'Video', 'Voice'],
  diffserv8: ['Tin 0', 'Tin 1', 'Tin 2', 'Tin 3', 'Tin 4', 'Tin 5', 'Tin 6', 'Tin 7'],
};

/** a queue's busiest tin: its delay is the queue's */
function busiestDelay(d: LiveDirection, i: number): number | undefined {
  const tins = d.queues[i]?.tins ?? [];
  return tins.reduce<(typeof tins)[number] | undefined>(
    (best, t) => ((t.sent_bytes ?? 0) > (best?.sent_bytes ?? -1) ? t : best),
    undefined,
  )?.avg_delay_us;
}

function DirectionQueues({ d }: { d: LiveDirection }): ReactElement {
  const multi = d.root.kind === 'cake_mq';
  const known = d.rates.some((r) => r !== undefined);
  const inUse = d.rates.filter((r) => r !== undefined && r > 0).length;
  const fill = d.download ? 'bg-chart-2' : 'bg-chart-1';
  const share = (rate: number | undefined): number =>
    rate === undefined || d.rate === undefined || d.rate <= 0 ? 0 : (rate / d.rate) * 100;
  const names = tinNames[d.root.options?.diffserv ?? 'besteffort'] ?? [];
  // per-tin delays for layer_cake: a single queue's own
  const tins = d.queues.length === 1 ? (d.queues[0]?.tins ?? []) : [];
  return (
    <section className="flex flex-col gap-2.5" aria-label={d.download ? 'Download queues' : 'Upload queues'}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
        <h3 className="font-medium">{d.download ? 'Download' : 'Upload'}</h3>
        <span className="text-xs text-muted-foreground tabular">
          {multi ? `${String(d.queues.length)} queues (cake_mq) · ${known ? String(inUse) : '—'} carrying traffic` : 'One CAKE'} ·{' '}
          {d.rate === undefined ? '—' : formatBitrate(d.rate)}
        </span>
      </div>
      {multi && d.queues.length <= 8 ? (
        <div className="flex flex-col gap-1.5">
          {d.queues.map((q, i) => {
            const rate = d.rates[i];
            const cpu = d.cpus[i];
            return (
              <div key={queueKey(q)} className="grid grid-cols-[5.5rem_minmax(0,1fr)_5.5rem] items-center gap-x-3 text-xs">
                <span className="flex flex-col leading-tight">
                  <span>Queue {queueNumber(q)}</span>
                  <span className="text-muted-foreground">{cpu === undefined ? 'any CPU' : `CPU ${String(cpu)}`}</span>
                </span>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn('h-full rounded-full transition-all duration-slow', fill)}
                    style={{ width: `${String(share(rate))}%` }}
                  />
                </div>
                <span className="flex flex-col text-right leading-tight tabular">
                  <span>{rate === undefined ? '—' : formatBitrate(rate)}</span>
                  <span className="text-muted-foreground">{delayMs(busiestDelay(d, i))}</span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex gap-1">
          {d.queues.map((q, i) => {
            const rate = d.rates[i];
            const label = multi ? `Queue ${String(queueNumber(q))}` : 'Queue';
            return (
              <div
                key={queueKey(q)}
                title={`${label}: ${rate === undefined ? '—' : formatBitrate(rate)}`}
                className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
              >
                <div className={cn('h-full rounded-full', fill)} style={{ width: `${String(share(rate))}%` }} />
              </div>
            );
          })}
        </div>
      )}
      {tins.length > 1 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {tins.map((t, i) => (
            <div key={i} className="flex gap-1.5">
              <dt className="text-muted-foreground">{names[i] ?? `Tin ${String(i)}`}</dt>
              <dd className="font-medium tabular">{delayMs(t.avg_delay_us)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

export function QueuesCard({
  live,
  multiQueue,
  spread,
  rssNote,
  advanced,
}: {
  live: SqmLive;
  /** Multi-queue as set, in words */
  multiQueue: string;
  /** the download's queues each have their CPU (RSS, or packet steering): queue 1 then carries little */
  spread: boolean;
  /** why the download's queues don't spread over the CPUs now, when they don't */
  rssNote: string | undefined;
  /** the way to Multi-queue in the advanced sheet; why it can't open now */
  advanced: { why: string | undefined; open: () => void };
}): ReactElement {
  const net = live.net;
  const working = net.cpus.filter((c) => c.network !== undefined && c.network >= 0.05).length;
  const mqDownload = live.directions.some((d) => d.download && d.root.kind === 'cake_mq');
  return (
    <Card>
      <CardHeading
        title="Queues and processors"
        description="Where CAKE runs, every 2 s"
        action={
          net.cpus.some((c) => c.network !== undefined) && (
            <Badge variant="secondary" className="tabular">
              {working} of {net.cpus.length} CPUs on network work
            </Badge>
          )
        }
      />
      <CardContent className="flex flex-col gap-5">
        {live.directions.length > 0 && (
          <div className="flex flex-col gap-5">
            {live.directions.map((d) => (
              <DirectionQueues key={d.dev} d={d} />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-4 text-sm">
              <span>
                <span className="text-muted-foreground">Multi-queue:</span> {multiQueue}
              </span>
              {advanced.why === undefined ? (
                <Button variant="outline" size="sm" onClick={advanced.open}>
                  Change in Advanced
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{advanced.why}</span>
              )}
            </div>
            {spread && mqDownload && (
              <p className="text-xs text-muted-foreground">
                Downloads use queues 2–4, on CPUs 1–3. Queue 1 stays for CPU 0, which sends everything and handles the interrupts,
                so it carries little: that’s by design, not a stuck queue.
              </p>
            )}
            {rssNote !== undefined && mqDownload && (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                {rssNote}
              </Note>
            )}
          </div>
        )}
        <div className={cn('flex flex-col gap-3', live.directions.length > 0 && 'border-t pt-4')}>
          <p className="text-sm text-muted-foreground">{pathSentence(net)}</p>
          <CpuLanes live={net} />
        </div>
      </CardContent>
    </Card>
  );
}
