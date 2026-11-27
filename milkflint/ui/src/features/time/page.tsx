// Name & time: the router's clock, live, with whether it agrees with this
// device, then the small form for its name, time zone and internet time.
// The clock ticks in the browser from offsets read every 30 s.
import { useSuspenseQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CheckCircle2Icon, Clock3Icon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { explain } from '@/components/explain';
import { FormField, FormSaveBar, SwitchField, TextField } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { Note } from '@/components/note';
import { PageBoundary } from '@/components/page-boundary';
import { SearchSelect } from '@/components/search-select';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useApply } from '@/hooks/use-apply';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { pageLink } from '@/lib/router';
import { serversOf, type TimeForm, timeFormSchema, toChanges } from './model';
import { timeQueries, useSetClock } from './queries';

/** A fact beside the clock: its label above, its value below. */
function Fact({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

/** The answer: the router's clock ticking, whether it agrees with this device, and what it's set to. */
function RouterClock({ saved }: { saved: TimeForm | undefined }): ReactElement {
  const polled = useLive(timeQueries.clock());
  const setClock = useSetClock();
  const [synced, setSynced] = useState(false);
  const drift = synced ? 0 : polled.data?.drift;
  const zone = polled.data?.zone;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  const sync = (): void => {
    setClock.mutate(undefined, {
      onSuccess: () => {
        setSynced(true);
      },
    });
  };

  const shown = drift === undefined || zone === undefined ? undefined : new Date(now + drift + zone);
  const off = drift !== undefined && Math.abs(drift) > 60_000;
  return (
    <Card className="gap-0 py-0">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 p-5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-sm text-muted-foreground">Router time</h2>
          <p className="text-3xl font-semibold tracking-tight tabular">
            {shown === undefined
              ? '—'
              : shown.toLocaleTimeString('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </p>
          <p className="text-sm text-muted-foreground">
            {shown === undefined
              ? 'Reading the router’s clock…'
              : shown.toLocaleDateString('en-GB', {
                  timeZone: 'UTC',
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {drift !== undefined &&
            (off ? (
              <Note tone="warning" icon={<TriangleAlertIcon />}>
                About {Math.round(Math.abs(drift) / 60_000)} min {drift > 0 ? 'ahead of' : 'behind'} this device
              </Note>
            ) : (
              <Note tone="success" icon={<CheckCircle2Icon />}>
                In step with this device
              </Note>
            ))}
          <Button variant={off ? 'default' : 'outline'} size="sm" onClick={sync} disabled={setClock.isPending}>
            {setClock.isPending ? <LoaderCircleIcon className="animate-spin" /> : <Clock3Icon />}
            Set from this device
          </Button>
          {setClock.error !== null && (
            <p role="alert" className="text-xs text-destructive">
              {setClock.error.message}
            </p>
          )}
        </div>
      </div>
      {saved !== undefined && (
        <dl className="grid gap-4 border-t px-5 py-4 sm:grid-cols-3">
          <Fact label="Name">{saved.hostname}</Fact>
          <Fact label="Time zone">{saved.zonename === '' ? 'Not chosen: UTC' : saved.zonename.replaceAll('_', ' ')}</Fact>
          <Fact label="Internet time">
            {saved.ntp
              ? `On, ${String(serversOf(saved.servers).length)} server${serversOf(saved.servers).length === 1 ? '' : 's'}`
              : 'Off'}
          </Fact>
        </dl>
      )}
    </Card>
  );
}

export function TimePage(): ReactElement {
  return (
    <>
      <PageHeader
        title="Name & time"
        description="The router’s name, time zone and clock. Scheduled tasks and the logs go by this clock."
      />
      <PageBoundary>
        <TimeBody />
      </PageBoundary>
    </>
  );
}

function TimeBody(): ReactElement {
  const { data } = useSuspenseQuery(timeQueries.settings());
  const { state, apply } = useApply();
  const settings = useSettingsForm({
    schema: timeFormSchema,
    saved: data.form,
    onSave: (values) => apply(toChanges(values, data)),
  });
  const { form } = settings;
  const values = useFormValues(form);

  return (
    <>
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <RouterClock saved={data.form} />
        <Card>
          <CardHeading title="Settings" />
          <CardContent className="divide-y">
            <form.Field name="hostname">
              {(field) => (
                <TextField
                  field={field}
                  id="hostname"
                  label="Router name"
                  {...explain('Shown on this page and to devices on your network. Letters, digits and hyphens.', [
                    'system.@system[0].hostname',
                  ])}
                  trim
                />
              )}
            </form.Field>
            <form.Field name="zonename">
              {(field) => (
                <FormField
                  field={field}
                  id="zonename"
                  label="Time zone"
                  {...explain(
                    'Search by city or region, or by an abbreviation like GMT or CET. The zone’s name and its rule (such as GMT0BST,M3.5.0/1,M10.5.0) are written together, as LuCI writes them.',
                    ['system.@system[0].zonename', 'system.@system[0].timezone'],
                  )}
                >
                  {(control) => (
                    <>
                      <SearchSelect
                        id={control.id}
                        placeholder="Choose a time zone"
                        options={(data.zones.length > 0 || values.zonename === ''
                          ? data.zones
                          : [{ name: values.zonename, tz: '' }]
                        ).map((z) => ({
                          value: z.name,
                          label: z.name.replaceAll('_', ' '),
                          // the zone's abbreviations from its POSIX rule ("GMT0BST,…" → GMT BST)
                          keywords: (z.tz.match(/[A-Z]{3,}/g) ?? []).join(' '),
                        }))}
                        value={field.state.value}
                        onChange={(v) => {
                          field.handleChange(v);
                        }}
                      />
                      {values.zonename === '' && (
                        <p className="text-xs text-muted-foreground">None chosen yet, so the router keeps UTC.</p>
                      )}
                    </>
                  )}
                </FormField>
              )}
            </form.Field>
            <form.Field name="ntp">
              {(field) => (
                <SwitchField
                  field={field}
                  id="ntp"
                  label="Internet time"
                  {...explain('Keeps the clock right using time servers (NTP).', ['system.ntp.enabled'])}
                />
              )}
            </form.Field>
            {values.ntp && (
              <form.Field name="servers">
                {(field) => (
                  <FormField
                    field={field}
                    id="servers"
                    label="Time servers"
                    {...explain('One server name per line.', ['system.ntp.server'])}
                  >
                    {(control) => (
                      <textarea
                        {...control}
                        rows={4}
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                        }}
                        onBlur={field.handleBlur}
                        className="w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30"
                      />
                    )}
                  </FormField>
                )}
              </form.Field>
            )}
          </CardContent>
        </Card>
        <p className="text-sm text-muted-foreground">
          Restarts and Wi-Fi times you schedule are on{' '}
          <Link {...pageLink('schedules')} className="font-medium link">
            Scheduled tasks
          </Link>
          .
        </p>
      </div>
      <FormSaveBar settings={settings} busy={state.phase === 'applying'} />
    </>
  );
}
