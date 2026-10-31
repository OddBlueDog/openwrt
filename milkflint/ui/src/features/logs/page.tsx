import {
  BugOffIcon,
  DownloadIcon,
  PauseIcon,
  PlayIcon,
  SatelliteDishIcon,
  ScrollTextIcon,
  SearchIcon,
  ServerOffIcon,
  SettingsIcon,
  ShieldCheckIcon,
  WifiOffIcon,
} from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { formatBytes } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getLogSettings, getLogStatus, type LogKind, type LogSettings, type LogStatus, logSettingsChanges, readLog } from './api';

const kinds: { id: LogKind; label: string; title: string }[] = [
  { id: 'system', label: 'System', title: 'System log' },
  { id: 'kernel', label: 'Kernel', title: 'Kernel log' },
  { id: 'wifi', label: 'Wi-Fi', title: 'Wi-Fi log' },
  { id: 'radar', label: 'Radar', title: 'Radar log' },
  { id: 'debug', label: 'Debug', title: 'Debug log' },
  { id: 'dns', label: 'DNS', title: 'DNS log' },
  { id: 'crash', label: 'Crashes', title: 'Crash reports' },
];

const placeholders: Record<LogKind, string> = {
  system: 'Filter, e.g. hostapd or error',
  kernel: 'Filter, e.g. hostapd or error',
  wifi: 'Filter, e.g. a device name or NO TX',
  radar: 'Filter, e.g. RADAR-DETECTED or CAC',
  debug: 'Filter, e.g. snapshot, cake or RESTART',
  dns: 'Filter, e.g. slow, a device or a site',
  crash: 'Filter, e.g. Oops, panic or mt7915',
};

function severity(line: string): 'error' | 'warning' | undefined {
  if (/\.(err|crit|alert|emerg)\b|\berror\b|\bfailed\b|BUG:|Oops|Kernel panic/i.test(line)) return 'error';
  if (/\.warn\b|\bwarning\b|WARNING:|RADAR-DETECTED/i.test(line)) return 'warning';
  return undefined;
}

function debugOn(status: LogStatus | undefined): boolean {
  return status?.counters === true || status?.snapshot === true;
}

// where the log shown comes from, for the card's description
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
  if (kind === 'crash') return 'kept until the router loses power';
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

export function LogsPage(): ReactElement {
  const [kind, setKind] = useState<LogKind>('system');
  const [lines, setLines] = useState('500');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const box = useRef<HTMLPreElement>(null);

  const { data, error, refresh } = usePoll(() => readLog(kind, Number(lines)), follow ? 5000 : 3_600_000, `${kind}:${lines}`);
  const { data: status, refresh: refreshStatus } = usePoll(getLogStatus, 15_000);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data ?? []).filter((l) => q === '' || l.toLowerCase().includes(q));
  }, [data, query]);

  useEffect(() => {
    if (follow && box.current !== null) box.current.scrollTop = box.current.scrollHeight;
  }, [shown, follow]);

  const download = (): void => {
    const url = URL.createObjectURL(new Blob([`${(data ?? []).join('\n')}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${kind}-log-${new Date().toISOString().slice(0, 19).replaceAll(':', '')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const where = source(kind, status);
  const onApplied = useCallback(() => {
    refreshStatus();
    refresh();
  }, [refreshStatus, refresh]);

  return (
    <>
      <PageHeader title="Logs" description="The system, kernel, Wi-Fi, radar, debug and DNS logs, and the kernel's crash reports, newest at the bottom." />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <Card>
          <CardHeading
            icon={ScrollTextIcon}
            title={kinds.find((k) => k.id === kind)?.title ?? 'Log'}
            description={data === undefined ? 'Loading…' : `${String(shown.length)} of ${String(data.length)} lines${where === '' ? '' : `, ${where}`}`}
          />
          <CardContent className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Log" className="grid grid-cols-4 self-start rounded-md border bg-muted/50 p-0.5 text-xs sm:flex">
              {kinds.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  role="radio"
                  aria-checked={kind === k.id}
                  onClick={() => {
                    setKind(k.id);
                  }}
                  className={cn('rounded-sm px-2.5 py-1 whitespace-nowrap text-muted-foreground', kind === k.id && 'bg-card text-foreground shadow-xs')}
                >
                  {k.label}
                  {k.id === 'crash' && (status?.crash_reports ?? 0) > 0 && (
                    <span className="ml-1 tabular text-destructive">{String(status?.crash_reports)}</span>
                  )}
                </button>
              ))}
            </div>
            {kind === 'wifi' && status?.wifi === false && (
              <Alert variant="info">
                <WifiOffIcon />
                <AlertTitle>The Wi-Fi log is off</AlertTitle>
                <AlertDescription>Turn it on in the settings below. Older lines from when it was on are still shown.</AlertDescription>
              </Alert>
            )}
            {kind === 'radar' && status?.radar === false && (
              <Alert variant="info">
                <SatelliteDishIcon />
                <AlertTitle>The radar log is off</AlertTitle>
                <AlertDescription>Turn it on in the settings below. Older lines from when it was on are still shown.</AlertDescription>
              </Alert>
            )}
            {kind === 'crash' && data?.length === 0 && (
              <Alert variant="success">
                <ShieldCheckIcon />
                <AlertTitle>No crash reports</AlertTitle>
                <AlertDescription>
                  If the kernel crashes, its last lines are kept through the restart that follows and show here, until the router loses power.
                </AlertDescription>
              </Alert>
            )}
            {kind === 'debug' && status !== undefined && !debugOn(status) && (
              <Alert variant="info">
                <BugOffIcon />
                <AlertTitle>The debug log is off</AlertTitle>
                <AlertDescription>
                  Turn on the debug counters or the snapshot in the settings below while chasing a dropout. Older lines from when it was on are still shown.
                </AlertDescription>
              </Alert>
            )}
            {kind === 'dns' && status !== undefined && status.dns !== true && (
              <Alert variant="info">
                <ServerOffIcon />
                <AlertTitle>The DNS log is off</AlertTitle>
                <AlertDescription>
                  Turn it on in the settings below while chasing slow pages or apps. Older lines from when it was on are still shown.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-56 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
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
                <SelectTrigger className="w-36" aria-label="Lines">
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
                className="h-[60vh] overflow-auto rounded-lg border bg-background p-3 font-mono text-[11.5px] leading-relaxed"
              >
                {shown.map((l, i) => {
                  const s = severity(l);
                  return (
                    <div key={i} className={cn('whitespace-pre-wrap', s === 'error' && 'text-destructive', s === 'warning' && 'text-warning')}>
                      {l}
                    </div>
                  );
                })}
                {data !== undefined && shown.length === 0 && (
                  <div className="text-muted-foreground">{data.length === 0 ? 'Nothing logged yet.' : 'No lines match.'}</div>
                )}
              </pre>
            )}
          </CardContent>
        </Card>
        <SettingsCard onApplied={onApplied} />
      </div>
    </>
  );
}

// the settings card's rows on wide screens, where it's a side column: the
// label above its control
const side = 'xl:grid-cols-1 xl:gap-2';

const sizes = ['1', '3', '10'];
const intervals = ['5', '10', '30', '60'];

// what the Wi-Fi log adds to its device lines, each with its own switch
const wifiParts: { key: 'channel' | 'mu' | 'rrm' | 'net'; title: string; hint: string }[] = [
  {
    key: 'channel',
    title: 'Channel use',
    hint: 'How busy each channel was, and with what: our traffic, our devices, other networks, interference. Asks the Wi-Fi chip each sample.',
  },
  {
    key: 'mu',
    title: 'MU/OFDMA counters',
    hint: 'Once a minute, how much went out to several devices at once (OFDMA, MU-MIMO) and beamformed. Turns on the driver\'s statistics for it, which ask the Wi-Fi chip twice a second.',
  },
  {
    key: 'rrm',
    title: 'Ask devices how they hear the router',
    hint: 'A device having a hard time is asked how it hears the router (802.11k), at most once a minute, others every 10 minutes: one small frame each.',
  },
  {
    key: 'net',
    title: 'Network Quality',
    hint: "The Network Quality probe's response times (gateway, internet, DNS) each sample, beside the Wi-Fi lines of the same moment.",
  },
];

function Part({
  id,
  title,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  title: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <div className={cn('flex items-start gap-3 text-sm', disabled && 'opacity-60')}>
      <Switch id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <label htmlFor={id} className="flex flex-col gap-0.5">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </label>
    </div>
  );
}

function SettingsCard({ onApplied }: { onApplied: () => void }): ReactElement | null {
  const { data, error, loading, reload } = useLoad(getLogSettings);
  const [edit, setEdit] = useState<LogSettings>();
  const applied = useCallback(() => {
    setEdit(undefined);
    reload();
    onApplied();
  }, [reload, onApplied]);
  const { state, apply } = useApply(applied);
  const form = edit ?? data;
  const set = <K extends keyof LogSettings>(key: K, value: LogSettings[K]): void => {
    setEdit((current) => {
      const base = current ?? data;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data);

  if (error !== undefined && data === undefined) return <LoadError error={error} retry={reload} />;
  if (loading || form === undefined) return null;
  return (
    <div className="flex flex-col gap-4">
      <ApplyStatus state={state} />
      <Card>
        <CardHeading icon={SettingsIcon} title="Settings" description="Where the logs are kept, and what each one records." />
        <CardContent className="divide-y">
          <Field
            className={side}
            id="logs-persist"
            label="Keep after a restart"
            hint="Saves the system log, the kernel's lines included, the Wi-Fi, debug and DNS logs on the router's storage (/root/milkflint-logs). Otherwise they're only in memory, and a restart or crash clears them."
          >
            <Switch
              id="logs-persist"
              className="mt-2 xl:mt-0"
              checked={form.persist}
              onCheckedChange={(v) => {
                set('persist', v);
              }}
            />
          </Field>
          <Field className={side} id="logs-size" label="Size per log" hint="When a log reaches this, its older half is deleted.">
            <Select
              value={form.size}
              onValueChange={(v) => {
                set('size', v);
              }}
            >
              <SelectTrigger id="logs-size">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sizes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s} MB
                  </SelectItem>
                ))}
                {!sizes.includes(form.size) && <SelectItem value={form.size}>{form.size} MB</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          <Field
            className={side}
            id="logs-wifi"
            label="Wi-Fi log"
            hint="Wi-Fi events from the system log, and a line for each connected device: signal, packets, retries, failures, speeds and queued airtime. NO TX marks a device that sent to the router but got nothing back."
          >
            <Switch
              id="logs-wifi"
              className="mt-2 xl:mt-0"
              checked={form.wifi}
              onCheckedChange={(v) => {
                set('wifi', v);
              }}
            />
            <div className="mt-2 flex flex-col gap-3 border-l pl-4">
              {wifiParts.map((p) => (
                <Part
                  key={p.key}
                  id={`logs-${p.key}`}
                  title={p.title}
                  hint={p.hint}
                  checked={form[p.key]}
                  disabled={!form.wifi}
                  onChange={(v) => {
                    set(p.key, v);
                  }}
                />
              ))}
            </div>
          </Field>
          <Field
            className={side}
            id="logs-interval"
            label="Sample every"
            hint="The Wi-Fi log's devices (idle ones once a minute) and the debug counters."
          >
            <Select
              value={form.interval}
              disabled={!form.wifi && !form.counters && !form.snapshot}
              onValueChange={(v) => {
                set('interval', v);
              }}
            >
              <SelectTrigger id="logs-interval">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {intervals.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s} seconds
                  </SelectItem>
                ))}
                {!intervals.includes(form.interval) && <SelectItem value={form.interval}>{form.interval} seconds</SelectItem>}
              </SelectContent>
            </Select>
          </Field>
          <Field
            className={side}
            id="logs-radar"
            label="Radar log"
            hint="The 5 GHz radar checks, radar heard and the moves after it, always on the router's storage (/root/milkflint-wifi, 64 KB). Radios & SSIDs shows them too."
          >
            <Switch
              id="logs-radar"
              className="mt-2 xl:mt-0"
              checked={form.radar}
              onCheckedChange={(v) => {
                set('radar', v);
              }}
            />
          </Field>
          <Field
            className={side}
            id="logs-counters"
            label="Debug counters"
            hint="For chasing a dropout: every interval, the load and packets at each hop (CPU, CAKE, eth1, Wi-Fi), and once a minute memory, the WAN and service restarts, in the debug log."
          >
            <Switch
              id="logs-counters"
              className="mt-2 xl:mt-0"
              checked={form.counters}
              onCheckedChange={(v) => {
                set('counters', v);
              }}
            />
          </Field>
          <Field
            className={side}
            id="logs-snapshot"
            label="Snapshot on trouble"
            hint="When Network Quality loses the internet or DNS, or a device gets NO TX: every queue, CPU, the Wi-Fi hardware queues and the last kernel lines at once, in the debug log (at most once a minute)."
          >
            <Switch
              id="logs-snapshot"
              className="mt-2 xl:mt-0"
              checked={form.snapshot}
              onCheckedChange={(v) => {
                set('snapshot', v);
              }}
            />
          </Field>
          <Field
            className={side}
            id="logs-dns"
            label="DNS log"
            hint="For chasing slow pages or apps: each lookup that takes over 500 ms, fails or gets no answer, with the site and the device, a summary every minute, and the DNS services' errors. To time them, the router notes every lookup in memory for a moment and keeps only the slow ones. Turning it on or off restarts the DNS service: a second without lookups."
          >
            <Switch
              id="logs-dns"
              className="mt-2 xl:mt-0"
              checked={form.dns}
              onCheckedChange={(v) => {
                set('dns', v);
              }}
            />
          </Field>
        </CardContent>
      </Card>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={false}
        onSave={() => {
          if (data !== undefined) void apply(logSettingsChanges(form, data));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </div>
  );
}
