// The banIP page's Activity tab: what's been blocked. The drops banIP logs
// (MilkFlint's monitor keeps them in RAM, parsed), filterable and paged,
// each with a lookup and its fix; what's blocked most (addresses, devices,
// ports, lists); each list's hits from banIP's report, and its contents a
// page at a time; the log monitor's own blocks; banIP's own log.
import {
  ActivityIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  ListIcon,
  LoaderCircleIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useQuery } from '@tanstack/react-query';
import { useLive } from '@/lib/query/use-live';
import { hintName } from '@/lib/api/network';
import { formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import {
  allowAddress,
  type BanipConfig,
  type BanipStatus,
  type Drop,
  type DropFilter,
  getReport,
  type Report,
  type ReportSet,
  type Search,
  saveOptions,
  search,
  type Survey,
  survey,
} from './api';
import { infoOf } from './feeds';
import { LookupResult } from './lookup';
import { describeDrop, type DropWords, parseLogLine, serviceOf } from './model';
import { Segmented } from '@/components/ui/segmented';
import { banipQueries, useBanipWrite } from './queries';

const PAGE = 50;

function timeText(t: number): string {
  const d = new Date(t * 1000);
  return new Date().toDateString() === d.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** "tcp/22" → "SSH (TCP 22)", "icmp" → "ICMP" */
function portLabel(k: string): string {
  const [proto = '', port = ''] = k.split('/');
  return serviceOf({ proto, sport: '', dport: port });
}

const setName = (s: string): string => (s === '' ? '–' : s.replace(/\.(v4|v6)(MAC)?$/, ''));

function Recording({ c, s }: { c: BanipConfig; s: BanipStatus | undefined }): ReactElement {
  const [busy, setBusy] = useState<string>();
  const [failed, setFailed] = useState<string>();
  const write = useBanipWrite();
  const set = (name: 'ban_loginbound' | 'ban_logoutbound', on: boolean): void => {
    setBusy(name);
    setFailed(undefined);
    write
      .mutateAsync(() => saveOptions({ [name]: on ? '1' : '0' }))
      .then(
        () => {
          setBusy(undefined);
        },
        (err: unknown) => {
          setBusy(undefined);
          setFailed(errorMessage(err));
        },
      );
  };
  const out = s?.logging?.outbound ?? c.options?.['ban_logoutbound'] === '1';
  const inb = s?.logging?.inbound ?? c.options?.['ban_loginbound'] === '1';
  return (
    <Card>
      <CardHeading
        icon={ActivityIcon}
        title="What’s recorded"
        description="Each blocked connection can be listed here. banIP counts them all either way, while counting is on."
      />
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Switch
            className="mt-0.5"
            checked={out}
            disabled={busy !== undefined}
            onCheckedChange={(v) => {
              set('ban_logoutbound', v);
            }}
            aria-label="List blocked connections from your devices"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Blocked connections from your devices</span>
            <span className="text-xs text-muted-foreground">
              Rare, and the ones to look at: a list may have blocked something a device needs.
            </span>
          </span>
        </div>
        <div className="flex items-start gap-3">
          <Switch
            className="mt-0.5"
            checked={inb}
            disabled={busy !== undefined}
            onCheckedChange={(v) => {
              set('ban_loginbound', v);
            }}
            aria-label="List blocked attempts from the internet"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Blocked attempts from the internet</span>
            <span className="text-xs text-muted-foreground">
              Many: scanners knock all day. They’re kept out of the saved system log, but fill its part in memory faster.
            </span>
          </span>
        </div>
        {busy !== undefined && <p className="text-xs text-muted-foreground">banIP restarts to change this.</p>}
        {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
      </CardContent>
    </Card>
  );
}

function Top({
  title,
  rows,
  mono = false,
  label,
}: {
  title: string;
  rows: readonly { key: string; count: number }[];
  mono?: boolean;
  label?: (k: string) => string;
}): ReactElement {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">None yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {rows.slice(0, 6).map((r) => (
            <li key={r.key} className="flex flex-col gap-0.5">
              <span className="flex justify-between gap-3 text-xs">
                <span className={cn('truncate', mono && 'font-mono')}>{label?.(r.key) ?? r.key}</span>
                <span className="text-muted-foreground tabular">{formatNumber(r.count)}</span>
              </span>
              <span className="h-1 rounded-full bg-muted">
                <span className="block h-1 rounded-full bg-primary/70" style={{ width: `${String((r.count / max) * 100)}%` }} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LookupDialog({
  query,
  conntrack,
  onClose,
  onChanged,
}: {
  query: string;
  conntrack: boolean;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const [result, setResult] = useState<Search>();
  const [failed, setFailed] = useState<string>();
  const go = (): void => {
    search(query).then(setResult, (err: unknown) => {
      setFailed(errorMessage(err));
    });
  };
  useEffect(go, [query]);
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{query}</DialogTitle>
          <DialogDescription>Where it is in banIP’s lists, and what can be done about it.</DialogDescription>
        </DialogHeader>
        {failed !== undefined ? (
          <p className="text-sm text-destructive">{failed}</p>
        ) : result === undefined ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircleIcon className="size-4 animate-spin" /> Looking in the lists…
          </p>
        ) : (
          <LookupResult result={result} conntrack={conntrack} onChanged={onChanged} redo={go} />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DropRow {
  d: Drop;
  w: DropWords;
  key: string;
}

/** The blocked connections' columns: who the device is, and the row's actions, from the log's own state. */
function dropColumns(
  deviceCell: (d: Drop, w: DropWords) => ReactElement | string,
  rowActions: (d: Drop, w: DropWords, end: boolean) => ReactElement,
): Column<DropRow>[] {
  return [
    { label: 'Time', cell: ({ d }) => timeText(d.t), className: 'w-28 text-xs whitespace-nowrap text-muted-foreground tabular' },
    {
      label: 'What',
      cell: ({ w }) => (
        <>
          <span className="block">{w.direction}</span>
          <span className="text-xs text-muted-foreground">{w.service}</span>
        </>
      ),
    },
    { label: 'Address', cell: ({ w }) => <span className="font-mono text-xs">{w.outside}</span> },
    { label: 'Device', cell: ({ d, w }) => deviceCell(d, w), className: 'text-xs' },
    { label: 'List', cell: ({ d }) => setName(d.set), className: 'text-xs' },
    {
      label: 'Actions',
      hidden: true,
      cell: ({ d, w }) => rowActions(d, w, true),
      className: 'w-28 py-1.5 text-right xl:w-44',
    },
  ];
}

function DropLog({ c, onChanged }: { c: BanipConfig; onChanged: () => void }): ReactElement {
  const [dir, setDir] = useState<'all' | 'out' | 'in' | 'pre'>('all');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [look, setLook] = useState<string>();
  const [allowed, setAllowed] = useState<Record<string, string>>({});
  const filter: DropFilter = {
    ...(dir === 'all' ? {} : { dir }),
    ...(/^\d{1,5}$/.test(q.trim())
      ? { port: q.trim() }
      : q.trim() !== '' && /^[0-9a-fA-F.:]+$/.test(q.trim())
        ? { address: q.trim() }
        : {}),
  };
  const { data, loading, refresh } = useLive(banipQueries.drops(page * PAGE, PAGE, filter));
  const hints = useQuery(banipQueries.hostHints()).data;
  const write = useBanipWrite();
  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const [mac, h] of Object.entries(hints ?? {})) {
      const n = hintName(h);
      if (n === undefined) continue;
      m.set(mac.toLowerCase(), n);
      for (const ip of [...(h.ipaddrs ?? []), ...(h.ip6addrs ?? [])]) m.set(ip, n);
    }
    return m;
  }, [hints]);
  const device = useCallback(
    (ip: string | null, mac: string): string | undefined =>
      (mac !== '' ? names.get(mac.toLowerCase()) : undefined) ?? (ip === null ? undefined : names.get(ip)),
    [names],
  );
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE));
  const conntrack = c.tools?.conntrack === true;
  const deviceCell = useCallback(
    (d: Drop, w: DropWords): ReactElement | string => {
      const who = d.dir === 'out' ? device(d.src, d.mac) : w.inside === null ? undefined : device(w.inside, '');
      return (
        who ??
        (w.inside === null ? (
          <span className="text-muted-foreground">the router</span>
        ) : (
          <span className="font-mono">{w.inside}</span>
        ))
      );
    },
    [device],
  );
  const rowActions = useCallback(
    (d: Drop, w: DropWords, end: boolean): ReactElement => (
      <div className={cn('flex gap-1', end && 'justify-end')}>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setLook(w.outside);
          }}
        >
          Look up
        </Button>
        {d.dir !== 'pre' && (
          <Button
            size="sm"
            variant="ghost"
            title="Always allow"
            aria-label={`Always allow ${w.outside}`}
            disabled={allowed[w.outside] !== undefined}
            onClick={() => {
              setAllowed((a) => ({ ...a, [w.outside]: 'busy' }));
              write
                .mutateAsync(() => allowAddress(w.outside))
                .then(
                  () => {
                    setAllowed((a) => ({ ...a, [w.outside]: 'done' }));
                  },
                  () => {
                    setAllowed((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== w.outside)));
                  },
                );
            }}
          >
            {allowed[w.outside] === 'busy' ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ShieldCheckIcon className={cn(allowed[w.outside] === 'done' && 'text-success')} />
            )}
            <span className={cn(end && 'hidden xl:inline')}>{allowed[w.outside] === 'done' ? 'Allowed' : 'Always allow'}</span>
          </Button>
        )}
      </div>
    ),
    [allowed, write],
  );
  const columns = useMemo(() => dropColumns(deviceCell, rowActions), [deviceCell, rowActions]);
  const rows = useMemo(() => data?.rows.map((d, i) => ({ d, w: describeDrop(d), key: `${String(d.t)}-${String(i)}` })), [data]);
  return (
    <Card>
      <CardHeading
        icon={ListIcon}
        title="Blocked connections"
        description="Newest first. Kept in memory: a restart starts afresh."
        status={data?.first !== null && data?.first !== undefined ? `Since ${timeText(data.first)}` : undefined}
        action={
          <Button size="icon" variant="ghost" aria-label="Refresh" onClick={refresh}>
            <RefreshCwIcon className={cn(loading && 'animate-spin')} />
          </Button>
        }
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            label="Which"
            value={dir}
            options={[
              { value: 'all', label: 'All' },
              { value: 'out', label: 'From your devices' },
              { value: 'in', label: 'From the internet' },
              { value: 'pre', label: 'Floods' },
            ]}
            onChange={(v) => {
              setDir(v);
              setPage(0);
            }}
          />
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="An address or a port"
              placeholder="An address or a port"
              className="pl-8 font-mono placeholder:font-sans"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        {data !== undefined && data.total > 0 && (
          <div className="grid gap-6 border-y py-4 sm:grid-cols-2 xl:grid-cols-4">
            <Top title="Addresses" rows={data.top.sources} mono />
            <Top title="Your devices" rows={data.top.devices} label={(k) => device(k, '') ?? k} />
            <Top title="What for" rows={data.top.ports} label={portLabel} />
            <Top title="Lists" rows={data.top.sets} label={setName} />
          </div>
        )}
        {/* newest first, a page at a time from the router: sorting one page would mislead */}
        {rows !== undefined && (
          <DataTable
            label="Blocked connections"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.key}
            empty={
              Object.keys(filter).length > 0
                ? 'Nothing matches.'
                : 'Nothing blocked and recorded yet. Turn on what’s recorded above to see each one here.'
            }
            framed={false}
            wide="md"
            card={({ d, w }) => (
              <div className="flex flex-col gap-2 py-3">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{w.direction}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{timeText(d.t)}</span>
                </span>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                  <dt className="text-muted-foreground">For</dt>
                  <dd>{w.service}</dd>
                  <dt className="text-muted-foreground">Address</dt>
                  <dd className="font-mono break-all">{w.outside}</dd>
                  <dt className="text-muted-foreground">Device</dt>
                  <dd className="break-all">{deviceCell(d, w)}</dd>
                  <dt className="text-muted-foreground">List</dt>
                  <dd>{setName(d.set)}</dd>
                </dl>
                <div className="-ml-3">{rowActions(d, w, false)}</div>
              </div>
            )}
          />
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
            <span className="tabular">
              {formatNumber(page * PAGE + 1)}–{formatNumber(Math.min((page + 1) * PAGE, data?.total ?? 0))} of{' '}
              {formatNumber(data?.total ?? 0)}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Newer"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Older"
              disabled={page + 1 >= pages}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}
        {(data?.events.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-sm font-medium">Blocked by the log monitor</h3>
            <p className="text-xs text-muted-foreground">
              Addresses that failed to sign in (SSH, LuCI…) and were added to the blocklist.
            </p>
            <ul className="flex flex-col gap-1 text-xs">
              {data?.events.slice(0, 10).map((e, i) => (
                <li key={`${String(e.t)}-${String(i)}`} className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-muted-foreground tabular">{timeText(e.t)}</span>
                  <button
                    type="button"
                    className="font-mono underline-offset-2 hover:underline"
                    onClick={() => {
                      setLook(e.address.split('-')[0] ?? e.address);
                    }}
                  >
                    {e.address}
                  </button>
                  <span className="text-muted-foreground">
                    {e.kind === 'remote'
                      ? 'reported by another device'
                      : e.kind === 'range'
                        ? 'its whole network, from its registry'
                        : e.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      {look !== undefined && (
        <LookupDialog
          query={look}
          conntrack={conntrack}
          onClose={() => {
            setLook(undefined);
          }}
          onChanged={onChanged}
        />
      )}
    </Card>
  );
}

function SurveyDialog({ set, onClose, onLook }: { set: string; onClose: () => void; onLook: (v: string) => void }): ReactElement {
  const [page, setPage] = useState(0);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(false);
  const [data, setData] = useState<Survey>();
  const [failed, setFailed] = useState<string>();
  const filter = /^[0-9A-Fa-f.:/ -]*$/.test(q) ? q.trim() : '';
  useEffect(() => {
    let live = true;
    survey(set, page * 100, 100, filter, hits).then(
      (r) => {
        if (live) setData(r);
      },
      (err: unknown) => {
        if (live) setFailed(errorMessage(err));
      },
    );
    return () => {
      live = false;
    };
  }, [set, page, filter, hits]);
  const pages = Math.max(1, Math.ceil((data?.matched ?? 0) / 100));
  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{set}</DialogTitle>
          <DialogDescription>
            {data?.total !== undefined ? `${formatNumber(data.total)} entries in the loaded list` : 'Reading the list…'}
            {infoOf(set.split('.')[0] ?? '') !== undefined ? `. ${infoOf(set.split('.')[0] ?? '')?.text ?? ''}` : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <Input
            aria-label="Find in the list"
            placeholder="Find an address"
            className="min-w-0 flex-1 font-mono placeholder:font-sans"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(0);
            }}
          />
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch
              checked={hits}
              onCheckedChange={(v) => {
                setHits(v);
                setPage(0);
              }}
              aria-label="Only those that blocked something"
            />
            Only with hits
          </div>
        </div>
        {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
        <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
          {(data?.elements ?? []).map((e) => (
            <li key={e.value} className="flex items-center justify-between gap-3 px-3 py-1.5">
              <button
                type="button"
                className="font-mono text-xs underline-offset-2 hover:underline"
                onClick={() => {
                  onLook(e.value.split(/[/ -]/)[0] ?? e.value);
                }}
              >
                {e.value}
              </button>
              <span className="text-xs text-muted-foreground tabular">
                {e.packets !== null && e.packets !== undefined && e.packets > 0 ? `${formatNumber(e.packets)} packets` : ''}
                {e.expires !== null && e.expires !== undefined ? ` expires in ${e.expires}` : ''}
              </span>
            </li>
          ))}
          {data !== undefined && (data.elements ?? []).length === 0 && (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches.</li>
          )}
        </ul>
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm text-muted-foreground">
            <span className="tabular">
              Page {page + 1} of {formatNumber(pages)}
            </span>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Previous page"
              disabled={page === 0}
              onClick={() => {
                setPage((p) => p - 1);
              }}
            >
              <ChevronLeftIcon />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Next page"
              disabled={page + 1 >= pages}
              onClick={() => {
                setPage((p) => p + 1);
              }}
            >
              <ChevronRightIcon />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const FLOOD: Record<string, string> = {
  synflood: 'SYN floods',
  udpflood: 'UDP floods',
  icmpflood: 'ICMP floods',
  ctinvalid: 'Out-of-state packets',
  tcpinvalid: 'Odd TCP flags',
  bcp38: 'Spoofed sources (BCP38)',
};

type SetRow = [name: string, x: ReportSet];

/** A count where the list counts that way; a list that doesn't is "–" here and last when sorted. */
const hits = (counts: boolean, n: number | null | undefined): number | undefined => (counts ? (n ?? 0) : undefined);
const count = (n: number | undefined): ReactNode =>
  n === undefined ? <span className="text-muted-foreground">–</span> : formatNumber(n);

/** Each list's columns: its name, entries and hits each way sort (the biggest first), and its Contents button. */
function reportColumns(contents: (name: string) => ReactElement): Column<SetRow>[] {
  return [
    { label: 'List', cell: ([name]) => <span className="font-mono text-xs">{name}</span>, sort: ([name]) => name },
    {
      label: 'Entries',
      cell: ([, x]) => count(x.elements ?? undefined),
      sort: ([, x]) => x.elements ?? undefined,
      sortDescFirst: true,
      sortLabel: 'Most entries first',
      className: 'text-right text-xs tabular',
    },
    {
      label: 'Coming in',
      cell: ([, x]) => count(hits(x.inbound, x.in_packets)),
      sort: ([, x]) => hits(x.inbound, x.in_packets),
      sortDescFirst: true,
      sortLabel: 'Most hits coming in first',
      className: 'text-right text-xs tabular',
    },
    {
      label: 'Going out',
      cell: ([, x]) => count(hits(x.outbound, x.out_packets)),
      sort: ([, x]) => hits(x.outbound, x.out_packets),
      sortDescFirst: true,
      sortLabel: 'Most hits going out first',
      className: 'text-right text-xs tabular',
    },
    { label: 'Ports', cell: ([, x]) => x.ports ?? '', className: 'text-xs' },
    { label: 'Contents', hidden: true, cell: ([name]) => contents(name), className: 'w-24 py-1.5' },
  ];
}

function ReportCard({ c, onLook }: { c: BanipConfig; onLook: (v: string) => void }): ReactElement {
  const [report, setReport] = useState<Report>();
  const [failed, setFailed] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string>();
  const load = (refresh = false): void => {
    setBusy(refresh);
    getReport(refresh).then(
      (r) => {
        setReport(r);
        setBusy(false);
      },
      (err: unknown) => {
        setFailed(errorMessage(err));
        setBusy(false);
      },
    );
  };
  useEffect(() => {
    getReport(false).then(setReport, (err: unknown) => {
      setFailed(errorMessage(err));
    });
  }, []);
  // the lists first, your own allowlist and blocklist after
  const own = (n: string): number => (/^(allowlist|blocklist)\./.test(n) ? 1 : 0);
  const sets = Object.entries(report?.sets ?? {}).sort(([a], [b]) => (own(a) - own(b)) * 1000 + a.localeCompare(b));
  const hitsOf = (x: { in_packets?: number | null | undefined; out_packets?: number | null | undefined }): number =>
    (x.in_packets ?? 0) + (x.out_packets ?? 0);
  const contents = useCallback(
    (name: string): ReactElement => (
      <Button
        size="sm"
        variant="ghost"
        className="h-7 shrink-0"
        onClick={() => {
          setOpen(name);
        }}
      >
        Contents
      </Button>
    ),
    [],
  );
  const columns = useMemo(() => reportColumns(contents), [contents]);
  return (
    <Card>
      <CardHeading
        icon={FileTextIcon}
        title="Each list"
        status={
          report?.counting === false
            ? 'Counting is off (Advanced, Logging): the hits read 0.'
            : report?.generated !== null && report?.generated !== undefined
              ? `Entries as of ${timeText(report.generated)}; hits since each list was last loaded.`
              : 'Hits since each list was last loaded.'
        }
        action={
          <Button
            size="sm"
            variant="outline"
            disabled={busy || c.enabled !== true}
            onClick={() => {
              load(true);
            }}
          >
            {busy ? <LoaderCircleIcon className="animate-spin" /> : <RefreshCwIcon />} Recount
          </Button>
        }
      />
      <CardContent className="flex flex-col gap-4">
        {failed !== undefined && <p className="text-sm text-destructive">{failed}</p>}
        <DataTable
          label="Each list"
          columns={columns}
          rows={sets}
          rowKey={([name]) => name}
          empty="No report yet: it’s made after each update."
          defaultOrder="Lists first, your own last"
          framed={false}
          card={([name, x]) => (
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-mono text-xs break-all">{name}</span>
                <span className="text-xs text-muted-foreground tabular">
                  {x.elements === null || x.elements === undefined ? '–' : formatNumber(x.elements)} entries
                  {x.inbound ? ` · ${formatNumber(x.in_packets ?? 0)} coming in` : ''}
                  {x.outbound ? ` · ${formatNumber(x.out_packets ?? 0)} going out` : ''}
                  {x.ports !== null && x.ports !== undefined && x.ports !== '' ? ` · ports ${x.ports}` : ''}
                </span>
              </span>
              {contents(name)}
            </div>
          )}
        />
        {sets.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Most hits:{' '}
            {sets
              .filter(([, x]) => hitsOf(x) > 0)
              .sort(([, a], [, b]) => hitsOf(b) - hitsOf(a))
              .slice(0, 3)
              .map(([n, x]) => `${n} (${formatNumber(hitsOf(x))})`)
              .join(', ')
              .replace(/^$/, 'none yet')}
            .
          </p>
        )}
        {report?.flood !== null && report?.flood !== undefined && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <h3 className="text-sm font-medium">Before the lists</h3>
            <p className="text-xs text-muted-foreground">What banIP drops from the internet before looking anything up.</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(FLOOD).map(([k, label]) => (
                <Badge key={k} variant={(report.flood?.[k] ?? 0) > 0 ? 'warning' : 'secondary'} className="font-normal">
                  {label}: <span className="tabular">{formatNumber(report.flood?.[k] ?? 0)}</span>
                </Badge>
              ))}
            </div>
            {report.autoadd !== null && report.autoadd !== undefined && (
              <p className="text-xs text-muted-foreground">
                Added today by banIP itself: {formatNumber(report.autoadd.allow)} to the allowlist,{' '}
                {formatNumber(report.autoadd.block)} to the blocklist.
              </p>
            )}
          </div>
        )}
      </CardContent>
      {open !== undefined && (
        <SurveyDialog
          set={open}
          onClose={() => {
            setOpen(undefined);
          }}
          onLook={(v) => {
            setOpen(undefined);
            onLook(v);
          }}
        />
      )}
    </Card>
  );
}

function ProcessingLog(): ReactElement {
  const [open, setOpen] = useState(false);
  // read only while it's open
  const { data, refresh } = useLive({ ...banipQueries.processingLog(), enabled: open });
  const lines = (open ? (data?.lines ?? []) : []).map((l) => ({ raw: l, p: parseLogLine(l) })).reverse();
  return (
    <Card>
      <CardHeading
        icon={FileTextIcon}
        title="banIP’s log"
        description="What banIP says about each update, newest first. All of it is on the Logs page too."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setOpen((o) => !o);
              if (!open) refresh();
            }}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        }
      />
      {open && (
        <CardContent>
          <ol className="max-h-96 overflow-y-auto rounded-md border bg-muted/30 px-3 py-2 font-mono text-xs leading-5">
            {lines.map(({ raw, p }, i) => (
              <li
                key={i}
                className={cn(
                  p?.level === 'err' || p?.level === 'emerg'
                    ? 'text-destructive'
                    : p?.level === 'debug'
                      ? 'text-muted-foreground'
                      : '',
                )}
              >
                {p === null ? raw : `${p.time.slice(4, 19)}  ${p.message}`}
              </li>
            ))}
            {lines.length === 0 && <li className="font-sans text-muted-foreground">Nothing in the log yet.</li>}
          </ol>
        </CardContent>
      )}
    </Card>
  );
}

export function ActivityTab({
  c,
  s,
  onSaved,
}: {
  c: BanipConfig;
  s: BanipStatus | undefined;
  onSaved: () => void;
}): ReactElement {
  const [look, setLook] = useState<string>();
  return (
    <div className="flex flex-col gap-4">
      <Recording c={c} s={s} />
      <DropLog c={c} onChanged={onSaved} />
      <ReportCard c={c} onLook={setLook} />
      <ProcessingLog />
      {look !== undefined && (
        <LookupDialog
          query={look}
          conntrack={c.tools?.conntrack === true}
          onClose={() => {
            setLook(undefined);
          }}
          onChanged={onSaved}
        />
      )}
    </div>
  );
}
