// Data usage: nlbwmon's count of what each device (or application) has
// downloaded and uploaded this accounting period. It opens on the totals and
// the period, then the devices, busiest first: a table on a wide screen, a
// card each on a phone. #/data-statistics/<mac> shows one device (All
// devices links here). Counting can be turned off; while it's off the page
// says so and how to turn it on.
import { ArrowDownIcon, ArrowUpIcon, ChartColumnIcon, PackageXIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { bool, type Change, getConfig, type Section, str } from '@/lib/api/uci';
import { formatBytes, formatNumber } from '@/lib/format';
import { href, useSubPath } from '@/lib/router';
import { Segmented } from '../firewall/parts';
import { HeadRow } from '../firewall/table-parts';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { explain } from '@/components/explain';
import { deviceLabel, UNNAMED_DEVICE } from '../clients/model';
import { getPeriods, getUsage, loadNames, loadRouterIps, periodStart, type UsageRow } from './api';
import { macFromPath, shownRows, totals, type View } from './model';

function periodLabel(start: string, index: number): string {
  return index === 0 ? `This period (since ${periodStart(start)})` : `Since ${periodStart(start)}`;
}

/** Download and upload against the busiest row's total, in the chart colours the totals use. */
function ShareBar({ row, top }: { row: UsageRow; top: number }): ReactElement {
  return (
    <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
      <div className="bg-chart-2" style={{ width: `${String((row.rx / top) * 100)}%` }} />
      <div className="bg-chart-1" style={{ width: `${String((row.tx / top) * 100)}%` }} />
    </div>
  );
}

function Down({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <ArrowDownIcon className="size-3.5 shrink-0 text-chart-2" aria-label="Downloaded" />
      {children}
    </span>
  );
}

function Up({ children }: { children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <ArrowUpIcon className="size-3.5 shrink-0 text-chart-1" aria-label="Uploaded" />
      {children}
    </span>
  );
}

const columns = [
  { label: 'Device', className: 'pl-5' },
  { label: 'Download', className: 'text-right' },
  { label: 'Upload', className: 'text-right' },
  { label: 'Share', className: 'w-1/4' },
  { label: 'Connections', className: 'pr-5 text-right' },
] as const;

/** The busiest rows: a table on a wide screen, a card each on a phone. */
function UsageList({ rows, view, names }: { rows: readonly UsageRow[]; view: View; names: Map<string, string> }): ReactElement {
  const top = Math.max(1, ...rows.map((r) => r.rx + r.tx));
  const shown = rows.slice(0, 50);
  const title = (r: UsageRow): ReactElement =>
    view === 'devices' ? (
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={names.has(r.key.toLowerCase()) ? 'truncate font-medium' : 'truncate text-muted-foreground'}>
          {deviceLabel(names.get(r.key.toLowerCase()))}
        </span>
        <span className="font-mono text-xs break-all text-muted-foreground">{r.ip ?? r.key}</span>
      </span>
    ) : (
      <span className="truncate font-medium">{r.key === 'other' || r.key === '' ? 'Other' : r.key}</span>
    );
  const cols = view === 'devices' ? columns : [{ label: 'Application', className: 'pl-5' }, ...columns.slice(1)];
  return (
    <>
      <div className="hidden lg:block">
        <table className="w-full border-collapse text-sm">
          <thead className="border-b">
            <HeadRow columns={cols} />
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key} className="border-b last:border-b-0">
                <td className="w-1/3 max-w-0 py-2.5 pr-3 pl-5">{title(r)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatBytes(r.rx)}</td>
                <td className="px-3 py-2.5 text-right tabular">{formatBytes(r.tx)}</td>
                <td className="px-3 py-2.5">
                  <ShareBar row={r} top={top} />
                </td>
                <td className="py-2.5 pr-5 pl-3 text-right text-muted-foreground tabular">{formatNumber(r.conns)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y border-t lg:hidden">
        {shown.map((r) => (
          <li key={r.key} className="flex flex-col gap-2 px-4 py-3">
            <span className="flex items-start justify-between gap-3">
              {title(r)}
              <span className="flex shrink-0 flex-col items-end gap-0.5 text-sm tabular">
                <Down>{formatBytes(r.rx)}</Down>
                <span className="text-muted-foreground">
                  <Up>{formatBytes(r.tx)}</Up>
                </span>
              </span>
            </span>
            <ShareBar row={r} top={top} />
            <span className="text-xs text-muted-foreground tabular">
              {formatNumber(r.conns)} {r.conns === 1 ? 'connection' : 'connections'}
            </span>
          </li>
        ))}
      </ul>
    </>
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

const resetText = (day: string): string =>
  day === 'custom' ? 'Starts again on a schedule set in LuCI.' : `Starts again on day ${day} of each month.`;

/** The totals for what's shown, and the period they cover (an earlier one can be picked). */
function UsageAnswer({
  sum,
  whose,
  periods,
  current,
  resetDay,
  onPeriod,
}: {
  sum: { rx: number; tx: number };
  whose: string;
  periods: readonly string[];
  current: string | undefined;
  resetDay: string | undefined;
  onPeriod: (start: string) => void;
}): ReactElement {
  return (
    <Answer columns={3}>
      <AnswerCell
        title="Downloaded"
        value={
          <>
            <ArrowDownIcon className="size-4 shrink-0 text-chart-2" aria-hidden="true" />
            <Figure>{formatBytes(sum.rx)}</Figure>
          </>
        }
      >
        {whose}
      </AnswerCell>
      <AnswerCell
        title="Uploaded"
        value={
          <>
            <ArrowUpIcon className="size-4 shrink-0 text-chart-1" aria-hidden="true" />
            <Figure>{formatBytes(sum.tx)}</Figure>
          </>
        }
      >
        {whose}
      </AnswerCell>
      <AnswerCell
        title="Period"
        value={<Figure>{current === undefined ? 'This period' : `Since ${periodStart(current)}`}</Figure>}
        action={
          periods.length > 1 && (
            <Select value={current ?? ''} onValueChange={onPeriod}>
              <SelectTrigger className="h-8 w-full sm:w-64" aria-label="Period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {periods.map((p, i) => (
                  <SelectItem key={p} value={p}>
                    {periodLabel(p, i)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        }
      >
        {resetDay === undefined ? undefined : resetText(resetDay)}
      </AnswerCell>
    </Answer>
  );
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
  const sub = useSubPath();
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

  const one = view === 'devices' ? macFromPath(sub) : undefined;
  const rows = shownRows(usage.data ?? [], view, routerIps, one);
  const sum = totals(rows);
  const list = periods.data?.periods ?? [];
  const current = period === '' ? list[0] : period;
  const oneGiven = one === undefined ? undefined : names.get(one);
  // (not deviceLabel(): React's compiler takes a call on `names` for a change to it)
  const oneName = one === undefined ? undefined : (oneGiven ?? UNNAMED_DEVICE);
  // an unnamed device's MAC, beside "Unnamed device"
  const oneMac = oneGiven === undefined ? one : undefined;
  const whose = `${oneName ?? (view === 'devices' ? 'Your devices' : 'Everything counted')}, ${period === '' ? 'this period' : 'that period'}.`;
  const installed = periods.data?.installed !== false;
  const off = periods.data?.enabled === false;

  return (
    <>
      <PageHeader title="Data usage" description="How much each device downloads and uploads, and on what." />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {!installed ? (
          <Card className="px-5 py-5">
            <Note tone="warning" icon={<PackageXIcon />} title="Not in this firmware">
              <p>Counting needs the nlbwmon package, which isn’t in this firmware.</p>
              <GoLink href={href('upgrade')} className="mt-2">
                Upgrade the firmware
              </GoLink>
            </Note>
          </Card>
        ) : off ? (
          <Card className="px-5 py-5">
            <Note tone="info" icon={<ChartColumnIcon />} title="Data usage is off">
              <p>Nothing is counted while it’s off; the counts from before are kept.</p>
              {form !== undefined && saved?.toggle === true && !form.enabled && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    set('enabled', true);
                  }}
                >
                  Turn it on
                </Button>
              )}
            </Note>
          </Card>
        ) : usage.error !== undefined && usage.data === undefined ? (
          <LoadError error={usage.error} retry={usage.refresh} />
        ) : usage.data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
            <UsageAnswer
              sum={sum}
              whose={whose}
              periods={list}
              current={current}
              resetDay={saved?.day}
              onPeriod={(p) => {
                setPeriod(p === list[0] ? '' : p);
              }}
            />
            <Card className="gap-0 pb-0">
              <CardHeading
                title={view === 'devices' ? 'By device' : 'By application'}
                description="Busiest first. Counted from the router’s connection tracking, every 30 s."
                action={
                  <Segmented<View>
                    label="Group by"
                    value={view}
                    options={[
                      { value: 'devices', label: 'Devices' },
                      { value: 'apps', label: 'Applications' },
                    ]}
                    onChange={setView}
                  />
                }
              />
              {oneName !== undefined && (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t bg-muted/60 px-5 py-2 text-sm">
                  <span>
                    Only <span className="font-medium">{oneName}</span>
                    {oneMac !== undefined && <span className="ml-2 font-mono text-xs text-muted-foreground">{oneMac}</span>}
                  </span>
                  <GoLink href={href('data-statistics')}>Every device</GoLink>
                </div>
              )}
              <div className="mt-4">
                {rows.length === 0 ? (
                  <p className="border-t px-5 py-5 text-sm text-muted-foreground">
                    {one === undefined
                      ? 'Nothing counted yet in this period.'
                      : 'Nothing counted for this device in this period.'}
                  </p>
                ) : (
                  <UsageList rows={rows} view={view} names={names} />
                )}
              </div>
            </Card>
          </>
        )}
        {installed && form !== undefined && saved !== undefined && (saved.toggle || saved.section !== undefined) && (
          <Card>
            <CardHeading title="Counting" description="What the router counts, and when it starts again." />
            <CardContent className="divide-y">
              {saved.toggle && (
                <Field
                  id="ds-on"
                  label="Count data usage"
                  {...explain(
                    'Counts what each device downloads and uploads. While it’s off nothing is counted; the counts from before are kept.',
                    ['milkflint.datastats.enabled'],
                    <p>The counting is nlbwmon reading the router’s connection tracking.</p>,
                  )}
                >
                  <Switch
                    id="ds-on"
                    checked={form.enabled}
                    onCheckedChange={(v) => {
                      set('enabled', v);
                    }}
                  />
                </Field>
              )}
              {saved.section !== undefined && (
                <Field
                  id="ds-day"
                  label="Start counting again on"
                  {...explain('The day of the month your plan’s allowance resets. Changing it starts a fresh count.', [
                    `nlbwmon.${saved.section}.database_interval`,
                  ])}
                >
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
              )}
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
