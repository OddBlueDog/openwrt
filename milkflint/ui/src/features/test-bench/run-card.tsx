import { CircleStopIcon, LoaderCircleIcon, TimerIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatBitrate, formatNumber, formatPercent } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import type { Member, Run, RouterLive } from './api';
import type { BenchMember, MemberState } from './member';
import { clockText, phaseRoles, phaseStyle } from './phases';
import { PhaseStrip } from './plan-card';
import { phaseAt } from './plans';
import { useRunData } from './run-data';
import { RunReport } from './run-report';

/** The router's clock now, as this member reckons it, every `ms`. */
function useRouterNow(member: BenchMember, ms: number): number | undefined {
  const [now, setNow] = useState(() => member.clock.router());
  useEffect(() => {
    const t = setInterval(() => {
      setNow(member.clock.router());
    }, ms);
    return () => {
      clearInterval(t);
    };
  }, [member, ms]);
  return now;
}

const stateBadge: Record<Run['state'], { text: string; variant: 'outline' | 'success' | 'warning' | 'secondary' }> = {
  scheduled: { text: 'Starting', variant: 'outline' },
  running: { text: 'Running', variant: 'success' },
  stopping: { text: 'Stopping', variant: 'warning' },
  collecting: { text: 'Collecting results', variant: 'secondary' },
  done: { text: 'Finished', variant: 'secondary' },
};

const msText = (v: number | undefined): string => (v === undefined ? '—' : `${formatNumber(v, v < 10 ? 1 : 0)} ms`);

function Figure({ label, children, hint }: { label: string; children: ReactNode; hint?: string | undefined }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-lg border px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="text-sm font-medium tabular">{children}</span>
      {hint !== undefined && <span className="truncate text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

/** The router's last second: CPU per core, the line, Smart Queue's delay each way, offloaded connections, its pings. */
function RouterStrip({ live, probes }: { live: RouterLive | null | undefined; probes: Record<string, unknown> | null | undefined }): ReactElement | null {
  if (live === undefined || live === null) return null;
  const ping = (k: string): number | undefined => {
    const v = probes?.[k];
    return Array.isArray(v) && typeof v[0] === 'number' ? v[0] : undefined;
  };
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-5">
      <Figure label="Router CPU, per core" hint={live.self === undefined || live.self === null ? undefined : `recorder ${formatPercent(live.self.reduce((a, b) => a + b, 0))} of a core`}>
        <span className="flex h-5 items-end gap-1" aria-label={live.cpu.map((c, i) => `CPU ${String(i)} ${c === null ? '?' : formatPercent(c[0])}`).join(', ')}>
          {live.cpu.map((c, i) => (
            <span key={i} className="relative h-full w-2.5 overflow-hidden rounded-sm bg-muted">
              <span className="absolute inset-x-0 bottom-0 bg-chart-2/60" style={{ height: `${String((c?.[0] ?? 0) * 100)}%` }} />
              <span className="absolute inset-x-0 bottom-0 bg-chart-2" style={{ height: `${String((c?.[1] ?? 0) * 100)}%` }} />
            </span>
          ))}
        </span>
      </Figure>
      <Figure label="Internet line">
        {live.wan === undefined || live.wan === null ? '—' : `↓ ${formatBitrate(live.wan[0])} ↑ ${formatBitrate(live.wan[1])}`}
      </Figure>
      <Figure label="Smart Queue delay" hint="the busiest tin's average">
        {live.down === undefined || live.down === null ? '—' : `↓ ${msText(live.down[0] / 1000)}`}
        {live.up !== undefined && live.up !== null && ` ↑ ${msText(live.up[0] / 1000)}`}
      </Figure>
      <Figure label="Offloaded connections">{live.off === undefined || live.off === null ? '—' : `${String(live.off[0])} of ${String(live.off[1])}`}</Figure>
      <Figure label="Router's ping to the internet">
        {msText(ping('wan'))}
        {ping('far') !== undefined && <span className="text-muted-foreground"> · far {msText(ping('far'))}</span>}
      </Figure>
    </div>
  );
}

function memberLiveText(m: Member): string | undefined {
  const l = m.live;
  if (l === undefined || l === null) return undefined;
  const parts = [
    l.r === undefined ? undefined : `router ${msText(l.r)}`,
    l.w === undefined ? undefined : `internet ${msText(l.w)}`,
    l.d === undefined ? undefined : `↓ ${formatNumber(l.d, l.d < 10 ? 1 : 0)} Mbit/s`,
    l.u === undefined ? undefined : `↑ ${formatNumber(l.u, l.u < 10 ? 1 : 0)} Mbit/s`,
    l.k === undefined || l.k === 0 ? undefined : `peers ${String(l.o ?? 0)} of ${String(l.k)}`,
    l.p === undefined ? undefined : `peer ${msText(l.p)}`,
    l.x === undefined ? undefined : `from peer ${formatNumber(l.x, l.x < 10 ? 1 : 0)} Mbit/s`,
    l.g === undefined ? undefined : `pages ${msText(l.g)}`,
    l.l === undefined ? undefined : `lookups ${msText(l.l)}`,
  ].filter((x) => x !== undefined);
  return parts.length === 0 ? undefined : parts.join(' · ');
}

/** The run: where it is, who's doing what, Stop; once it's over, its figures (a rehearsal's: how well the devices kept time). */
export function RunCard({ member, state }: { member: BenchMember; state: MemberState }): ReactElement | null {
  const now = useRouterNow(member, 250);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string>();
  const run = state.run;
  const schedule = state.schedule;
  const members = state.poll?.members ?? [];
  const over = run?.state === 'done' || run?.state === 'collecting';
  // read a few seconds after the end, once the members have sent what they held
  const { data, error: dataError } = useRunData(member.session === undefined ? undefined : { session: member.session }, run?.id ?? '', over, 3000);
  if (run === undefined || schedule === undefined) return null;
  const names = new Map(members.map((m) => [m.id, m.name]));
  const t = now === undefined ? undefined : now - run.t0;
  const live = run.state === 'scheduled' || run.state === 'running';
  const at = t === undefined ? -1 : phaseAt(schedule, t);
  const phase = schedule.phases[at];
  const badge = stateBadge[run.state];
  const stop = async (): Promise<void> => {
    setStopping(true);
    setError(undefined);
    try {
      await member.stop();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStopping(false);
    }
  };
  return (
    <Card>
      <CardHeading
        icon={TimerIcon}
        title={schedule.name ?? 'Run'}
        description={schedule.dry ? 'Rehearsal: no traffic, only the timing' : `Started by ${run.started_by ?? 'the coordinator'}`}
        action={<Badge variant={badge.variant}>{badge.text}</Badge>}
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="relative">
            <PhaseStrip phases={schedule.phases} />
            {live && t !== undefined && t >= 0 && (
              <div
                className="absolute -top-1 h-4.5 w-0.5 rounded-full bg-foreground"
                style={{ left: `${String(Math.min(100, (t / schedule.length) * 100))}%` }}
                aria-hidden="true"
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground tabular">
            <span>{live && t !== undefined ? clockText(Math.max(0, t)) : '0:00'}</span>
            <span>{clockText(schedule.length)}</span>
          </div>
        </div>
        {live && (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {phase !== undefined ? (
                <>
                  <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border', phaseStyle[phase.kind].chip)}>
                    {(() => {
                      const Icon = phaseStyle[phase.kind].icon;
                      return <Icon className="size-5" />;
                    })()}
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-lg font-semibold tracking-tight">{phase.label ?? phaseStyle[phase.kind].name}</span>
                    <span className="truncate text-xs text-muted-foreground">{phaseRoles(phase, names)}</span>
                  </div>
                </>
              ) : t !== undefined && t >= schedule.length ? (
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tracking-tight">Finishing</span>
                  <span className="text-xs text-muted-foreground">The router ends the run and every device sends what it measured</span>
                </div>
              ) : (
                <div className="flex flex-col">
                  <span className="text-lg font-semibold tracking-tight">Starting in {t === undefined ? '…' : `${String(Math.max(0, Math.ceil(-t / 1000)))} s`}</span>
                  <span className="text-xs text-muted-foreground">Every device starts at the same moment, by the router&apos;s clock</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4">
              {phase !== undefined && t !== undefined && (
                <div className="flex flex-col items-end">
                  <span className="text-2xl font-semibold tracking-tight tabular">{clockText(phase.start + phase.dur - t)}</span>
                  <span className="text-[11px] text-muted-foreground">left in this phase · {clockText(schedule.length - t)} in all</span>
                </div>
              )}
              <Button type="button" variant="destructive" size="lg" disabled={stopping} onClick={() => void stop()}>
                {stopping ? <LoaderCircleIcon className="animate-spin" /> : <CircleStopIcon />} Stop
              </Button>
            </div>
          </div>
        )}
        {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
        {live && !schedule.dry && <RouterStrip live={run.live?.router} probes={run.live?.probes} />}
        {!live && (
          <Alert variant={run.ended?.reason === 'completed' ? 'success' : 'info'}>
            <AlertDescription>
              {run.ended === undefined || run.ended === null
                ? run.state === 'stopping'
                  ? `Stopping (${run.stop?.by === undefined ? 'asked' : `asked by ${run.stop.by}`})…`
                  : 'Ending…'
                : run.ended.reason === 'completed'
                  ? 'The run finished on schedule.'
                  : `The run ended early: ${run.ended.reason}.`}
            </AlertDescription>
          </Alert>
        )}
        {!live && data === undefined && dataError === undefined && over && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Reading the results…
          </p>
        )}
        {!live && data !== undefined && <RunReport data={data} />}
        {!live && dataError !== undefined && <p className="text-sm text-destructive">Couldn&apos;t read the results: {dataError}</p>}
        {live && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {members.map((m) => {
              const p = m.phase === undefined || m.phase === null ? undefined : schedule.phases[m.phase];
              const figures = memberLiveText(m);
              return (
                <li key={m.id} className="flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-sm">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{m.name}</span>
                    <span className={cn('truncate text-xs', m.seen_ms > 3000 ? 'text-warning' : 'text-muted-foreground')}>
                      {m.seen_ms > 3000 ? `not heard from for ${formatNumber(m.seen_ms / 1000)} s` : m.visible === false ? 'page hidden' : (p?.label ?? m.note ?? 'Ready')}
                    </span>
                  </span>
                  {figures !== undefined && <span className="truncate text-xs text-muted-foreground tabular">{figures}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
