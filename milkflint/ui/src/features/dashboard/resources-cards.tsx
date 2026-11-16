// The router's processor and memory: each core's use now, the load average
// and the last two minutes, with the process list a click away; memory in
// use with the cache beside it.
import { CpuIcon, MemoryStickIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { ProcessesButton } from '@/components/processes/processes-sheet';
import { Progress } from '@/components/ui/progress';
import { formatBytes, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import { agoLabels, CORE_BUSY } from './model';
import { TimeChart } from './time-chart';
import { type Dashboard, HISTORY, POLL_MS } from './use-dashboard';
import { Widget } from './widget';

const SPAN_S = (HISTORY * POLL_MS) / 1000;

export function CpuCard({ d }: { d: Dashboard }): ReactElement {
  const load = d.info.load.map((l) => (l / 65536).toFixed(2));
  // the newest sample is the one this poll took
  const to = d.history[d.history.length - 1]?.t ?? 0;
  const from = to - SPAN_S + POLL_MS / 1000;

  return (
    <Widget
      icon={CpuIcon}
      title="CPU"
      status={d.cores.length > 1 ? `${String(d.cores.length)} cores` : undefined}
      aside={<ProcessesButton look="widget" />}
    >
      <div className="flex flex-col gap-4 px-5">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground">In use now</span>
            <span className="text-3xl font-semibold tracking-tight tabular">
              {d.cpu === undefined ? '—' : formatPercent(d.cpu)}
            </span>
          </div>
          <dl className="flex flex-col items-end text-right">
            <dt className="text-xs text-muted-foreground">Load, 1 · 5 · 15 min</dt>
            <dd className="text-sm font-medium tabular">{load.join(' · ')}</dd>
          </dl>
        </div>
        {d.cores.length > 1 && (
          <ul className="flex flex-col gap-1.5" aria-label="Each core">
            {d.cores.map((c, i) => {
              const name = `Core ${String(i + 1)}`;
              return (
                <li key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)_2.75rem] items-center gap-3 text-sm">
                  <span className="text-muted-foreground">{name}</span>
                  <Progress value={c * 100} aria-label={name} indicatorClassName={c >= CORE_BUSY ? 'bg-warning' : 'bg-chart-1'} />
                  <span className={cn('text-right font-medium tabular', c >= CORE_BUSY && 'text-warning')}>
                    {formatPercent(c)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <TimeChart
          lines={[
            { label: 'CPU', color: 'var(--chart-1)', points: d.history.map((s) => [s.t, s.cpu ?? null] as const), area: true },
          ]}
          from={from}
          to={to}
          max={1}
          step={POLL_MS / 1000}
          format={formatPercent}
          label={`CPU use over the last ${String(SPAN_S / 60)} minutes`}
          xLabels={agoLabels(from, to, `${String(SPAN_S / 60)} min`)}
          className="h-20"
        />
      </div>
    </Widget>
  );
}

export function MemoryCard({ d }: { d: Dashboard }): ReactElement {
  const mem = d.info.memory;
  const used = mem.total - (mem.available ?? mem.free + mem.buffered);
  const cache = (mem.cached ?? 0) + mem.buffered;
  const share = (n: number): number => (mem.total > 0 ? Math.max(0, Math.min(1, n / mem.total)) * 100 : 0);

  return (
    <Widget icon={MemoryStickIcon} title="Memory">
      <div className="flex flex-col gap-3 px-5">
        <div className="flex flex-col">
          <span className="text-xs text-muted-foreground">In use</span>
          <span className="text-3xl font-semibold tracking-tight tabular">{formatPercent(used / mem.total)}</span>
          <span className="text-sm text-muted-foreground tabular">
            <span className="whitespace-nowrap">{formatBytes(used)}</span> of{' '}
            <span className="whitespace-nowrap">{formatBytes(mem.total)}</span>
          </span>
        </div>
        {/* in use, then cache, on one track; the rest is free */}
        <div
          role="img"
          aria-label={`${formatBytes(used)} in use and ${formatBytes(cache)} of cache, of ${formatBytes(mem.total)}`}
          className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted forced-colors:border"
        >
          <div className="rounded-full bg-chart-1" style={{ width: `${String(share(used))}%` }} />
          <div className="rounded-full bg-chart-1/35" style={{ width: `${String(share(cache))}%` }} />
        </div>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-chart-1" aria-hidden="true" />
              In use
            </dt>
            <dd className="font-medium tabular">{formatBytes(used)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full bg-chart-1/35" aria-hidden="true" />
              Cache
            </dt>
            <dd className="font-medium tabular">{formatBytes(cache)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="flex items-center gap-2 text-muted-foreground">
              <span className="size-2 shrink-0 rounded-full border border-muted-foreground" aria-hidden="true" />
              Free
            </dt>
            <dd className="font-medium tabular">{formatBytes(mem.free)}</dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">Cache isn’t counted as in use: Linux frees it whenever it’s needed.</p>
      </div>
    </Widget>
  );
}
