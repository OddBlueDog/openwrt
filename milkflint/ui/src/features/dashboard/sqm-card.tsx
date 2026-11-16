import { GaugeIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Progress } from '@/components/ui/progress';
import { formatBitrate, formatNumber, formatPercent } from '@/lib/format';
import { href } from '@/lib/router';
import { delayMs } from '../sqm/cake';
import { SHAPING_BUSY } from './model';
import type { CakeDirection, Dashboard } from './use-dashboard';
import { Figure, OffNote, StateBadge, Widget, WidgetLink } from './widget';

function Direction({ c }: { c: CakeDirection }): ReactElement {
  const use = c.rate === undefined || c.bandwidth === undefined || c.bandwidth <= 0 ? 0 : Math.min(1, c.rate / c.bandwidth);
  const name = c.download ? 'Download' : 'Upload';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium">
          <span className={`size-2 rounded-full ${c.download ? 'bg-chart-2' : 'bg-chart-1'}`} aria-hidden="true" />
          {name}
        </span>
        <span className="text-xs text-muted-foreground tabular">
          {c.rate === undefined ? '—' : formatBitrate(c.rate)} of{' '}
          {c.bandwidth === undefined ? 'no limit' : formatBitrate(c.bandwidth)}
          {c.bandwidth !== undefined && ` · ${formatPercent(use)}`}
        </span>
      </div>
      <Progress
        value={use * 100}
        aria-label={`${name}, share of its limit`}
        indicatorClassName={use >= SHAPING_BUSY ? 'bg-warning' : c.download ? 'bg-chart-2' : 'bg-chart-1'}
      />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 @md:grid-cols-4">
        <Figure label="Average delay" value={delayMs(c.avgDelayUs)} />
        <Figure label="Peak delay" value={delayMs(c.peakDelayUs)} />
        <Figure label="Drops / ECN marks" value={`${formatNumber(c.drops)} / ${formatNumber(c.ecnMarks)}`} />
        <Figure label="Flows" value={formatNumber(c.flows)} />
      </dl>
    </div>
  );
}

/** CAKE's live figures for each direction while Smart Queue shapes; what it does and the way to it while it doesn't. */
export function SqmCard({ d, ap }: { d: Dashboard; ap: boolean }): ReactElement {
  if (ap) {
    return (
      <Widget icon={GaugeIcon} title="Smart Queue">
        <OffNote action={<WidgetLink href={href('mode')}>Operating mode</WidgetLink>}>
          In access point mode your main router shapes the internet connection.
        </OffNote>
      </Widget>
    );
  }
  if (d.cake.length === 0) {
    return (
      <Widget
        icon={GaugeIcon}
        title="Smart Queue"
        aside={
          <>
            <StateBadge tone="off">Off</StateBadge>
            <WidgetLink href={href('sqm')}>Set up</WidgetLink>
          </>
        }
      >
        {/* what it does and the three steps to it, at its content's height */}
        <div className="flex flex-col gap-2 px-5 text-sm">
          <p className="text-muted-foreground">
            Keeps latency low when the line is busy, by shaping traffic just below your line’s speed.
          </p>
          <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
            <li>Measure your line’s download and upload speeds with Smart Queue off.</li>
            <li>Enter about 90% of each on the Smart Queue page.</li>
            <li>Turn it on and save.</li>
          </ol>
        </div>
      </Widget>
    );
  }
  return (
    <Widget
      icon={GaugeIcon}
      title="Smart Queue"
      description="CAKE’s own figures, live"
      aside={
        <>
          <StateBadge tone="success">On</StateBadge>
          <WidgetLink href={href('sqm')}>Details</WidgetLink>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-5">
        {d.cake.map((c) => (
          <Direction key={c.dev} c={c} />
        ))}
      </div>
    </Widget>
  );
}
