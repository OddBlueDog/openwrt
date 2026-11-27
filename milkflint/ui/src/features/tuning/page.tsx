// Performance tuning: how the router handles heavy traffic. It opens on what
// is in effect now and which settings differ from MilkFlint's defaults, then
// the essentials (packet steering, flow offloading), the expert options
// folded away (threads and interrupts, GRO, ECN, the Wi-Fi driver's queue),
// the diagnostics that change how the router runs while chasing a problem,
// and the live views of where the work runs. One save bar saves them all;
// what each writes is in ./model.ts and ../logs/api.ts.
import { useQuery } from '@tanstack/react-query';
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { z } from 'zod';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApply } from '@/hooks/use-apply';
import { useNetworkLive } from '@/hooks/use-network-live';
import { evaluate } from '@tanstack/react-form';
import { reboot } from '@/lib/api/system';
import type { Change } from '@/lib/api/uci';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { useLive } from '@/lib/query/use-live';
import { useSubPath } from '@/lib/router';
import { cn } from '@/lib/utils';
import { waitForRouterAndReload } from '../backup-reset/api';
import { type LogSettings, logSettingsChanges } from '../logs/api';
import { DiagnosticsCard } from './diagnostics';
import { RestoreDialog, WedDialog } from './dialogs';
import { OffloadCard, SteeringCard } from './essentials';
import { AqlCard, CpuCard, EcnCard, GroCard } from './expert';
import { WaitsCard, WorkCard } from './live';
import {
  changedSettings,
  defaults,
  type Errors,
  meaning,
  steeringInUse,
  toChanges,
  type TuningData,
  type TuningForm,
  tuningFieldNames,
  tuningFormSchema,
} from './model';
import { InEffectNow } from './now';
import { tuningQueries } from './queries';
import { WedNotice } from './wed-notice';

const TITLE = 'Performance tuning';
const DESCRIPTION =
  'How the router handles heavy traffic. Changes apply at once and Wi-Fi and the internet stay up, except hardware offloading (WED), which takes a restart.';

/** The diagnostics' switches this page edits, of the Logs page's settings. */
const diagnosticsSchema = z.object({ counters: z.boolean(), snapshot: z.boolean(), kfence: z.boolean() });
type Diagnostics = z.infer<typeof diagnosticsSchema>;
const diagnosticsOf = (logs: LogSettings | undefined): Diagnostics => ({
  counters: logs?.counters ?? false,
  snapshot: logs?.snapshot ?? false,
  kfence: logs?.kfence ?? false,
});

/** A group of the page's cards under its own heading. */
function Section({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}): ReactElement {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={id} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          {description !== undefined && <p className="max-w-prose text-sm text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function TuningPage(): ReactElement {
  const { data, error, refetch } = useQuery(tuningQueries.settings());
  if (data !== undefined) return <TuningSettings data={data} />;
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div className="flex flex-col gap-8">
        {error === null ? (
          <FormSkeleton />
        ) : (
          <LoadError
            error={error}
            retry={() => {
              void refetch();
            }}
          />
        )}
      </div>
    </>
  );
}

function TuningSettings({ data }: { data: TuningData }): ReactElement {
  const status = useLive(tuningQueries.status());
  const live = useNetworkLive(2000);
  // the diagnostics' switches, which live with the Logs page's settings
  const logsQuery = useQuery(tuningQueries.logSettings());
  const logs = logsQuery.data;
  const subPath = useSubPath();
  const [restoring, setRestoring] = useState(false);
  const [expertOpen, setExpertOpen] = useState(false);
  const expertPanel = useId();
  // a save that changes hardware offloading (WED) is confirmed first: the changes it waits with
  const [wedSave, setWedSave] = useState<{ to: boolean; changes: Change[] }>();
  const [restarting, setRestarting] = useState(false);
  // restart the router once the save in progress is applied
  const restartAfter = useRef(false);
  const restart = useCallback(async (): Promise<void> => {
    setRestarting(true);
    try {
      await reboot();
    } catch {
      // the router may drop the connection while answering
    }
    await waitForRouterAndReload();
  }, []);
  const onApplied = useCallback(() => {
    if (restartAfter.current) {
      restartAfter.current = false;
      void restart();
    }
  }, [restart]);
  const { state, apply } = useApply(onApplied);
  const diagSettings = useSettingsForm({ schema: diagnosticsSchema, saved: diagnosticsOf(logs), onSave: () => undefined });
  const diag = useFormValues(diagSettings.form);
  const diagDirty = logs !== undefined && !evaluate(diag, diagnosticsOf(logs));

  // a save goes ahead, unless it turns WED on or off: that one says first what it changes
  const save = (f: TuningForm, withDiagnostics: boolean): Promise<unknown> | undefined => {
    const diagnostics = withDiagnostics && diagDirty ? logSettingsChanges({ ...logs, ...diag }, logs) : [];
    const changes = [...toChanges(f, data), ...diagnostics];
    if (f.wed !== data.form.wed) {
      setWedSave({ to: f.wed, changes });
      return undefined;
    }
    return apply(changes);
  };
  const settings = useSettingsForm({
    schema: tuningFormSchema,
    saved: data.form,
    onSave: (values) => save(values, true),
  });
  const { form } = settings;
  const values = useFormValues(form);
  // the cards change the form through this, a field at a time
  const set = <K extends keyof TuningForm>(key: K, value: TuningForm[K]): void => {
    const current = form.store.state.values;
    const next = { ...current, [key]: value };
    for (const name of tuningFieldNames) {
      if (!evaluate(current[name], next[name])) form.setFieldValue(name, next[name]);
    }
  };
  const setDiag = (key: keyof Diagnostics, value: boolean): void => {
    diagSettings.form.setFieldValue(key, value);
  };
  // the checks as they stand, shown as they're typed, as before
  const errors: Errors = formErrors(tuningFormSchema, values);
  // forms that mean the same are the same: a custom limit typed while it's off isn't a change
  const tuningDirty = meaning(values, data) !== meaning(data.form, data);
  const dirty = tuningDirty || diagDirty;
  const atDefaults = meaning(data.form, data) === meaning(defaults, data);
  const applying = state.phase === 'applying';
  const changed = changedSettings(data.form, data);
  const expertChanged = changedSettings(values, data).filter((c) => c.tier === 'expert');
  const discard = (): void => {
    settings.discard();
    diagSettings.discard();
  };

  // #/tuning/diagnostics (from the Logs page) lands on the diagnostics
  useEffect(() => {
    if (subPath === 'diagnostics' && logs !== undefined)
      document.getElementById('diagnostics')?.scrollIntoView({ block: 'start' });
  }, [subPath, logs]);

  const restore = (): void => {
    setRestoring(false);
    discard();
    if (!atDefaults) void save(defaults, false);
  };

  // folded unless opened, or holding a field to fix
  const expertShown = expertOpen || Object.keys(errors).length > 0;
  // the RSS settings apply where RSS runs: not on a PPPoE line with Automatic, nor without the rings
  const rss =
    steeringInUse(values.steering, { pppoe: data.pppoe, rssMissing: live.data !== undefined && live.data.rss === undefined }) ===
    'rss';

  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} />
      <div className="flex flex-col gap-8">
        <ApplyStatus state={state} />
        {restarting && (
          <Alert variant="info" role="status">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>Restarting the router…</AlertTitle>
          </Alert>
        )}
        {data.form.wed && (
          <WedNotice title="Hardware offloading (WED) is on">
            Smart Queue and the guest speed limits were turned off for it, and connections the hardware forwards pass by the Wi-Fi
            queue limits, airtime fairness, packet steering and GRO settings below. Turning it off under Flow offloading puts
            everything back.
          </WedNotice>
        )}
        <>
          <InEffectNow
            data={data}
            status={status.data}
            live={live.data}
            diagnostics={logs}
            changed={changed}
            restoreDisabled={applying || (atDefaults && !dirty)}
            onRestore={() => {
              setRestoring(true);
            }}
          />

          <Section title="Essentials" description="The two settings that decide most of how traffic moves through the router.">
            <div className="grid items-start gap-4 xl:grid-cols-2">
              <SteeringCard form={values} data={data} live={live.data} set={set} />
              <OffloadCard
                form={values}
                data={data}
                status={status.data}
                set={set}
                onRestart={() => {
                  void restart();
                }}
              />
            </div>
          </Section>

          <Section
            title="Expert options"
            description={
              <>
                Threads and interrupts, receive grouping, ECN and the Wi-Fi driver’s queue. Each one’s Why? names the option it
                writes.{' '}
                <span className="text-foreground">
                  {expertChanged.length === 0
                    ? 'All at their defaults.'
                    : `Changed: ${expertChanged.map((c) => c.label).join(', ')}.`}
                </span>
              </>
            }
            aside={
              <Button
                variant="outline"
                size="sm"
                aria-expanded={expertShown}
                aria-controls={expertPanel}
                onClick={() => {
                  setExpertOpen(!expertShown);
                }}
              >
                {expertShown ? 'Hide' : 'Show'} expert options
                <ChevronDownIcon className={cn('transition-transform duration-fast', expertShown && 'rotate-180')} aria-hidden />
              </Button>
            }
          >
            <div id={expertPanel} hidden={!expertShown} className="grid items-start gap-4 xl:grid-cols-2">
              <div className="flex min-w-0 flex-col gap-4">
                <CpuCard form={values} status={status.data} rss={rss} set={set} />
                <GroCard form={values} data={data} port={status.data?.gro[0]} set={set} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <EcnCard
                  form={values}
                  status={status.data}
                  targetMs={data.sqm?.targetMs ?? null}
                  set={set}
                  wedOn={data.form.wed}
                />
                <AqlCard form={values} errors={errors} status={status.data} set={set} wedOn={data.form.wed} />
              </div>
            </div>
          </Section>

          {logsQuery.error !== null && logs === undefined ? (
            <LoadError
              error={logsQuery.error}
              retry={() => {
                void logsQuery.refetch();
              }}
            />
          ) : (
            logs !== undefined && <DiagnosticsCard form={{ ...logs, ...diag }} set={setDiag} />
          )}

          <Section title="Live" description="What the settings lead to, read every 2 s.">
            <WorkCard live={live} />
            <WaitsCard status={status.data} live={live.data} />
          </Section>
        </>
      </div>
      <SaveBar
        visible={dirty}
        busy={applying}
        invalid={Object.keys(errors).length > 0}
        onSave={settings.save}
        onRevert={discard}
      />
      <WedDialog
        to={wedSave?.to}
        data={data}
        onCancel={() => {
          setWedSave(undefined);
        }}
        onSave={(andRestart) => {
          const changes = wedSave?.changes ?? [];
          setWedSave(undefined);
          restartAfter.current = andRestart;
          void apply(changes);
        }}
      />
      <RestoreDialog
        open={restoring}
        data={data}
        dirty={dirty}
        onCancel={() => {
          setRestoring(false);
        }}
        onRestore={restore}
      />
    </>
  );
}
