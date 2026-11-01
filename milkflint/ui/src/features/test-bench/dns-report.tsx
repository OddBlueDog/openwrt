import { GlobeIcon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { ReportRun } from './analysis';
import type { RunMember, Schedule } from './api';
import { deviceSites, deviceSummary, dnsmasqAdds, routerSites, siteMedian, type Timed, wildcardSites } from './dns-pages';
import type { RunData } from './run-data';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 1 ? 2 : v < 10 ? 1 : 0));

function TimedCell({ t, extra }: { t: Timed; extra?: ReactElement | false | undefined }): ReactElement {
  if (t.n === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-end">
      <span>
        {ms(t.median)} <span className="text-muted-foreground">ms</span>
      </span>
      {t.failed > 0 && (
        <span className="text-[11px] text-warning">
          {String(t.failed)} of {String(t.n)} unanswered
        </span>
      )}
      {extra}
    </span>
  );
}

const upstreamName = { dnsproxy: 'Encrypted DNS alone', server: 'Its server alone' } as const;

/** DNS and page loads over the run: the router's lookups per site, then each device's page loads and lookups. */
export function DnsReport({ data, run, schedule, members }: { data: RunData; run: ReportRun; schedule: Schedule; members: readonly RunMember[] }): ReactElement | null {
  const hasPhases = schedule.phases.some((p) => p.kind === 'dns' || p.kind === 'household');
  const router = useMemo(() => routerSites(data.dns.lookups), [data.dns.lookups]);
  const devices = useMemo(() => {
    const out = new Map<string, ReturnType<typeof deviceSites>>();
    for (const [id, recs] of data.records) {
      const sites = deviceSites(recs);
      if (sites.size > 0) out.set(id, sites);
    }
    return out;
  }, [data.records]);
  if (!hasPhases || (router.length === 0 && devices.size === 0)) return null;
  const wild = wildcardSites(router, devices.values());
  const adds = dnsmasqAdds(router);
  const names = new Map(members.map((m) => [m.id, m.name]));
  const ids = [...devices.keys()];
  const siteNames = [...new Set([...router.map((s) => s.site), ...[...devices.values()].flatMap((m) => [...m.keys()])])];
  const upstream = data.dns.upstream;
  const ended = run.ended?.reason !== undefined && run.ended.reason !== 'completed';
  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <GlobeIcon className="size-4 text-muted-foreground" /> DNS and pages
      </h3>

      {router.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            The router&apos;s own lookups
            {adds !== undefined &&
              upstream !== null &&
              (adds < 0.5 ? ' · dnsmasq adds nothing measurable to a lookup it passes on' : ` · dnsmasq adds about ${ms(adds)} ms to a lookup it passes on`)}
          </span>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  <TableHead className="text-right">Made-up name</TableHead>
                  {upstream !== null && <TableHead className="text-right">{upstreamName[upstream]}</TableHead>}
                  <TableHead className="text-right">Site, passed on</TableHead>
                  <TableHead className="text-right">Site, cached</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {router.map((s) => (
                  <TableRow key={s.site}>
                    <TableCell className="font-medium">
                      <span className="flex flex-col">
                        <span>{s.site}</span>
                        {s.wildcard && <span className="text-[11px] font-normal text-muted-foreground">answers any name under it</span>}
                        {s.errors > 0 && <span className="text-[11px] font-normal text-destructive">{String(s.errors)} lookups failed with an error</span>}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      <TimedCell t={s.cold} />
                    </TableCell>
                    {upstream !== null && (
                      <TableCell className="text-right tabular">
                        <TimedCell t={s.up} />
                      </TableCell>
                    )}
                    <TableCell className="text-right tabular">
                      <TimedCell t={s.passedOn} />
                    </TableCell>
                    <TableCell className="text-right tabular">
                      <TimedCell
                        t={s.fromCache}
                        extra={
                          s.rounds > 0 && (
                            <span className="text-[11px] text-muted-foreground">
                              cached already in {String(s.cachedFirst)} of {String(s.rounds)} rounds
                            </span>
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {ids.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Each device: its page loads, first and then again, and its lookups of names nothing has cached</span>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Site</TableHead>
                  {ids.map((id) => (
                    <TableHead key={id} className="text-right">
                      {names.get(id) ?? id}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableCell className="font-medium">Typical site</TableCell>
                  {ids.map((id) => {
                    const sum = deviceSummary(devices.get(id) ?? new Map(), wild);
                    return (
                      <TableCell key={id} className="text-right tabular">
                        <span className="flex flex-col items-end">
                          <span>
                            {ms(sum.first)} <span className="text-muted-foreground">· {ms(sum.repeat)} ms</span>
                          </span>
                          <span className="text-[11px] text-muted-foreground">lookup {ms(sum.lookup)} ms</span>
                          {sum.failed > 0 && <span className="text-[11px] text-warning">{String(sum.failed)} loads failed</span>}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
                {siteNames.map((site) => (
                  <TableRow key={site}>
                    <TableCell className="font-medium">{site}</TableCell>
                    {ids.map((id) => {
                      const d = devices.get(id)?.get(site);
                      if (d === undefined) {
                        return (
                          <TableCell key={id} className="text-right text-muted-foreground">
                            —
                          </TableCell>
                        );
                      }
                      const lookup = wild.has(site) ? undefined : siteMedian(d.lookups);
                      return (
                        <TableCell key={id} className="text-right tabular">
                          <span className="flex flex-col items-end">
                            <span>
                              {ms(d.first)} <span className="text-muted-foreground">· {ms(siteMedian(d.repeats))} ms</span>
                            </span>
                            <span className="text-[11px] text-muted-foreground">{wild.has(site) ? 'lookup not timed' : `lookup ${ms(lookup)} ms`}</span>
                            {d.failed > 0 && <span className={cn('text-[11px]', 'text-warning')}>{String(d.failed)} failed</span>}
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] text-muted-foreground">
        <li>
          Page loads are each one fetch of the site&apos;s small icon, with no cookies. These sites don&apos;t let a page see finer timing, so each figure is lookup,
          connection, encryption, request and answer together. The first is the run&apos;s first from that device, normally a new connection, unless one was
          still open from a run a few minutes earlier; the second reuses it.
        </li>
        <li>
          A device&apos;s lookup is the time until fetching a made-up name under the site fails, so it includes the browser&apos;s own error handling. Its system
          can cache the real names, which is why the router looks them up itself too. Sites that answer any name can&apos;t be timed this way.
        </li>
        <li>
          A device that uses its own DNS (a VPN, iCloud Private Relay, the browser&apos;s secure DNS) doesn&apos;t ask the router at all; the bench can&apos;t see
          that.
        </li>
        <li>
          The router&apos;s lookups, each round: a made-up name through dnsmasq, which passes it on
          {upstream === 'dnsproxy' ? ' to encrypted DNS' : ''}, then another straight there; the site itself twice, the second normally from dnsmasq&apos;s
          cache. A lookup counts as from the cache when dnsmasq passed nothing on meanwhile, so another device&apos;s lookup at that moment can count a
          cached one as passed on.
        </li>
        {ended && <li>The run ended early, so some sites have fewer figures.</li>}
      </ul>
    </section>
  );
}
