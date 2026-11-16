import { RouterIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import { href } from '@/lib/router';
import type { Dashboard } from './use-dashboard';
import { Widget, WidgetLink } from './widget';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
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
    <div className="flex flex-col gap-1.5">
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
  const ct = d.stats.conntrack;
  const time = new Date(d.info.localtime * 1000).toLocaleString('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Widget icon={RouterIcon} title="System" aside={<WidgetLink href={href('system-overview')}>Details</WidgetLink>}>
      <div className="flex flex-col gap-4 px-5">
        <dl className="divide-y">
          <Row label="Router up for">{formatDuration(d.info.uptime)}</Row>
          <Row label="Router time">{time}</Row>
          <Row label="Firmware">{d.board.release?.version ?? '—'}</Row>
          <Row label="Kernel">{d.board.kernel ?? '—'}</Row>
        </dl>
        {root !== undefined && <Meter label="Storage" used={root.used * 1024} total={root.total * 1024} format={formatBytes} />}
        {ct.count !== null && ct.max !== null && (
          <Meter label="Connections" used={ct.count} total={ct.max} format={(n) => formatNumber(n)} />
        )}
      </div>
    </Widget>
  );
}
