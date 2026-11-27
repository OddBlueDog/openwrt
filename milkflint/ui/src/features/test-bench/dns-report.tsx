import { type ReactElement, useMemo } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { formatNumber } from '@/lib/format';
import type { ReportRun } from './analysis';
import type { RunMember, Schedule } from './api';
import {
  type DeviceSite,
  deviceSites,
  deviceSummary,
  dnsmasqAdds,
  type RouterDns,
  type RouterSite,
  routerSites,
  siteMedian,
  type Timed,
  wildcardSites,
} from './dns-pages';
import type { RunData } from './run-data';
import { distinctNames } from './summary';

const ms = (v: number | undefined): string => (v === undefined ? '—' : formatNumber(v, v < 1 ? 2 : v < 10 ? 1 : 0));

function TimedCell({ t, extra }: { t: Timed; extra?: ReactElement | false | undefined }): ReactElement {
  if (t.n === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex flex-col items-end">
      <span>
        {ms(t.median)} <span className="text-muted-foreground">ms</span>
      </span>
      {t.failed > 0 && (
        <span className="text-xs text-warning">
          {String(t.failed)} of {String(t.n)} unanswered
        </span>
      )}
      {extra}
    </span>
  );
}

const upstreamName = { dnsproxy: 'Encrypted DNS alone', server: 'Its server alone' } as const;

/** A device's page load, first and again, and its lookup, for one site or the typical one. */
function LoadCell({
  first,
  repeat,
  lookup,
  failed,
  failedWord,
}: {
  first: number | undefined;
  repeat: number | undefined;
  lookup: string;
  failed: number;
  failedWord: string;
}): ReactElement {
  return (
    <span className="inline-flex flex-col items-end">
      <span>
        {ms(first)} <span className="text-muted-foreground">· {ms(repeat)} ms</span>
      </span>
      <span className="text-xs text-muted-foreground">{lookup}</span>
      {failed > 0 && (
        <span className="text-xs text-warning">
          {String(failed)} {failedWord}
        </span>
      )}
    </span>
  );
}

const figure = 'text-right whitespace-nowrap tabular';

const siteNotes = (s: RouterSite): ReactElement => (
  <>
    {s.wildcard && <span className="block text-xs font-normal text-muted-foreground">answers any name under it</span>}
    {s.errors > 0 && (
      <span className="block text-xs font-normal text-destructive">{String(s.errors)} lookups failed with an error</span>
    )}
  </>
);
const timedColumn = (label: string, t: (s: RouterSite) => Timed): Column<RouterSite> => ({
  label,
  cell: (s) => <TimedCell t={t(s)} />,
  className: figure,
});

/** The router's lookups, a site a row in the order first looked up; the upstream alone when dnsmasq passes lookups on. */
function routerColumns(upstream: RouterDns['upstream']): readonly Column<RouterSite>[] {
  return [
    {
      label: 'Site',
      cell: (s) => (
        <>
          {s.site}
          {siteNotes(s)}
        </>
      ),
      className: 'font-medium',
    },
    timedColumn('Made-up name', (s) => s.cold),
    ...(upstream === null ? [] : [timedColumn(upstreamName[upstream], (s) => s.up)]),
    timedColumn('Site, passed on', (s) => s.passedOn),
    {
      label: 'Site, cached',
      cell: (s) => (
        <TimedCell
          t={s.fromCache}
          extra={
            s.rounds > 0 && (
              <span className="text-xs text-muted-foreground">
                cached already in {String(s.cachedFirst)} of {String(s.rounds)} rounds
              </span>
            )
          }
        />
      ),
      className: figure,
    },
  ];
}

/** A row of the matrix: a site, or (null) the typical site, every site together, which comes first. */
interface LoadRow {
  site: string | null;
}

/** A device's loads for the typical site, or for one. */
function loadCell(sites: ReadonlyMap<string, DeviceSite>, site: string | null, wild: ReadonlySet<string>): ReactElement {
  if (site === null) {
    const sum = deviceSummary(sites, wild);
    return (
      <LoadCell
        first={sum.first}
        repeat={sum.repeat}
        lookup={`lookup ${ms(sum.lookup)} ms`}
        failed={sum.failed}
        failedWord="loads failed"
      />
    );
  }
  const d = sites.get(site);
  if (d === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <LoadCell
      first={d.first}
      repeat={siteMedian(d.repeats)}
      lookup={wild.has(site) ? 'lookup not timed' : `lookup ${ms(siteMedian(d.lookups))} ms`}
      failed={d.failed}
      failedWord="failed"
    />
  );
}

const typicalRow = (r: LoadRow): { className?: string } =>
  r.site === null ? { className: 'bg-muted/40 hover:bg-muted/40' } : {};

/** DNS and page loads over the run: the router's lookups per site, then each device's page loads and lookups. Tables when there's room, a card a row when not. */
export function DnsReport({
  data,
  run,
  schedule,
  members,
}: {
  data: RunData;
  run: ReportRun;
  schedule: Schedule;
  members: readonly RunMember[];
}): ReactElement | null {
  const hasPhases = schedule.phases.some((p) => p.kind === 'dns' || p.kind === 'household');
  const router = useMemo(() => routerSites(data.dns.lookups), [data.dns.lookups]);
  const devices = useMemo(() => {
    const out = new Map<string, Map<string, DeviceSite>>();
    for (const [id, recs] of data.records) {
      const sites = deviceSites(recs);
      if (sites.size > 0) out.set(id, sites);
    }
    return out;
  }, [data.records]);
  const upstream = data.dns.upstream;
  const siteColumns = useMemo(() => routerColumns(upstream), [upstream]);
  // sites down, a column a device (in the order they sent records); nothing sorts in a matrix
  const loadColumns = useMemo((): readonly Column<LoadRow>[] => {
    const wild = wildcardSites(router, devices.values());
    const names = distinctNames(members);
    return [
      { label: 'Site', cell: (r) => r.site ?? 'Typical site', className: 'font-medium' },
      ...[...devices].map(([id, sites]): Column<LoadRow> => ({
        label: names.get(id) ?? id,
        cell: (r) => loadCell(sites, r.site, wild),
        className: figure,
      })),
    ];
  }, [router, devices, members]);
  if (!hasPhases || (router.length === 0 && devices.size === 0)) return null;
  const adds = dnsmasqAdds(router);
  const siteNames = [...new Set([...router.map((s) => s.site), ...[...devices.values()].flatMap((m) => [...m.keys()])])];
  const ended = run.ended?.reason !== undefined && run.ended.reason !== 'completed';

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">DNS and pages</h3>

      {router.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            The router&apos;s own lookups
            {adds !== undefined &&
              upstream !== null &&
              (adds < 0.5
                ? ' · dnsmasq adds nothing measurable to a lookup it passes on'
                : ` · dnsmasq adds about ${ms(adds)} ms to a lookup it passes on`)}
          </span>
          <DataTable
            label="The router’s own lookups"
            columns={siteColumns}
            rows={router}
            rowKey={(s) => s.site}
            empty="The router looked nothing up."
            framed={false}
          />
        </div>
      )}

      {devices.size > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            Each device: its page loads, first and then again, and its lookups of names nothing has cached
          </span>
          <DataTable
            label="Each device’s page loads"
            columns={loadColumns}
            rows={[{ site: null }, ...siteNames.map((site) => ({ site }))]}
            rowKey={(r) => r.site ?? ''}
            empty="No device loaded a page."
            framed={false}
            rowProps={typicalRow}
          />
        </div>
      )}

      <ul className="flex max-w-prose list-disc flex-col gap-1 pl-4 text-xs text-muted-foreground">
        <li>
          Page loads are each one fetch of the site&apos;s small icon, with no cookies. These sites don&apos;t let a page see
          finer timing, so each figure is lookup, connection, encryption, request and answer together. The first is the run&apos;s
          first from that device, normally a new connection, unless one was still open from a run a few minutes earlier; the
          second reuses it.
        </li>
        <li>
          A device&apos;s lookup is the time until fetching a made-up name under the site fails, so it includes the browser&apos;s
          own error handling. Its system can cache the real names, which is why the router looks them up itself too. Sites that
          answer any name can&apos;t be timed this way.
        </li>
        <li>
          A device that uses its own DNS (a VPN, iCloud Private Relay, the browser&apos;s secure DNS) doesn&apos;t ask the router
          at all; the bench can&apos;t see that.
        </li>
        <li>
          The router&apos;s lookups, each round: a made-up name through dnsmasq, which passes it on
          {upstream === 'dnsproxy' ? ' to encrypted DNS' : ''}, then another straight there; the site itself twice, the second
          normally from dnsmasq&apos;s cache. A lookup counts as from the cache when dnsmasq passed nothing on meanwhile, so
          another device&apos;s lookup at that moment can count a cached one as passed on.
        </li>
        {ended && <li>The run ended early, so some sites have fewer figures.</li>}
      </ul>
    </section>
  );
}
