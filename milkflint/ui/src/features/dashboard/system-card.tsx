import type { ReactElement, ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { pageLink } from '@/lib/router';
import type { Dashboard } from './use-dashboard';
import { Widget, WidgetLink } from './widget';
import { useWidgetInfo } from './widget-info';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div data-fit className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium tabular">{children}</dd>
    </div>
  );
}

function Meter({
  label,
  used,
  total,
  format,
}: {
  label: string;
  used: number;
  total: number;
  format: (n: number) => string;
}): ReactElement {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div data-fit className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular">
          {format(used)} <span className="font-normal text-muted-foreground">of {format(total)}</span>
        </span>
      </div>
      <Progress
        value={pct}
        aria-label={label}
        indicatorClassName={pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-chart-1'}
      />
    </div>
  );
}

export function SystemCard({ d }: { d: Dashboard }): ReactElement {
  const root = d.info.root;
  const narrow = useWidgetInfo().size.w === 1;
  const release = d.board.release?.version;
  const ct = d.stats.conntrack;
  const time = new Date(d.info.localtime * 1000).toLocaleString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Widget aside={<WidgetLink to={pageLink('system-overview')}>Details</WidgetLink>}>
      {/* as many rows as the widget has room for, two to a line when it's wide */}
      <div className="flex flex-1 flex-col gap-4 px-5">
        <dl className="grid grid-cols-1 content-start gap-x-6 @sm:grid-cols-2 [&>*]:border-t [&>*:first-child]:border-t-0 @sm:[&>*:nth-child(2)]:border-t-0">
          <Row label={narrow ? 'Up for' : 'Router up for'}>{formatDuration(d.info.uptime)}</Row>
          <Row label="Router time">{time}</Row>
          <Row label="Firmware">
            {/* MilkFlint's own version, without the OpenWrt it's built on (About has both) */}
            {release?.replace(/\s*\(.*\)$/, '') ?? '—'}
          </Row>
          <Row label="Kernel">{d.board.kernel ?? '—'}</Row>
        </dl>
        {/* the meters at the widget's foot, however tall its cell */}
        <div className="mt-auto grid grid-cols-1 gap-x-6 gap-y-4 empty:hidden @sm:grid-cols-2">
          {root !== undefined && <Meter label="Storage" used={root.used * 1024} total={root.total * 1024} format={formatBytes} />}
          {ct.count !== null && ct.max !== null && (
            <Meter label="Connections" used={ct.count} total={ct.max} format={(n) => formatNumber(n)} />
          )}
        </div>
      </div>
    </Widget>
  );
}
