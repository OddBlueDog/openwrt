import type { ReactElement, ReactNode } from 'react';
import { type Column, DataTable, type Group } from '@/components/data-table';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { RunMember, Schedule } from './api';
import {
  memberRtts,
  memberThroughput,
  phaseWindows,
  routerRtts,
  routerWindow,
  type RttStats,
  rttStats,
  serverView,
  type ReportRun,
} from './analysis';
import { deviceSites, deviceSummary, routerSites, siteMedian } from './dns-pages';
import { linkStatus, memberPeerRtts, peerThroughput, schedulePairs } from './pairs';
import { Arrowed, Dir } from '@/components/dir';
import { phaseStyle } from './phases';
import type { RunData } from './run-data';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 10 ? 1 : 0));

/** "1.2 / 3.4 ms": typical (median) and p95 */
function RttCell({ s }: { s: RttStats }): ReactElement {
  if (s.sent === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span>
        {ms(s.median)} <span className="text-muted-foreground">/ {ms(s.p95)} ms</span>
      </span>
      {s.lost > 0 && (
        <span className={cn('text-xs', s.lost === s.sent ? 'text-destructive' : 'text-warning')}>
          {s.lost === s.sent ? 'no answer' : `${String(s.lost)} of ${String(s.sent)} unanswered`}
        </span>
      )}
    </span>
  );
}

function PingCell({ s }: { s: RttStats }): ReactElement {
  if (s.sent === 0) return <span className="text-muted-foreground">—</span>;
  if (s.lost === s.sent) return <span className="text-muted-foreground">no ping reply</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span>
        {ms(s.median)} <span className="text-muted-foreground">/ {ms(s.p95)} ms</span>
      </span>
      <span className={cn('text-xs', s.lost > 0 ? 'text-warning' : 'text-muted-foreground')}>
        {formatPercent(s.lost / s.sent)} lost
      </span>
    </span>
  );
}

const rate = (v: number): string => formatNumber(v, v < 10 ? 1 : 0);

interface Row {
  /** the phase's and the device's: a device has a row in each phase */
  key: string;
  name: string;
  router: ReactNode;
  internet: ReactNode;
  peers: ReactNode;
  ping: ReactNode;
  speed: ReactNode;
}

/** Each phase's figures: a heading with what the router did meanwhile, in one line, and a row a device. */
function phaseGroups(data: RunData, run: ReportRun, schedule: Schedule, members: readonly RunMember[]): Group<Row>[] {
  const end = run.ended?.at ?? run.end;
  const windows = phaseWindows(run.t0, schedule.phases).filter((w) => w.phase.kind !== 'cooldown' && w.from < end);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const ids = [...data.records.keys()];
  return windows.map((w) => {
    const win = { from: w.from, to: Math.min(w.to, end) };
    const r = routerWindow(data.router, win);
    const style = phaseStyle[w.phase.kind];
    const wan = rttStats(routerRtts(data.probes, 'wan', win));
    const far = rttStats(routerRtts(data.probes, 'far', win));
    // the router's lookups in a DNS or busy-household phase: names nothing had cached, and cached ones
    const dns = routerSites(data.dns.lookups, win);
    const dnsCold = siteMedian(dns.flatMap((s) => (s.cold.median === undefined ? [] : [s.cold.median])));
    const dnsCached = siteMedian(dns.flatMap((s) => (s.fromCache.median === undefined ? [] : [s.fromCache.median])));
    const wild = new Set(dns.filter((s) => s.wildcard).map((s) => s.site));
    const router = (
      <>
        CPU, busiest core {r.cpuP95 === undefined ? '—' : formatPercent(r.cpuP95)} (p95)
        {r.down !== undefined && (
          <>
            {' · queue '}
            <Dir d="down" /> {r.down.avgMs === undefined ? '—' : `${ms(r.down.avgMs)} ms`}
            {r.down.drops + r.down.marks > 0 && ` (${String(r.down.drops)} drops, ${String(r.down.marks)} marks)`}
          </>
        )}
        {r.up !== undefined && (
          <>
            {r.down === undefined ? ' · queue ' : ' · '}
            <Dir d="up" /> {r.up.avgMs === undefined ? '—' : `${ms(r.up.avgMs)} ms`}
            {r.up.drops + r.up.marks > 0 && ` (${String(r.up.drops)} drops, ${String(r.up.marks)} marks)`}
          </>
        )}
        {wan.sent > 0 && ` · router to internet ${ms(wan.median)} ms`}
        {far.sent > 0 && `, far ${ms(far.median)} ms`}
        {r.softnetDrops > 0 && ` · ${String(r.softnetDrops)} softnet drops`}
        {dnsCold !== undefined && ` · router lookups ${ms(dnsCold)} ms, cached ${formatNumber(dnsCached ?? 0, 2)} ms`}
      </>
    );
    const rows = ids.map((id): Row => {
      const recs = data.records.get(id) ?? [];
      const down = memberThroughput(recs, 'd', win);
      const up = memberThroughput(recs, 'u', win);
      const cf = serverView(recs, win);
      // the device's data limit ran out before or during this phase: its loads stopped
      const phaseEnd = run.t0 + w.phase.start + w.phase.dur;
      const role = w.phase.roles[id];
      const limit =
        recs.some((x) => x[0] === 'budget' && x[1] < phaseEnd) && (role === 'down' || role === 'up' || role === 'both');
      const failed = recs.find((x) => x[0] === 'err' && x[1] >= w.from && x[1] < phaseEnd);
      // device to device: what arrived from the partner, or what the partner says arrived from here
      const [pa, pb] = w.phase.pair ?? [];
      const partner = pa === id ? pb : pb === id ? pa : undefined;
      const fromPartner = partner === undefined ? undefined : peerThroughput(recs, partner, [win]);
      const toPartner = partner === undefined ? undefined : peerThroughput(data.records.get(partner) ?? [], id, [win]);
      const noPath = partner !== undefined && !linkStatus(recs, data.records.get(partner) ?? [], id, partner, 'b').opened;
      const pages = role === 'dns' || role === 'pages' ? deviceSummary(deviceSites(recs, win), wild) : undefined;
      const speed =
        pages !== undefined && pages.sites > 0 ? (
          <span className="inline-flex flex-col items-end">
            <span>
              pages {ms(pages.repeat ?? pages.first)} <span className="text-muted-foreground">ms</span>
            </span>
            <span className="text-xs text-muted-foreground">
              lookups {ms(pages.lookup)} ms{pages.failed > 0 ? `, ${String(pages.failed)} failed` : ''}
            </span>
          </span>
        ) : partner !== undefined && (fromPartner !== undefined || toPartner !== undefined) ? (
          <span className="inline-flex flex-col items-end">
            {toPartner !== undefined && (
              <span>
                to {names.get(partner) ?? partner} {rate(toPartner.mbit)} <span className="text-muted-foreground">Mbit/s</span>
              </span>
            )}
            {fromPartner !== undefined && (
              <span>
                from {names.get(partner) ?? partner} {rate(fromPartner.mbit)}{' '}
                <span className="text-muted-foreground">Mbit/s</span>
              </span>
            )}
          </span>
        ) : down === undefined && up === undefined ? (
          noPath ? (
            <span className="text-xs text-warning">no direct path</span>
          ) : limit ? (
            <span className="text-xs text-warning">data limit reached</span>
          ) : failed?.[0] === 'err' ? (
            <span className="text-xs break-words text-destructive">{failed[2]}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )
        ) : (
          <span className="inline-flex flex-col items-end">
            <span className="inline-flex items-center gap-1">
              {down !== undefined && (
                <>
                  <Dir d="down" /> {rate(down.mbit)}
                </>
              )}
              {up !== undefined && (
                <>
                  <Dir d="up" className={down === undefined ? undefined : 'ml-1'} /> {rate(up.mbit)}
                </>
              )}{' '}
              <span className="text-muted-foreground">Mbit/s</span>
            </span>
            {cf.n > 0 && (
              <span className="text-xs text-muted-foreground">
                server saw {ms(cf.rtt)} ms{cf.retrans > 0 ? `, ${String(cf.retrans)} resent` : ''}
              </span>
            )}
          </span>
        );
      return {
        key: `${String(w.index)}-${id}`,
        name: names.get(id) ?? id,
        router: <RttCell s={rttStats(memberRtts(recs, 'r', win))} />,
        internet: <RttCell s={rttStats(memberRtts(recs, 'w', win))} />,
        peers: <RttCell s={rttStats(memberPeerRtts(recs, win))} />,
        ping: <PingCell s={rttStats(routerRtts(data.probes, id, win))} />,
        speed,
      };
    });
    const name = w.phase.label ?? style.name;
    return {
      key: `${String(w.index + 1)} ${name}`,
      header: (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="inline-flex items-center gap-2 font-medium">
            <style.icon className={cn('size-3.5 shrink-0', style.tone)} aria-hidden="true" />
            <Arrowed text={name} />
          </span>
          <span className="text-xs text-muted-foreground tabular">{router}</span>
        </div>
      ),
      rows,
    };
  });
}

const figure = (label: string, cell: (r: Row) => ReactNode): Column<Row> => ({
  label,
  cell,
  className: 'text-right whitespace-nowrap tabular',
});
// per phase in time order, each device in the run's order: nothing sorts
const withPeers: readonly Column<Row>[] = [
  { label: 'Device', cell: (r) => r.name, className: 'font-medium' },
  figure('To the router', (r) => r.router),
  figure('Internet', (r) => r.internet),
  figure('To its peers', (r) => r.peers),
  figure('Router’s ping', (r) => r.ping),
  figure('Speed', (r) => r.speed),
];
// a column for latency to the device's partners only when the run pairs devices
const withoutPeers = withPeers.filter((c) => c.label !== 'To its peers');

/**
 * Each phase's figures, per device and for the router: latency typical /
 * p95, the router's pings, throughput. A table when there's room; when not,
 * each device's figures stack under its phase.
 */
export function ResultsTable({
  data,
  run,
  schedule,
  members,
}: {
  data: RunData;
  run: ReportRun;
  schedule: Schedule;
  members: readonly RunMember[];
}): ReactElement {
  return (
    <DataTable
      label="Phase by phase"
      columns={schedulePairs(schedule.phases).length > 0 ? withPeers : withoutPeers}
      groups={phaseGroups(data, run, schedule, members)}
      rowKey={(r) => r.key}
      empty="No phase ran."
      framed={false}
    />
  );
}
