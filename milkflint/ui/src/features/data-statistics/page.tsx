import { ArrowDownIcon, ArrowUpIcon, ChartColumnIcon, SettingsIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { bool, type Change, getConfig, type Section, str } from '@/lib/api/uci';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import { getPeriods, getUsage, loadNames, loadRouterIps, periodStart, type UsageRow } from './api';

type View = 'devices' | 'apps';

function periodLabel(start: string, index: number): string {
  return index === 0 ? `Current period (since ${periodStart(start)})` : `Since ${periodStart(start)}`;
}

function UsageTable({ rows, view, names }: { rows: UsageRow[]; view: View; names: Map<string, string> }): ReactElement {
  const top = Math.max(1, ...rows.map((r) => r.rx + r.tx));
  if (rows.length === 0) return <p className="px-5 pb-5 text-sm text-muted-foreground">No traffic counted yet in this period.</p>;
  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{view === 'devices' ? 'Device' : 'Application'}</TableHead>
          <TableHead className="text-right">Download</TableHead>
          <TableHead className="text-right">Upload</TableHead>
          <TableHead className="w-1/3">Share</TableHead>
          <TableHead className="text-right">Connections</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.slice(0, 50).map((r) => (
          <TableRow key={r.key}>
            <TableCell>
              {view === 'devices' ? (
                <>
                  <div className="font-medium">{names.get(r.key.toLowerCase()) ?? 'Unnamed device'}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">{r.ip ?? r.key}</div>
                </>
              ) : (
                <span className="font-medium">{r.key === 'other' || r.key === '' ? 'Other' : r.key}</span>
              )}
            </TableCell>
            <TableCell className="text-right tabular">{formatBytes(r.rx)}</TableCell>
            <TableCell className="text-right tabular">{formatBytes(r.tx)}</TableCell>
            <TableCell>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                <div className="bg-chart-2" style={{ width: `${String((r.rx / top) * 100)}%` }} />
                <div className="bg-chart-1" style={{ width: `${String((r.tx / top) * 100)}%` }} />
              </div>
            </TableCell>
            <TableCell className="text-right text-muted-foreground tabular">{formatNumber(r.conns)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

interface Form {
  enabled: boolean;
  day: string;
}

interface Settings extends Form {
  /** milkflint.datastats, the on/off: missing on routers from before it */
  toggle: boolean;
  /** nlbwmon's own section, with the accounting period */
  section: string | undefined;
}

async function loadSettings(): Promise<Settings> {
  const [nlbwmon, milkflint] = await Promise.all([
    getConfig('nlbwmon').catch((): Section[] => []),
    getConfig('milkflint').catch((): Section[] => []),
  ]);
  const s = nlbwmon.find((x) => x['.type'] === 'nlbwmon');
  const ds = milkflint.find((x) => x['.name'] === 'datastats');
  const interval = str(s, 'database_interval') ?? '1';
  return {
    toggle: ds !== undefined,
    enabled: bool(ds, 'enabled', true),
    section: s?.['.name'],
    day: /^\d+$/.test(interval) ? interval : 'custom',
  };
}

function toChanges(f: Form, data: Settings): Change[] {
  const changes: Change[] = [];
  if (f.enabled !== data.enabled) {
    changes.push({ op: 'set', config: 'milkflint', section: 'datastats', values: { enabled: f.enabled ? '1' : '0' } });
  }
  if (f.day !== data.day && data.section !== undefined) {
    changes.push({ op: 'set', config: 'nlbwmon', section: data.section, values: { database_interval: f.day } });
  }
  return changes;
}

export function DataStatisticsPage(): ReactElement {
  const periods = usePoll(getPeriods, 300_000);
  const names = usePoll(loadNames, 60_000).data ?? new Map<string, string>();
  const routerIps = usePoll(loadRouterIps, 300_000).data;
  const [period, setPeriod] = useState('');
  const [view, setView] = useState<View>('devices');
  const usage = usePoll(() => getUsage(period, view === 'devices' ? 'mac' : 'layer7'), 30_000, `${period}/${view}`);
  const settings = useLoad(loadSettings);
  const [edit, setEdit] = useState<Form>();
  const { reload } = settings;
  const { refresh: refreshPeriods } = periods;
  const { refresh: refreshUsage } = usage;
  // turned on or off: what's counted changes too
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
    refreshPeriods();
    refreshUsage();
  }, [reload, refreshPeriods, refreshUsage]);
  const { state, apply } = useApply(onApplied);
  const saved = settings.data;
  const form = edit ?? saved;
  const set = <K extends keyof Form>(key: K, value: Form[K]): void => {
    setEdit((current) => {
      const base = current ?? saved;
      return base === undefined ? undefined : { enabled: base.enabled, day: base.day, [key]: value };
    });
  };
  const dirty = edit !== undefined && saved !== undefined && (edit.enabled !== saved.enabled || edit.day !== saved.day);

  const rows = (usage.data ?? []).filter((r) => view === 'apps' || r.ip === undefined || routerIps?.has(r.ip) !== true);
  const totalRx = rows.reduce((n, r) => n + r.rx, 0);
  const totalTx = rows.reduce((n, r) => n + r.tx, 0);
  const list = periods.data?.periods ?? [];

  return (
    <>
      <PageHeader
        title="Data Statistics"
        description="How much each device downloads and uploads, and on what."
        actions={
          saved?.toggle === true &&
          form !== undefined &&
          periods.data?.installed !== false && (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">{form.enabled ? 'On' : 'Off'}</span>
              <Switch
                checked={form.enabled}
                onCheckedChange={(v) => {
                  set('enabled', v);
                }}
                aria-label="Data Statistics on"
              />
            </label>
          )
        }
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {periods.data?.installed === false ? (
          <Alert variant="warning">
            <AlertTitle>Not available</AlertTitle>
            <AlertDescription>The nlbwmon package isn&apos;t in this firmware.</AlertDescription>
          </Alert>
        ) : periods.data?.enabled === false ? (
          <Alert variant="info">
            <ChartColumnIcon />
            <AlertTitle>Data Statistics is off</AlertTitle>
            <AlertDescription>
              Turn it on to count how much each device downloads and uploads. While it&apos;s off nothing is counted; the
              counts from before are kept.
            </AlertDescription>
          </Alert>
        ) : usage.error !== undefined && usage.data === undefined ? (
          <LoadError error={usage.error} retry={usage.refresh} />
        ) : usage.data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { label: 'Downloaded', value: totalRx, icon: ArrowDownIcon, color: 'text-chart-2' },
                { label: 'Uploaded', value: totalTx, icon: ArrowUpIcon, color: 'text-chart-1' },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="flex items-center gap-4">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-secondary">
                      <Icon className={cn('size-5', color)} />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className="text-2xl font-semibold tracking-tight tabular">{formatBytes(value)}</div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
            <Card className="pb-0">
              <CardHeading
                icon={ChartColumnIcon}
                title={view === 'devices' ? 'By device' : 'By application'}
                description="Counted from the router's connection tracking; updates every 30 s."
                action={
                  <>
                    {list.length > 1 && (
                      <Select
                        value={period === '' ? (list[0] ?? '') : period}
                        onValueChange={(v) => {
                          setPeriod(v === list[0] ? '' : v);
                        }}
                      >
                        <SelectTrigger className="w-64" aria-label="Period">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {list.map((p, i) => (
                            <SelectItem key={p} value={p}>
                              {periodLabel(p, i)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div role="radiogroup" aria-label="Group by" className="flex rounded-md border bg-muted/50 p-0.5 text-xs">
                      {(['devices', 'apps'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          role="radio"
                          aria-checked={view === v}
                          onClick={() => {
                            setView(v);
                          }}
                          className={cn('rounded-sm px-2.5 py-1 text-muted-foreground', view === v && 'bg-card text-foreground shadow-xs')}
                        >
                          {v === 'devices' ? 'Devices' : 'Apps'}
                        </button>
                      ))}
                    </div>
                  </>
                }
              />
              <CardContent className="px-0">
                <UsageTable rows={rows} view={view} names={names} />
              </CardContent>
            </Card>
          </>
        )}
        {saved?.section !== undefined && form !== undefined && periods.data?.installed !== false && (
          <Card>
            <CardHeading icon={SettingsIcon} title="Accounting period" />
            <CardContent>
              <Field id="ds-day" label="Start counting again on" hint="The day of the month your plan's allowance resets. Changing it starts a fresh count.">
                <Select
                  value={form.day}
                  onValueChange={(v) => {
                    set('day', v);
                  }}
                >
                  <SelectTrigger id="ds-day">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {Array.from({ length: 28 }, (_, i) => String(i + 1)).map((d) => (
                      <SelectItem key={d} value={d}>
                        Day {d} of each month
                      </SelectItem>
                    ))}
                    {saved.day === 'custom' && <SelectItem value="custom">Custom (set in LuCI)</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
            </CardContent>
          </Card>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={false}
        onSave={() => {
          if (edit !== undefined && saved !== undefined) void apply(toChanges(edit, saved));
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
