import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBitrate, formatNumber } from '@/lib/format';
import { href } from '@/lib/router';
import { delayMs } from '../sqm/cake';
import type { CakeDirection, Dashboard } from './use-dashboard';

function Direction({ c }: { c: CakeDirection }): ReactElement {
  const use = c.rate === undefined || c.bandwidth === undefined || c.bandwidth <= 0 ? 0 : Math.min(1, c.rate / c.bandwidth);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          {c.download ? <ArrowDownIcon className="size-3.5 text-chart-2" /> : <ArrowUpIcon className="size-3.5 text-chart-1" />}
          {c.download ? 'Download' : 'Upload'}
        </span>
        <span className="text-xs text-muted-foreground tabular">
          {c.rate === undefined ? '—' : formatBitrate(c.rate)} of {c.bandwidth === undefined ? 'unlimited' : formatBitrate(c.bandwidth)}
        </span>
      </div>
      <Progress value={use * 100} indicatorClassName={c.download ? 'bg-chart-2' : 'bg-chart-1'} />
      <dl className="grid grid-cols-4 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Avg delay</dt>
          <dd className="font-medium tabular">{delayMs(c.avgDelayUs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Peak delay</dt>
          <dd className="font-medium tabular">{delayMs(c.peakDelayUs)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Drops / ECN</dt>
          <dd className="font-medium tabular">
            {formatNumber(c.drops)} / {formatNumber(c.ecnMarks)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Flows</dt>
          <dd className="font-medium tabular">{formatNumber(c.flows)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** CAKE's live figures for each direction, while Smart Queue is shaping. */
export function SqmCard({ d }: { d: Dashboard }): ReactElement | null {
  if (d.cake.length === 0) return null;
  return (
    <Card className="gap-3">
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>Smart Queue</CardTitle>
          <CardDescription>CAKE&apos;s own statistics, live</CardDescription>
        </div>
        <CardAction>
          <a href={href('sqm')} className="text-xs text-primary hover:underline">
            Details
          </a>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {d.cake.map((c) => (
          <Direction key={c.dev} c={c} />
        ))}
      </CardContent>
    </Card>
  );
}
