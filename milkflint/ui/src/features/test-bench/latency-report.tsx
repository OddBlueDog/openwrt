import { GaugeIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { niceCeil } from '@/components/charts/path';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { RunMember } from './api';
import { grade, type Thresholds } from './checks';
import type { LatencyRow, LatencyTarget } from './latency';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 10 ? 1 : 0));

const targetName: Record<LatencyTarget, string> = {
  router: 'to the router',
  internet: 'to the internet',
  peers: 'to its peers',
  ping: 'router’s pings to it',
  wan: 'to its gateway',
  far: 'to the internet',
};

const tones = { pass: 'bg-success', warn: 'bg-warning', fail: 'bg-destructive', info: 'bg-info', skip: 'bg-muted-foreground/40' } as const;
const texts = { pass: 'text-success', warn: 'text-warning', fail: 'text-destructive', info: 'text-info', skip: 'text-muted-foreground' } as const;

function Row({ r, name, scale, t }: { r: LatencyRow; name: string; scale: number; t: Thresholds }): ReactElement {
  const pos = (v: number | undefined): number => (v === undefined ? 0 : Math.min(100, (v / scale) * 100));
  const status = r.added === undefined ? 'skip' : grade(r.target === 'internet' || r.target === 'wan' || r.target === 'far' ? 'wanAdded' : 'lanAdded', r.added, t);
  const lo = pos(r.loaded.median);
  const hi = pos(r.loaded.p95);
  return (
    <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_4.5rem] items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_6rem] sm:gap-x-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{name}</div>
        <div className="truncate text-[11px] text-muted-foreground">{targetName[r.target]}</div>
      </div>
      {r.silent ? (
        <span className="col-span-2 text-sm text-muted-foreground">no ping reply (its firewall)</span>
      ) : (
        <>
          <div className="relative h-2.5 rounded-full bg-muted" aria-hidden="true">
            {r.idle.median !== undefined && <div className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/35" style={{ width: `${String(Math.max(pos(r.idle.median), 1))}%` }} />}
            {r.loaded.median !== undefined && (
              <div className={cn('absolute inset-y-0 rounded-full', tones[status])} style={{ left: `${String(lo)}%`, width: `${String(Math.max(hi - lo, 1))}%` }} />
            )}
            {r.loaded.p99 !== undefined && <div className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/60" style={{ left: `${String(pos(r.loaded.p99))}%` }} />}
          </div>
          <div className={cn('text-right text-sm font-medium tabular', texts[status])}>
            {r.added === undefined ? '—' : `${r.added >= 0 ? '+' : '−'}${ms(Math.abs(r.added))} ms`}
          </div>
          <div className="col-span-3 text-[11px] text-muted-foreground tabular sm:col-span-2 sm:col-start-2">
            idle {ms(r.idle.median)} · under load {ms(r.loaded.median)} / {ms(r.loaded.p95)} / {ms(r.loaded.p99)} · at most {ms(r.loaded.max)} ms
            {r.loaded.jitter !== undefined && ` · jitter ${ms(r.loaded.jitter)} ms`}
            {r.loaded.lost > 0 && <span className="text-warning"> · {formatNumber(r.loaded.lost)} unanswered</span>}
          </div>
        </>
      )}
    </div>
  );
}

/** Each device's latency idle against under load, per target, then the router's own; bars on one scale. */
export function LatencyReport({ rows, members, thresholds }: { rows: readonly LatencyRow[]; members: readonly RunMember[]; thresholds: Thresholds }): ReactElement | null {
  // a plan with nothing that loads the network: the phase table has its idle figures
  const shown = rows.filter((r) => r.loaded.sent > 0);
  if (shown.length === 0) return null;
  const names = new Map(members.map((m) => [m.id, m.name]));
  const scale = niceCeil(Math.max(10, ...shown.flatMap((r) => (r.silent ? [] : [r.loaded.p99 ?? r.loaded.p95 ?? 0, r.idle.p95 ?? 0]))));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <GaugeIcon className="size-4 text-muted-foreground" /> Latency, idle and under load
      </h3>
      <div className="flex flex-col divide-y">
        {shown.map((r) => (
          <Row key={`${r.member ?? 'router'}-${r.target}`} r={r} name={r.member === null ? 'The router' : (names.get(r.member) ?? r.member)} scale={scale} t={thresholds} />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        The grey bar is the idle median; the coloured one runs from the typical figure under load to its 95th percentile, and the tick is the 99th, all on a
        scale to {formatNumber(scale)} ms. On the right, what load added: its 95th percentile less the idle median. Under load means the phases that load the
        network (downloads, uploads, device to device, the busy household), with their first seconds left out.
      </p>
    </section>
  );
}
