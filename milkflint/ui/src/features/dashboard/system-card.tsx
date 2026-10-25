import type { ReactElement, ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatDuration, formatNumber } from '@/lib/format';
import type { Dashboard } from './use-dashboard';

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right tabular">{children}</span>
    </div>
  );
}

function Meter({ label, used, total, format }: { label: string; used: number; total: number; format: (n: number) => string }): ReactElement {
  const pct = total > 0 ? (used / total) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular">
          {format(used)} <span className="text-muted-foreground">/ {format(total)}</span>
        </span>
      </div>
      <Progress value={pct} indicatorClassName={pct > 85 ? 'bg-destructive' : pct > 65 ? 'bg-warning' : 'bg-chart-2'} />
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
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1.5">
          <CardTitle>System</CardTitle>
          <CardDescription>Up {formatDuration(d.info.uptime)}</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="divide-y">
          <Row label="Router time">{time}</Row>
          <Row label="Firmware">{d.board.release?.version ?? '—'}</Row>
          <Row label="Kernel">{d.board.kernel ?? '—'}</Row>
        </div>
        {root !== undefined && (
          <Meter label="Storage" used={root.used * 1024} total={root.total * 1024} format={formatBytes} />
        )}
        {ct.count !== null && ct.max !== null && (
          <Meter label="Connections" used={ct.count} total={ct.max} format={(n) => formatNumber(n)} />
        )}
      </CardContent>
    </Card>
  );
}
