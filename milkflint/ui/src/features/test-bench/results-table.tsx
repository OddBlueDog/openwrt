import type { ReactElement, ReactNode } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { Arrowed, Dir } from './dir';
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
  id: string;
  name: string;
  router: ReactNode;
  internet: ReactNode;
  peers: ReactNode;
  ping: ReactNode;
  speed: ReactNode;
}

interface Block {
  key: string;
  icon: ReactElement;
  name: string;
  /** what the router did meanwhile, in one line */
  router: ReactNode;
  rows: Row[];
}

/** The phases' figures, worked out once for both layouts. */
function blocks(data: RunData, run: ReportRun, schedule: Schedule, members: readonly RunMember[]): Block[] {
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
        id,
        name: names.get(id) ?? id,
        router: <RttCell s={rttStats(memberRtts(recs, 'r', win))} />,
        internet: <RttCell s={rttStats(memberRtts(recs, 'w', win))} />,
        peers: <RttCell s={rttStats(memberPeerRtts(recs, win))} />,
        ping: <PingCell s={rttStats(routerRtts(data.probes, id, win))} />,
        speed,
      };
    });
    return {
      key: String(w.index),
      icon: <style.icon className={cn('size-3.5 shrink-0', style.tone)} aria-hidden="true" />,
      name: w.phase.label ?? style.name,
      router,
      rows,
    };
  });
}

/** A figure in a device's stacked block on a phone: its label left, the figure right. */
function Pair({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm tabular">{children}</dd>
    </div>
  );
}

/**
 * Each phase's figures, per device and for the router: latency typical /
 * p95, the router's pings, throughput. A table on a wide screen; on a
 * narrower one each device's figures stack under its phase.
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
  const list = blocks(data, run, schedule, members);
  // a column for latency to the device's partners, when the run pairs devices
  const peers = schedulePairs(schedule.phases).length > 0;
  const cols = peers ? 6 : 5;
  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead className="text-right">To the router</TableHead>
              <TableHead className="text-right">Internet</TableHead>
              {peers && <TableHead className="text-right">To its peers</TableHead>}
              <TableHead className="text-right">Router&apos;s ping</TableHead>
              <TableHead className="text-right">Speed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((b) => [
              <TableRow key={`p${b.key}`} className="bg-muted/40 hover:bg-muted/40">
                <TableCell colSpan={cols} className="py-2 whitespace-normal">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-2 font-medium">
                      {b.icon}
                      <Arrowed text={b.name} />
                    </span>
                    <span className="text-xs text-muted-foreground tabular">{b.router}</span>
                  </div>
                </TableCell>
              </TableRow>,
              ...b.rows.map((r) => (
                <TableRow key={`${b.key}-${r.id}`}>
                  <TableCell className="font-medium">{r.name}</TableCell>
                  <TableCell className="text-right tabular">{r.router}</TableCell>
                  <TableCell className="text-right tabular">{r.internet}</TableCell>
                  {peers && <TableCell className="text-right tabular">{r.peers}</TableCell>}
                  <TableCell className="text-right tabular">{r.ping}</TableCell>
                  <TableCell className="text-right tabular">{r.speed}</TableCell>
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-col lg:hidden">
        {list.map((b) => (
          <div key={b.key} className="flex flex-col">
            <div className="flex flex-col gap-0.5 border-y bg-muted/40 px-3 py-2">
              <span className="inline-flex items-center gap-2 text-sm font-medium">
                {b.icon}
                <Arrowed text={b.name} />
              </span>
              <span className="text-xs text-muted-foreground tabular">{b.router}</span>
            </div>
            <ul className="divide-y">
              {b.rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-1.5 px-3 py-3">
                  <span className="text-sm font-medium">{r.name}</span>
                  <dl className="flex flex-col gap-1.5">
                    <Pair label="To the router">{r.router}</Pair>
                    <Pair label="Internet">{r.internet}</Pair>
                    {peers && <Pair label="To its peers">{r.peers}</Pair>}
                    <Pair label="Router’s ping">{r.ping}</Pair>
                    <Pair label="Speed">{r.speed}</Pair>
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
