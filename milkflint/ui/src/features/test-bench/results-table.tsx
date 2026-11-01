import type { ReactElement } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { RunMember, Schedule } from './api';
import { memberRtts, memberThroughput, phaseWindows, routerRtts, routerWindow, type RttStats, rttStats, serverView, type ReportRun } from './analysis';
import { deviceSites, deviceSummary, routerSites, siteMedian } from './dns-pages';
import { linkStatus, memberPeerRtts, peerThroughput, schedulePairs } from './pairs';
import { phaseStyle } from './phases';
import type { RunData } from './run-data';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 10 ? 1 : 0));

/** "1.2 / 3.4 ms": typical (median) and p95 */
function RttCell({ s }: { s: RttStats }): ReactElement {
  if (s.sent === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end">
      <span>
        {ms(s.median)} <span className="text-muted-foreground">/ {ms(s.p95)} ms</span>
      </span>
      {s.lost > 0 && (
        <span className={cn('text-[11px]', s.lost === s.sent ? 'text-destructive' : 'text-warning')}>
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
    <span className="flex flex-col items-end">
      <span>
        {ms(s.median)} <span className="text-muted-foreground">/ {ms(s.p95)} ms</span>
      </span>
      <span className={cn('text-[11px]', s.lost > 0 ? 'text-warning' : 'text-muted-foreground')}>{formatPercent(s.lost / s.sent)} lost</span>
    </span>
  );
}

/** Each phase's figures, per device and for the router: latency typical / p95, the router's pings, throughput. */
export function ResultsTable({ data, run, schedule, members }: { data: RunData; run: ReportRun; schedule: Schedule; members: readonly RunMember[] }): ReactElement {
  const end = run.ended?.at ?? run.end;
  const windows = phaseWindows(run.t0, schedule.phases).filter((w) => w.phase.kind !== 'cooldown' && w.from < end);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const ids = [...data.records.keys()];
  // a column for latency to the device's partners, when the run pairs devices
  const peers = schedulePairs(schedule.phases).length > 0;
  const cols = peers ? 6 : 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Device</TableHead>
          <TableHead className="text-right">To the router</TableHead>
          <TableHead className="text-right">Internet</TableHead>
          {peers && <TableHead className="text-right">To its peers</TableHead>}
          <TableHead className="hidden text-right md:table-cell">Router&apos;s ping</TableHead>
          <TableHead className="text-right">Speed</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {windows.map((w) => {
          const win = { from: w.from, to: Math.min(w.to, end) };
          const r = routerWindow(data.router, win);
          const Icon = phaseStyle[w.phase.kind].icon;
          const wan = rttStats(routerRtts(data.probes, 'wan', win));
          const far = rttStats(routerRtts(data.probes, 'far', win));
          // the router's lookups in a DNS or busy-household phase: names nothing had cached, and cached ones
          const dns = routerSites(data.dns.lookups, win);
          const dnsCold = siteMedian(dns.flatMap((s) => (s.cold.median === undefined ? [] : [s.cold.median])));
          const dnsCached = siteMedian(dns.flatMap((s) => (s.fromCache.median === undefined ? [] : [s.fromCache.median])));
          const wild = new Set(dns.filter((s) => s.wildcard).map((s) => s.site));
          return [
            <TableRow key={`p${String(w.index)}`} className="bg-muted/40 hover:bg-muted/40">
              <TableCell colSpan={cols} className="py-2 whitespace-normal">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-2 font-medium">
                    <Icon className="size-3.5 text-muted-foreground" />
                    {w.phase.label ?? phaseStyle[w.phase.kind].name}
                  </span>
                  <span className="text-xs text-muted-foreground tabular">
                    CPU, busiest core {r.cpuP95 === undefined ? '—' : formatPercent(r.cpuP95)} (p95)
                    {r.down !== undefined && ` · queue ↓ ${ms(r.down.avgMs)} ms`}
                    {r.down !== undefined && r.down.drops + r.down.marks > 0 && ` (${String(r.down.drops)} drops, ${String(r.down.marks)} marks)`}
                    {r.up !== undefined && ` · ↑ ${ms(r.up.avgMs)} ms`}
                    {r.up !== undefined && r.up.drops + r.up.marks > 0 && ` (${String(r.up.drops)} drops, ${String(r.up.marks)} marks)`}
                    {wan.sent > 0 && ` · router to internet ${ms(wan.median)} ms`}
                    {far.sent > 0 && `, far ${ms(far.median)} ms`}
                    {r.softnetDrops > 0 && ` · ${String(r.softnetDrops)} softnet drops`}
                    {dnsCold !== undefined && ` · router lookups ${ms(dnsCold)} ms, cached ${formatNumber(dnsCached ?? 0, 2)} ms`}
                  </span>
                </div>
              </TableCell>
            </TableRow>,
            ...ids.map((id) => {
              const recs = data.records.get(id) ?? [];
              const down = memberThroughput(recs, 'd', win);
              const up = memberThroughput(recs, 'u', win);
              const cf = serverView(recs, win);
              // the device's data limit ran out before or during this phase: its loads stopped
              const phaseEnd = run.t0 + w.phase.start + w.phase.dur;
              const role = w.phase.roles[id];
              const limit = recs.some((r) => r[0] === 'budget' && r[1] < phaseEnd) && (role === 'down' || role === 'up' || role === 'both');
              const failed = recs.find((r) => r[0] === 'err' && r[1] >= w.from && r[1] < phaseEnd);
              // device to device: what arrived from the partner, or what the partner says arrived from here
              const [pa, pb] = w.phase.pair ?? [];
              const partner = pa === id ? pb : pb === id ? pa : undefined;
              const fromPartner = partner === undefined ? undefined : peerThroughput(recs, partner, [win]);
              const toPartner = partner === undefined ? undefined : peerThroughput(data.records.get(partner) ?? [], id, [win]);
              const noPath = partner !== undefined && !linkStatus(recs, data.records.get(partner) ?? [], id, partner, 'b').opened;
              const pages = role === 'dns' || role === 'pages' ? deviceSummary(deviceSites(recs, win), wild) : undefined;
              return (
                <TableRow key={`${String(w.index)}-${id}`}>
                  <TableCell className="font-medium">{names.get(id) ?? id}</TableCell>
                  <TableCell className="text-right tabular">
                    <RttCell s={rttStats(memberRtts(recs, 'r', win))} />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    <RttCell s={rttStats(memberRtts(recs, 'w', win))} />
                  </TableCell>
                  {peers && (
                    <TableCell className="text-right tabular">
                      <RttCell s={rttStats(memberPeerRtts(recs, win))} />
                    </TableCell>
                  )}
                  <TableCell className="hidden text-right tabular md:table-cell">
                    <PingCell s={rttStats(routerRtts(data.probes, id, win))} />
                  </TableCell>
                  <TableCell className="text-right tabular">
                    {pages !== undefined && pages.sites > 0 ? (
                      <span className="flex flex-col items-end">
                        <span>
                          pages {ms(pages.repeat ?? pages.first)} <span className="text-muted-foreground">ms</span>
                        </span>
                        <span className="text-[11px] text-muted-foreground">
                          lookups {ms(pages.lookup)} ms{pages.failed > 0 ? `, ${String(pages.failed)} failed` : ''}
                        </span>
                      </span>
                    ) : partner !== undefined && (fromPartner !== undefined || toPartner !== undefined) ? (
                      <span className="flex flex-col items-end">
                        {toPartner !== undefined && (
                          <span>
                            → {names.get(partner) ?? partner} {formatNumber(toPartner.mbit, toPartner.mbit < 10 ? 1 : 0)} <span className="text-muted-foreground">Mbit/s</span>
                          </span>
                        )}
                        {fromPartner !== undefined && (
                          <span>
                            ← {names.get(partner) ?? partner} {formatNumber(fromPartner.mbit, fromPartner.mbit < 10 ? 1 : 0)} <span className="text-muted-foreground">Mbit/s</span>
                          </span>
                        )}
                      </span>
                    ) : down === undefined && up === undefined ? (
                      noPath ? (
                        <span className="text-[11px] text-warning">no direct path</span>
                      ) : limit ? (
                        <span className="text-[11px] text-warning">data limit reached</span>
                      ) : failed?.[0] === 'err' ? (
                        <span className="text-[11px] text-destructive">{failed[2]}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )
                    ) : (
                      <span className="flex flex-col items-end">
                        <span>
                          {down !== undefined && `↓ ${formatNumber(down.mbit, down.mbit < 10 ? 1 : 0)}`}
                          {down !== undefined && up !== undefined && ' '}
                          {up !== undefined && `↑ ${formatNumber(up.mbit, up.mbit < 10 ? 1 : 0)}`} <span className="text-muted-foreground">Mbit/s</span>
                        </span>
                        {cf.n > 0 && (
                          <span className="text-[11px] text-muted-foreground">
                            server saw {ms(cf.rtt)} ms{cf.retrans > 0 ? `, ${String(cf.retrans)} resent` : ''}
                          </span>
                        )}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              );
            }),
          ];
        })}
      </TableBody>
    </Table>
  );
}
