import type { ReactElement, ReactNode } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { percentile } from './analysis';
import type { RunMember, RunSettings } from './api';
import { LinkLine } from './member-card';
import { clockText } from './phases';
import { type RunData, reportRun } from './run-data';
import { memberTiming, phasesReached } from './timing';
import { agentText, parseAgent } from './ua';

const signedMs = (v: number | undefined): string =>
  v === undefined ? '—' : `${v >= 0 ? '+' : '−'}${formatNumber(Math.abs(v), Math.abs(v) < 10 ? 1 : 0)} ms`;

interface TimingRow {
  m: RunMember;
  notes: string[];
  phases: ReactNode;
  typical: string;
  worst: string;
  clock: string;
}

const who = (r: TimingRow): ReactElement => (
  <>
    <div className="font-medium">{r.m.name}</div>
    <div className="text-xs text-muted-foreground">{agentText(parseAgent(r.m.ua))}</div>
    {r.notes.length > 0 && <div className="text-xs text-warning">{r.notes.join(' · ')}</div>}
  </>
);

const figure = 'text-right whitespace-nowrap tabular';
// in the run's order: few devices, nothing to sort
const timingColumns: readonly Column<TimingRow>[] = [
  { label: 'Device', cell: who },
  { label: 'Connected', cell: (r) => <LinkLine link={r.m.link} />, className: 'text-xs' },
  { label: 'Phases', cell: (r) => r.phases, className: figure },
  { label: 'Start, typical', cell: (r) => r.typical, className: figure },
  { label: 'Start, worst', cell: (r) => r.worst, className: figure },
  { label: 'Clock', cell: (r) => r.clock, className: figure },
];

/** A device's card when narrow: who, how connected, then its figures two by two. */
const timingCard = (r: TimingRow): ReactElement => (
  <div className="flex flex-col gap-2 px-4 py-3 text-sm">
    <div>{who(r)}</div>
    <div className="text-xs">
      <LinkLine link={r.m.link} />
    </div>
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
      <Item label="Phases started">{r.phases}</Item>
      <Item label="Clock">{r.clock}</Item>
      <Item label="Start, typical">{r.typical}</Item>
      <Item label="Start, worst">{r.worst}</Item>
    </dl>
  </div>
);

/** Each device: how it was connected, the phases it started, how close to time, and how far its clock could be off. A table when there's room, a card each when not. */
export function TimingTable({ data }: { data: RunData }): ReactElement {
  const reached = phasesReached(reportRun(data), data.meta.schedule.phases);
  const rows = data.meta.members.map((m): TimingRow => {
    const recs = data.records.get(m.id) ?? [];
    const t = recs.length === 0 ? undefined : memberTiming(recs, reached);
    const notes = [
      t === undefined ? 'sent nothing' : undefined,
      t?.hidden === true ? 'page hidden' : undefined,
      t?.lost === true ? 'lost the router' : undefined,
    ].filter((x) => x !== undefined);
    return {
      m,
      notes,
      phases: (
        <span className={cn(t !== undefined && t.marked < t.phases && 'text-warning')}>
          {t === undefined ? '—' : `${String(t.marked)} / ${String(t.phases)}`}
        </span>
      ),
      typical: signedMs(t?.skewMedian),
      worst: signedMs(t?.skewWorst),
      clock: t?.uncertainty === undefined ? '—' : `±${formatNumber(t.uncertainty, 1)} ms`,
    };
  });
  return (
    <DataTable
      label="Each device’s timing"
      columns={timingColumns}
      rows={rows}
      rowKey={(r) => r.m.id}
      empty="No devices took part."
      framed={false}
      card={timingCard}
    />
  );
}

function Item({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words tabular">{children}</dd>
    </div>
  );
}

const pct = (share: number): string => `${formatNumber(share * 100, share < 0.1 ? 1 : 0)}%`;
const onOff = (v: string | null | undefined): string => (v === '1' ? 'on' : 'off');

function sqmText(s: RunSettings): string {
  const q = s.sqm.find((x) => x.enabled === '1');
  if (q === undefined) return 'Off';
  const rate = (kbit: number | null | undefined): string =>
    kbit === null || kbit === undefined || kbit <= 0 ? 'not shaped' : `${formatNumber(kbit / 1000, kbit < 10000 ? 1 : 0)} Mbit/s`;
  const how = [q.qdisc, q.script, q.use_mq === '1' ? 'one queue per CPU' : undefined]
    .filter((x) => x !== undefined && x !== null && x !== '')
    .join(', ');
  return `Download ${rate(q.download)}, upload ${rate(q.upload)}${how === '' ? '' : ` (${how})`}`;
}

const bands: Record<string, string> = { '2g': '2.4 GHz', '5g': '5 GHz', '6g': '6 GHz', '60g': '60 GHz' };

function wifiText(s: RunSettings): string {
  if (s.wifi.length === 0) return 'None';
  return s.wifi
    .map((r) => {
      const parts = [
        r.band === undefined || r.band === null ? r.radio : (bands[r.band] ?? r.band),
        r.channel === undefined || r.channel === null ? undefined : `channel ${String(r.channel)}`,
        r.htmode,
      ];
      return `${parts.filter((x) => x !== undefined && x !== null && x !== '').join(' ')}${r.disabled === '1' ? ' (off)' : ''}`;
    })
    .join(' · ');
}

/** What the run was: its plan, when and by whom, the devices, the router and its settings, and what the bench cost it. */
export function RunInfo({ data }: { data: RunData }): ReactElement {
  const m = data.meta;
  const s = m.settings;
  const self = data.router.flatMap((l) => (l.self === undefined ? [] : [l.self.reduce((a, b) => a + b, 0)]));
  const cost = data.router.flatMap((l) => (l.cost_ms === undefined ? [] : [l.cost_ms])).sort((a, b) => a - b);
  const scans = data.router.flatMap((l) => (l.ct_scan?.ms === undefined ? [] : [l.ct_scan.ms])).sort((a, b) => a - b);
  const started = new Date(m.created_wall * 1000);
  const ended = data.end;
  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-sm font-semibold">About the run</h3>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Item label="Run">
          {m.schedule.name ?? 'Run'} · {String(m.schedule.phases.length)} phases, {clockText(m.schedule.length)}
          {m.schedule.dry ? ' · rehearsal' : ''}
        </Item>
        <Item label="Started">
          {started.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          {m.coordinator !== null && m.coordinator !== undefined && ` by ${m.coordinator}`}
        </Item>
        <Item label="Ended">
          {ended === null
            ? 'Not recorded'
            : ended.reason === 'completed'
              ? `On schedule, after ${clockText(ended.at - m.t0)}`
              : `Early, after ${clockText(Math.max(0, ended.at - m.t0))}: ${ended.reason}`}
        </Item>
        <Item label="Router">
          {s.model === null && s.firmware === null
            ? '—'
            : [s.model, s.firmware].filter((x) => x !== undefined && x !== null).join(' · ')}
        </Item>
        <Item label="Smart Queue">{sqmText(s)}</Item>
        <Item label="Flow offloading">
          {s.firewall.flow_offloading === '1'
            ? `On${s.firewall.flow_offloading_hw === '1' ? ', in hardware too' : ''}; for bridged traffic ${onOff(s.firewall.flow_offloading_bridge)}`
            : 'Off'}
        </Item>
        <Item label="Wi-Fi">{wifiText(s)}</Item>
        <Item label="DNS">
          {data.dns.upstream === 'dnsproxy'
            ? 'Encrypted: dnsmasq passes lookups to dnsproxy'
            : data.dns.upstream === 'server'
              ? 'Plain: dnsmasq passes lookups to its server'
              : '—'}
          {s.dns !== undefined && s.dns !== null && (
            <span className="block text-xs text-muted-foreground">DNS page’s mode: {s.dns}</span>
          )}
        </Item>
        <Item label="The bench’s own cost">
          {self.length === 0
            ? '—'
            : `${pct(self.reduce((a, b) => a + b, 0) / self.length)} of a core on average, ${pct(Math.max(...self))} at most`}
          {cost.length > 0 && (
            <span className="block text-xs text-muted-foreground">
              a sample took {formatNumber(percentile(cost, 0.5) ?? 0, 1)} ms typically
              {scans.length > 0 && `, a connection scan ${formatNumber(percentile(scans, 0.5) ?? 0, 1)} ms`}
            </span>
          )}
        </Item>
      </dl>
      <TimingTable data={data} />
    </section>
  );
}
