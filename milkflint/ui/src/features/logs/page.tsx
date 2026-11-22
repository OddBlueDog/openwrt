// The Logs page: one log at a time under its tab, newest at the bottom and
// followed live every 5 s, with a filter, the number of lines and a
// download; then what gets logged. The switches that change how the router
// runs (debug counters and snapshot, the memory error checker) are on
// Performance tuning, under Diagnostics.
import {
  BugOffIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  SatelliteDishIcon,
  SearchIcon,
  ServerOffIcon,
  ShieldCheckIcon,
  ShieldOffIcon,
  WifiOffIcon,
} from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Note } from '@/components/note';
import { PageHeader } from '@/components/layout/page-header';
import { LoadError } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import { usePoll } from '@/hooks/use-poll';
import { formatBytes } from '@/lib/format';
import { href, tabFrom, tabHref, useSubPath } from '@/lib/router';
import { cn } from '@/lib/utils';
import { getLogStatus, type LogKind, type LogStatus, readLog } from './api';
import { LogSettingsCard } from './settings';

const kinds: { id: LogKind; label: string; title: string }[] = [
  { id: 'system', label: 'System', title: 'System log' },
  { id: 'kernel', label: 'Kernel', title: 'Kernel log' },
  { id: 'wifi', label: 'Wi-Fi', title: 'Wi-Fi log' },
  { id: 'radar', label: 'Radar', title: 'Radar log' },
  { id: 'debug', label: 'Debug', title: 'Debug log' },
  { id: 'dns', label: 'DNS', title: 'DNS log' },
  { id: 'banip', label: 'banIP', title: 'banIP log' },
  { id: 'crash', label: 'Crashes', title: 'Crash reports' },
];

const placeholders: Record<LogKind, string> = {
  system: 'Filter, e.g. hostapd or error',
  kernel: 'Filter, e.g. hostapd or error',
  wifi: 'Filter, e.g. a device name or NO TX',
  radar: 'Filter, e.g. RADAR-DETECTED or CAC',
  debug: 'Filter, e.g. snapshot, cake or RESTART',
  dns: 'Filter, e.g. slow, a device or a site',
  banip: 'Filter, e.g. failed, a list or err',
  crash: 'Filter, e.g. Oops, KFENCE or mt7915',
};

const DIAGNOSTICS = `${href('tuning')}/diagnostics`;

function severity(line: string): 'error' | 'warning' | undefined {
  if (/\.(err|crit|alert|emerg)\b|\berror\b|\bfailed\b|BUG:|Oops|Kernel panic/i.test(line)) return 'error';
  if (/\.warn\b|\bwarning\b|WARNING:|RADAR-DETECTED/i.test(line)) return 'warning';
  return undefined;
}

function debugOn(status: LogStatus | undefined): boolean {
  return status?.counters === true || status?.snapshot === true;
}

// where the log shown comes from, for the line above it
function source(kind: LogKind, status: LogStatus | undefined): string {
  if (status === undefined) return '';
  if (kind === 'wifi' && !status.wifi) return 'off';
  if (kind === 'debug' && !debugOn(status)) return 'off';
  if (kind === 'dns' && status.dns !== true) return 'off';
  if (kind === 'radar') {
    if (status.radar === false) return 'off';
    const bytes = status.radar_bytes ?? null;
    return `kept across restarts${bytes === null ? '' : `, ${formatBytes(bytes)} saved`}`;
  }
  if (kind === 'banip')
    return `banIP’s runs${status.persist ? ', kept across restarts' : ', since the last restart'}; what it blocked is on the banIP page`;
  if (kind === 'crash') {
    if (status.kfence_active === false) return 'crashes kept until the router loses power; the memory error checker is off';
    return `crashes kept until the router loses power, memory errors ${status.persist ? 'with the saved logs' : 'since the last restart'}`;
  }
  const bytes =
    kind === 'wifi'
      ? status.wifi_bytes
      : kind === 'debug'
        ? (status.debug_bytes ?? null)
        : kind === 'dns'
          ? (status.dns_bytes ?? null)
          : status.system_bytes;
  if (status.persist) return `kept across restarts${bytes === null ? '' : `, ${formatBytes(bytes)} saved`}`;
  return 'since the last restart';
}

function Link({ to, children }: { to: string; children: ReactNode }): ReactElement {
  return (
    <a href={to} className="font-medium link">
      {children}
    </a>
  );
}

/** Why the log shown is quiet, and where to turn it on. */
function OffNote({ kind, status, empty }: { kind: LogKind; status: LogStatus | undefined; empty: boolean }): ReactElement | null {
  if (kind === 'wifi' && status?.wifi === false) {
    return (
      <Note tone="info" icon={<WifiOffIcon />} title="The Wi-Fi log is off">
        Turn it on under What gets logged, below. Older lines from when it was on are still shown.
      </Note>
    );
  }
  if (kind === 'radar' && status?.radar === false) {
    return (
      <Note tone="info" icon={<SatelliteDishIcon />} title="The radar log is off">
        Turn it on under What gets logged, below. Older lines from when it was on are still shown.
      </Note>
    );
  }
  if (kind === 'debug' && status !== undefined && !debugOn(status)) {
    return (
      <Note tone="info" icon={<BugOffIcon />} title="The debug log is off">
        Turn on its counters or its snapshot on <Link to={DIAGNOSTICS}>Performance tuning, under Diagnostics</Link>, while chasing
        a dropout. Older lines from when it was on are still shown.
      </Note>
    );
  }
  if (kind === 'dns' && status !== undefined && status.dns !== true) {
    return (
      <Note tone="info" icon={<ServerOffIcon />} title="The DNS log is off">
        Turn it on under What gets logged, below, while chasing slow pages or apps. Older lines from when it was on are still
        shown.
      </Note>
    );
  }
  if (kind === 'crash') {
    return (
      <div className="flex flex-col gap-3">
        {empty && (
          <Note tone="success" icon={<ShieldCheckIcon />} title="No crash reports">
            If the kernel crashes, its last lines are kept through the restart that follows and show here, until the router loses
            power. So do the memory errors its checker (KFENCE) catches while it keeps running, when that’s on.
          </Note>
        )}
        {status?.kfence_active === false && (
          <Note tone="info" icon={<ShieldOffIcon />} title="The memory error checker is off">
            Turn it on on <Link to={DIAGNOSTICS}>Performance tuning, under Diagnostics</Link>, while chasing a crash: the kernel
            then reports memory it misuses here, with the code that did it. Crashes are kept either way.
          </Note>
        )}
      </div>
    );
  }
  return null;
}

export function LogsPage(): ReactElement {
  // the log shown is in the address (#/logs/radar), so a link or the menu's search opens its tab
  const kind = tabFrom(useSubPath(), kinds, 'system');
  const setKind = (k: LogKind): void => {
    window.location.hash = tabHref('logs', k, 'system');
  };
  const [lines, setLines] = useState('500');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);

  const { data, error, refresh } = usePoll(() => readLog(kind, Number(lines)), follow ? 5000 : 3_600_000, `${kind}:${lines}`);
  const { data: status, refresh: refreshStatus } = usePoll(getLogStatus, 15_000);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.lines ?? []).filter((l) => q === '' || l.toLowerCase().includes(q));
  }, [data, query]);

  useEffect(() => {
    if (follow && box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([`${(data?.lines ?? []).join('\n')}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-log-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const where = source(kind, status);
  const reports = (status?.crash_reports ?? 0) + (status?.memory_reports ?? 0);
  const onApplied = useCallback(() => {
    refreshStatus();
    refresh();
  }, [refreshStatus, refresh]);
  const title = kinds.find((k) => k.id === kind)?.title ?? 'Log';

  return (
    <>
      <PageHeader title="Logs" description="What the router has logged, newest at the bottom, followed live." />
      <div className="flex flex-col gap-4">
        <Card className="gap-0 pt-4 pb-5">
          <div className="px-5">
            <Tabs
              label="Log"
              prefix="logs"
              value={kind}
              onChange={setKind}
              items={kinds.map((k) => ({
                id: k.id,
                label:
                  k.id === 'crash' && reports > 0 ? (
                    <span className="inline-flex items-center gap-1.5">
                      {k.label}
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive-subtle px-1.5 text-xs font-medium text-destructive tabular">
                        {String(reports)}
                        <span className="sr-only"> reports</span>
                      </span>
                    </span>
                  ) : (
                    k.label
                  ),
              }))}
            />
          </div>
          <TabPanel prefix="logs" id={kind} value={kind}>
            <CardContent className="flex flex-col gap-4 pt-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-base font-semibold">{title}</h2>
                <p className="text-sm text-muted-foreground tabular">
                  {data === undefined
                    ? 'Loading…'
                    : `${String(shown.length)} of ${String(data.lines.length)} lines${data.truncated === true ? ', the newest that fit in one reply' : ''}${where === '' ? '' : `, ${where}`}`}
                </p>
              </div>
              <OffNote kind={kind} status={status} empty={data?.lines.length === 0} />
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1 basis-56">
                  <SearchIcon
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden
                  />
                  <Input
                    aria-label="Filter lines"
                    placeholder={placeholders[kind]}
                    className="pl-9"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </div>
                <Select value={lines} onValueChange={setLines}>
                  <SelectTrigger className="w-40" aria-label="Lines">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['200', '500', '2000', '5000'].map((n) => (
                      <SelectItem key={n} value={n}>
                        Last {n} lines
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  aria-pressed={!follow}
                  onClick={() => {
                    setFollow((f) => !f);
                  }}
                >
                  {follow ? <PauseIcon /> : <PlayIcon />}
                  {follow ? 'Pause' : 'Follow'}
                </Button>
                <Button variant="outline" onClick={download} disabled={data === undefined}>
                  <DownloadIcon /> Download
                </Button>
              </div>
              {error !== undefined && data === undefined ? (
                <LoadError error={error} retry={refresh} />
              ) : (
                <pre
                  ref={box}
                  aria-label={`${title}, ${String(shown.length)} lines`}
                  className="h-[60vh] overflow-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed"
                >
                  {shown.map((l, i) => {
                    const s = severity(l);
                    return (
                      <div
                        key={i}
                        className={cn(
                          'whitespace-pre-wrap',
                          s === 'error' && 'text-destructive',
                          s === 'warning' && 'text-warning',
                        )}
                      >
                        {l}
                      </div>
                    );
                  })}
                  {data !== undefined && shown.length === 0 && (
                    <div className="text-muted-foreground">
                      {data.lines.length === 0 ? 'Nothing logged yet.' : 'No lines match the filter.'}
                    </div>
                  )}
                </pre>
              )}
            </CardContent>
          </TabPanel>
        </Card>
        <LogSettingsCard onApplied={onApplied} />
      </div>
    </>
  );
}
