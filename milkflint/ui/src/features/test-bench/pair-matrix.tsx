import { CableIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber, formatPercent } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReportRun } from './analysis';
import type { RunMember, Schedule } from './api';
import { type DirectionResult, type Loss, type PairResult, pairResults } from './pairs';
import { candidateText, type LinkDiag, noPathCauses, pathNotes, pathText, type Side } from './rtc-diag';
import type { RunData } from './run-data';
import { parseAgent } from './ua';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 10 ? 1 : 0));

function lossText(l: Loss | undefined): string {
  if (l === undefined) return '?';
  return l.lost === 0 ? '0 %' : formatPercent(l.lost / l.sent);
}

function side(m: RunMember | undefined, id: string, diag: LinkDiag | undefined): Side {
  const agent = parseAgent(m?.ua ?? '', false);
  return {
    name: m?.name ?? id,
    wifi: m?.link === undefined || m.link === null ? undefined : m.link.kind === 'wifi',
    browser: agent.browser ?? '',
    os: agent.os ?? '',
    diag,
  };
}

function Cell({ d, pair, onWhy }: { d: DirectionResult; pair: PairResult; onWhy: () => void }): ReactElement {
  if (!pair.probe.opened && !pair.bulk.opened) {
    return (
      <span className="flex flex-col items-start gap-1">
        <span className="inline-flex items-center gap-1.5 font-medium text-warning">
          <TriangleAlertIcon className="size-3.5" /> No direct path
        </span>
        <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onWhy}>
          What happened
        </Button>
      </span>
    );
  }
  if (d.phases === 0) return <span className="text-xs text-muted-foreground">not sent this way</span>;
  const tp = d.throughput;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-base font-semibold tracking-tight tabular">
        {tp === undefined ? (pair.bulk.opened ? '0' : '—') : formatNumber(tp.mbit, tp.mbit < 10 ? 1 : 0)} <span className="text-xs font-normal text-muted-foreground">Mbit/s</span>
      </span>
      {d.rtt.sent > 0 && (
        <span className="text-xs text-muted-foreground tabular">
          RTT {ms(d.rtt.median)} / {ms(d.rtt.p95)} ms
        </span>
      )}
      {(d.loss !== undefined || d.lossBack !== undefined) && (
        <span className={cn('text-xs tabular', (d.loss?.lost ?? 0) + (d.lossBack?.lost ?? 0) > 0 ? 'text-warning' : 'text-muted-foreground')}>
          lost {lossText(d.loss)} there, {lossText(d.lossBack)} back
        </span>
      )}
      {!pair.bulk.opened && <span className="text-[11px] text-warning">the bulk connection didn&apos;t open</span>}
    </span>
  );
}

function candidatesText(r: Record<string, number>): string {
  const entries = Object.entries(r);
  if (entries.length === 0) return 'none';
  return entries.map(([k, n]) => `${candidateText(k)}${n > 1 ? ` ×${String(n)}` : ''}`).join(', ');
}

function DiagColumn({ s }: { s: Side }): ReactElement {
  const d = s.diag;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-lg border p-3 text-xs">
      <span className="text-sm font-medium">{s.name}</span>
      {d === undefined ? (
        <span className="text-muted-foreground">Sent nothing about this pair.</span>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Signalling</dt>
          <dd>
            {d.offerer ? 'made the offer' : 'answers'}; {d.offerer ? 'offer' : 'answer'} {d.sent ? 'sent' : 'not sent'}; {d.offerer ? 'answer' : 'offer'}{' '}
            {d.got ? 'arrived' : 'never came'}
          </dd>
          <dt className="text-muted-foreground">States</dt>
          <dd>
            connection {d.pc}, ICE {d.ice}, gathering {d.gathering}
            {d.dtls !== null && `, DTLS ${d.dtls}`}
          </dd>
          <dt className="text-muted-foreground">Its candidates</dt>
          <dd className="break-words">{candidatesText(d.local)}</dd>
          <dt className="text-muted-foreground">The other&apos;s</dt>
          <dd className="break-words">{candidatesText(d.remote)}</dd>
          <dt className="text-muted-foreground">Checks</dt>
          <dd className="tabular">
            {String(d.requestsSent)} sent, {String(d.requestsReceived)} received, {String(d.responsesReceived)} answered
            {Object.keys(d.pairs).length > 0 && ` (pairs: ${Object.entries(d.pairs).map(([k, n]) => `${String(n)} ${k}`).join(', ')})`}
          </dd>
          {d.error !== null && (
            <>
              <dt className="text-muted-foreground">Error</dt>
              <dd className="break-words text-destructive">{d.error}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

/** Device to device: a matrix of what each planned pair measured, from (rows) to (columns), and why a pair found no path. */
export function PairMatrix({ data, run, schedule, members }: { data: RunData; run: ReportRun; schedule: Schedule; members: readonly RunMember[] }): ReactElement | null {
  const end = run.ended?.at ?? run.end;
  const pairs = useMemo(() => pairResults(run.t0, end, schedule.phases, data.records), [run.t0, end, schedule.phases, data.records]);
  const [why, setWhy] = useState<PairResult>();
  if (pairs.length === 0) return null;
  const byId = new Map(members.map((m) => [m.id, m]));
  const name = (id: string): string => byId.get(id)?.name ?? id;
  const ids = [...new Set(pairs.flatMap((p) => [p.a, p.b]))];
  const find = (x: string, y: string): { pair: PairResult; d: DirectionResult } | undefined => {
    for (const p of pairs) {
      if (p.a === x && p.b === y) return { pair: p, d: p.ab };
      if (p.a === y && p.b === x) return { pair: p, d: p.ba };
    }
    return undefined;
  };
  const linkKind = (id: string): string => {
    const l = byId.get(id)?.link;
    return l === undefined || l === null ? '' : l.kind === 'wired' ? 'wired' : `Wi-Fi${l.band === undefined || l.band === null ? '' : ` ${l.band} GHz`}`;
  };
  const whyA = why === undefined ? undefined : side(byId.get(why.a), why.a, why.probe.a ?? why.bulk.a);
  const whyB = why === undefined ? undefined : side(byId.get(why.b), why.b, why.probe.b ?? why.bulk.b);
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <CableIcon className="size-4 text-muted-foreground" /> Device to device
      </h3>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-32">From ↓ To →</TableHead>
              {ids.map((id) => (
                <TableHead key={id}>
                  <span className="flex flex-col">
                    <span>{name(id)}</span>
                    <span className="text-[11px] font-normal text-muted-foreground">{linkKind(id)}</span>
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {ids.map((x) => (
              <TableRow key={x} className="hover:bg-transparent">
                <TableCell className="font-medium">{name(x)}</TableCell>
                {ids.map((y) => {
                  const f = x === y ? undefined : find(x, y);
                  return (
                    <TableCell key={y} className={cn('align-top', x === y && 'bg-muted/30')}>
                      {f === undefined ? (
                        <span className="text-muted-foreground">{x === y ? '' : '—'}</span>
                      ) : (
                        <Cell
                          d={f.d}
                          pair={f.pair}
                          onWhy={() => {
                            setWhy(f.pair);
                          }}
                        />
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
        {pairs.map((p) => {
          const opened = p.probe.opened || p.bulk.opened;
          const notes = pathNotes(p.probe.path ?? p.bulk.path);
          return (
            <li key={`${p.a}-${p.b}`} className="flex flex-col gap-0.5">
              <span className="tabular">
                <span className="font-medium text-foreground">
                  {name(p.a)} ↔ {name(p.b)}
                </span>
                {opened ? (
                  <>
                    {(p.probe.path ?? p.bulk.path) !== null && ` · ${pathText(p.probe.path ?? p.bulk.path)}`}
                    {p.probe.ms !== undefined && ` · connected in ${formatNumber(p.probe.ms / 1000, 1)} s`}
                    {p.quiet.sent > 0 && ` · RTT at rest ${ms(p.quiet.median)} / ${ms(p.quiet.p95)} ms`}
                    {(p.loss.ab !== undefined || p.loss.ba !== undefined) && ` · lost over the run ${lossText(p.loss.ab)} → ${lossText(p.loss.ba)} ←`}
                    {(p.probe.dropped || p.bulk.dropped) && <span className="text-warning"> · the connection dropped during the run</span>}
                  </>
                ) : (
                  ' · no direct path'
                )}
              </span>
              {notes.map((n) => (
                <span key={n} className="text-warning">
                  {n}
                </span>
              ))}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        Over browsers&apos; data channels: throughput is bounded by each browser&apos;s SCTP stack and CPU, so it can be below what the link carries. RTT and loss come
        from ten numbered probes a second each way, on a connection of their own that nothing resends.
      </p>
      <Dialog
        open={why !== undefined}
        onOpenChange={(open) => {
          if (!open) setWhy(undefined);
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              No direct path: {whyA?.name ?? ''} and {whyB?.name ?? ''}
            </DialogTitle>
            <DialogDescription>
              The two browsers looked for a path between them on the home network, with no server in between, and found none. Nothing was relayed through the
              router.
            </DialogDescription>
          </DialogHeader>
          {whyA !== undefined && whyB !== undefined && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Likely reasons</span>
                <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
                  {noPathCauses(whyA, whyB).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <DiagColumn s={whyA} />
                <DiagColumn s={whyB} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                Candidates are listed by type, protocol and the kind of address (an mDNS name is a browser hiding the device&apos;s address); the addresses
                themselves aren&apos;t kept.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
