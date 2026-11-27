// Data usage: nlbwmon's count of what each device (or application) has
// downloaded and uploaded this accounting period. It opens on the totals and
// the period, then the devices, busiest first (or sorted by a column): a
// table on a wide screen, a card each on a phone, 50 at a time.
// #/data-statistics/<mac> shows one device (All
// devices links here). Counting can be turned off; while it's off the page
// says so and how to turn it on.
import { ArrowDownIcon, ArrowUpIcon, ChartColumnIcon, PackageXIcon } from 'lucide-react';
import { useQuery, useSuspenseQuery } from '@tanstack/react-query';
import { type ReactElement, type ReactNode, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { type Column, DataTable } from '@/components/data-table';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { FormSaveBar } from '@/components/form';
import { PageBoundary } from '@/components/page-boundary';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useApply } from '@/hooks/use-apply';
import { firstSeenText } from '@/lib/api/seen';
import { Freshness } from '@/components/freshness';
import { DeviceLive } from '@/components/device-live';
import { formatBytes, formatNumber } from '@/lib/format';
import { pageLink, useSubPath } from '@/lib/router';
import { Segmented } from '../firewall/parts';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { explain } from '@/components/explain';
import { deviceLabel, UNNAMED_DEVICE } from '../clients/model';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { periodStart, type UsageRow } from './api';
import { HistoryCard } from './history-card';
import { dataUsageFormSchema, macFromPath, routerMacs, shownRows, toChanges, toForm, totals, type View } from './model';
import { dataUsageQueries } from './queries';

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

const appName = (r: UsageRow): string => (r.key === 'other' || r.key === '' ? 'Other' : r.key);

/** A device's name (or that it has none) over its address, or an application's name. */
function Title({ r, view, name }: { r: UsageRow; view: View; name: string | undefined }): ReactElement {
  return view === 'devices' ? (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className={name === undefined ? 'truncate text-muted-foreground' : 'truncate font-medium'}>{deviceLabel(name)}</span>
      <span className="font-mono text-xs break-all text-muted-foreground">{r.ip ?? r.key}</span>
    </span>
  ) : (
    <span className="truncate font-medium">{appName(r)}</span>
  );
}

/** The columns: the name (an unnamed device last) and each figure sort; the share is against the busiest row's total. */
function usageColumns(view: View, names: Map<string, string>, top: number): Column<UsageRow>[] {
  const name = (r: UsageRow): string | undefined => names.get(r.key.toLowerCase());
  return [
    {
      label: view === 'devices' ? 'Device' : 'Application',
      cell: (r) => <Title r={r} view={view} name={name(r)} />,
      sort: view === 'devices' ? name : appName,
      sortLabel: 'By name',
      className: 'w-1/3 max-w-0',
    },
    {
      label: 'Download',
      cell: (r) => formatBytes(r.rx),
      sort: (r) => r.rx,
      sortDescFirst: true,
      sortLabel: 'Most downloaded first',
      className: 'text-right tabular',
    },
    {
      label: 'Upload',
      cell: (r) => formatBytes(r.tx),
      sort: (r) => r.tx,
      sortDescFirst: true,
      sortLabel: 'Most uploaded first',
      className: 'text-right tabular',
    },
    { label: 'Share', cell: (r) => <ShareBar row={r} top={top} />, className: 'w-1/4' },
    {
      label: 'Connections',
      cell: (r) => formatNumber(r.conns),
      sort: (r) => r.conns,
      sortDescFirst: true,
      sortLabel: 'Most connections first',
      className: 'text-right text-muted-foreground tabular',
    },
  ];
}

/** The rows, busiest first: a table on a wide screen, a card each on a phone, 50 at a time. */
function UsageList({
  rows,
  view,
  names,
  empty,
}: {
  rows: readonly UsageRow[];
  view: View;
  names: Map<string, string>;
  empty: string;
}): ReactElement {
  const top = Math.max(1, ...rows.map((r) => r.rx + r.tx));
  const columns = useMemo(() => usageColumns(view, names, top), [view, names, top]);
  return (
    <DataTable
      // devices and applications sort apart
      key={view}
      label={view === 'devices' ? 'Data usage by device' : 'Data usage by application'}
      columns={columns}
      rows={rows}
      rowKey={(r) => r.key}
      empty={empty}
      defaultOrder="Busiest first"
      pageSize={50}
      framed={false}
      inset
      wide="md"
      card={(r) => (
        <div className="flex flex-col gap-2 px-4 py-3">
          <span className="flex items-start justify-between gap-3">
            <Title r={r} view={view} name={names.get(r.key.toLowerCase())} />
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
        </div>
      )}
    />
  );
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
  return (
    <>
      <PageHeader title="Data usage" description="How much each device downloads and uploads, and on what." />
      <PageBoundary>
        <DataUsage />
      </PageBoundary>
    </>
  );
}

function DataUsage(): ReactElement {
  const { data: saved } = useSuspenseQuery(dataUsageQueries.settings());
  const periods = useLive(dataUsageQueries.periods());
  const names = useLive(dataUsageQueries.names()).data ?? new Map<string, string>();
  const routerIps = useLive(dataUsageQueries.routerIps()).data;
  const [period, setPeriod] = useState('');
  const [view, setView] = useState<View>('devices');
  const usage = useLive(dataUsageQueries.usage(period, view === 'devices' ? 'mac' : 'layer7'));
  const sub = useSubPath();
  // turned on or off: what's counted changes too, and a save refreshes every read
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: dataUsageFormSchema,
    saved: toForm(saved),
    onSave: (values) => apply(toChanges(values, saved)),
  });
  const { form } = settings;
  const values = useFormValues(form);

  const one = view === 'devices' ? macFromPath(sub) : undefined;
  // when the router first saw the one device, read once the page opens
  const seen = useQuery(dataUsageQueries.seen()).data;
  const firstSeen = one === undefined || seen === undefined ? undefined : firstSeenText(seen, one);
  const rows = shownRows(usage.data ?? [], view, routerIps, one);
  const sum = totals(rows);
  const hide = routerMacs(usage.data ?? [], routerIps);
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
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {!installed ? (
          <Card className="px-5 py-5">
            <Note tone="warning" icon={<PackageXIcon />} title="Not in this firmware">
              <p>Counting needs the nlbwmon package, which isn’t in this firmware.</p>
              <GoLink to={pageLink('upgrade')} className="mt-2">
                Upgrade the firmware
              </GoLink>
            </Note>
          </Card>
        ) : off ? (
          <Card className="px-5 py-5">
            <Note tone="info" icon={<ChartColumnIcon />} title="Data usage is off">
              <p>
                Nothing is counted while it’s off; the counts from before are kept.
                {saved.history && ' The 24-hour history is deleted.'}
              </p>
              {saved.toggle && !values.enabled && (
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => {
                    form.setFieldValue('enabled', true);
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
              resetDay={saved.day}
              onPeriod={(p) => {
                setPeriod(p === list[0] ? '' : p);
              }}
            />
            <Card className="gap-0 pb-0">
              <CardHeading
                title={view === 'devices' ? 'By device' : 'By application'}
                description="Busiest first. Counted from the router’s connection tracking."
                status={<Freshness at={usage.at} next={usage.next} />}
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
                    {firstSeen !== undefined && <span className="block text-xs text-muted-foreground">{firstSeen}</span>}
                  </span>
                  <GoLink to={pageLink('data-statistics')}>Every device</GoLink>
                </div>
              )}
              {one !== undefined && (
                <div className="px-5">
                  <DeviceLive mac={one} />
                </div>
              )}
              <div className="mt-4">
                <UsageList
                  rows={rows}
                  view={view}
                  names={names}
                  empty={
                    one === undefined ? 'Nothing counted yet in this period.' : 'Nothing counted for this device in this period.'
                  }
                />
              </div>
            </Card>
            {view === 'devices' && <HistoryCard on={saved.history} mac={one} names={names} hide={hide} />}
          </>
        )}
        {installed && (saved.toggle || saved.section !== undefined) && (
          <Card>
            <CardHeading title="Counting" description="What the router counts, and when it starts again." />
            <CardContent className="divide-y">
              {saved.toggle && (
                <Field
                  id="ds-on"
                  label="Count data usage"
                  {...explain(
                    `Counts what each device downloads and uploads. While it’s off nothing is counted; the counts from before are kept.${saved.history ? ' The 24-hour history is deleted.' : ''}`,
                    ['milkflint.datastats.enabled'],
                    <p>The counting is nlbwmon reading the router’s connection tracking.</p>,
                  )}
                >
                  <form.Field name="enabled">
                    {(field) => (
                      <Switch
                        id="ds-on"
                        checked={field.state.value}
                        onCheckedChange={(v) => {
                          field.handleChange(v);
                        }}
                      />
                    )}
                  </form.Field>
                </Field>
              )}
              {saved.toggle && (
                <Field
                  id="ds-history"
                  label="Keep a 24-hour history per device"
                  status={!values.enabled ? 'Needs Data usage counting to be on.' : undefined}
                  {...explain(
                    'Adds the last 1, 4, 8 and 24 hours per device to this page. Every 5 minutes the router notes what each device moved. Each hour’s figures are deleted 24 hours after that hour ends, and turning this off deletes them all at once.',
                    ['milkflint.datastats.history'],
                  )}
                >
                  <form.Field name="history">
                    {(field) => (
                      <Switch
                        id="ds-history"
                        checked={field.state.value && values.enabled}
                        disabled={!values.enabled}
                        onCheckedChange={(v) => {
                          field.handleChange(v);
                        }}
                      />
                    )}
                  </form.Field>
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
                  <form.Field name="day">
                    {(field) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(v) => {
                          field.handleChange(v);
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
                    )}
                  </form.Field>
                </Field>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
