// Performance tuning: how the router handles heavy traffic. It opens on what
// is in effect now and which settings differ from MilkFlint's defaults, then
// the essentials (packet steering, flow offloading), the expert options
// folded away (threads and interrupts, GRO, ECN, the Wi-Fi driver's queue),
// the diagnostics that change how the router runs while chasing a problem,
// and the live views of where the work runs. One save bar saves them all;
// what each writes is in ./model.ts and ../logs/api.ts.
import { ChevronDownIcon, LoaderCircleIcon } from 'lucide-react';
import { type ReactElement, type ReactNode, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { useNetworkLive } from '@/hooks/use-network-live';
import { usePoll } from '@/hooks/use-poll';
import { reboot } from '@/lib/api/system';
import type { Change } from '@/lib/api/uci';
import { useSubPath } from '@/lib/router';
import { cn } from '@/lib/utils';
import { waitForRouterAndReload } from '../backup-reset/api';
import { getLogSettings, type LogSettings, logSettingsChanges } from '../logs/api';
import { getTuningStatus } from './api';
import { DiagnosticsCard } from './diagnostics';
import { RestoreDialog, WedDialog } from './dialogs';
import { OffloadCard, SteeringCard } from './essentials';
import { AqlCard, CpuCard, EcnCard, GroCard } from './expert';
import { WaitsCard, WorkCard } from './live';
import { changedSettings, defaults, loadTuning, meaning, steeringInUse, toChanges, type TuningForm, validate } from './model';
import { InEffectNow } from './now';
import { WedNotice } from './wed-notice';

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
  const { data, error, loading, reload } = useLoad(loadTuning);
  const status = usePoll(getTuningStatus, 5000);
  const live = useNetworkLive(2000);
  // the diagnostics' switches, which live with the Logs page's settings
  const { data: logs, error: logsError, reload: reloadLogs } = useLoad(getLogSettings);
  const subPath = useSubPath();
  const refreshStatus = status.refresh;
  const [edit, setEdit] = useState<TuningForm>();
  const [diagEdit, setDiagEdit] = useState<LogSettings>();
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
    setEdit(undefined);
    setDiagEdit(undefined);
    reload();
    reloadLogs();
    refreshStatus();
    if (restartAfter.current) {
      restartAfter.current = false;
      void restart();
    }
  }, [reload, reloadLogs, refreshStatus, restart]);
  const { state, apply } = useApply(onApplied);
  const form = edit ?? data?.form;
  const diag = diagEdit ?? logs;
  const errors = form === undefined ? {} : validate(form);
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof TuningForm>(key: K, value: TuningForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const setDiag = (key: 'counters' | 'snapshot' | 'kfence', value: boolean): void => {
    setDiagEdit((current) => {
      const base = current ?? logs;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const tuningDirty = edit !== undefined && data !== undefined && meaning(edit, data) !== meaning(data.form, data);
  const diagDirty = diagEdit !== undefined && logs !== undefined && JSON.stringify(diagEdit) !== JSON.stringify(logs);
  const dirty = tuningDirty || diagDirty;
  const atDefaults = data !== undefined && meaning(data.form, data) === meaning(defaults, data);
  const applying = state.phase === 'applying';
  const changed = data === undefined ? [] : changedSettings(data.form, data);
  const expertChanged =
    form === undefined || data === undefined ? [] : changedSettings(form, data).filter((c) => c.tier === 'expert');

  // #/tuning/diagnostics (from the Logs page) lands on the diagnostics
  useEffect(() => {
    if (subPath === 'diagnostics' && data !== undefined && logs !== undefined)
      document.getElementById('diagnostics')?.scrollIntoView({ block: 'start' });
  }, [subPath, data, logs]);

  // a save goes ahead, unless it turns WED on or off: that one says first what it changes
  const save = (f: TuningForm, withDiagnostics: boolean): void => {
    if (data === undefined) return;
    const diagnostics = withDiagnostics && diagDirty ? logSettingsChanges(diagEdit, logs) : [];
    const changes = [...toChanges(f, data), ...diagnostics];
    if (f.wed !== data.form.wed) setWedSave({ to: f.wed, changes });
    else void apply(changes);
  };

  const restore = (): void => {
    setRestoring(false);
    setEdit(undefined);
    setDiagEdit(undefined);
    if (data !== undefined && !atDefaults) save(defaults, false);
  };

  // folded unless opened, or holding a field to fix
  const expertShown = expertOpen || Object.keys(errors).length > 0;
  // the RSS settings apply where RSS runs: not on a PPPoE line with Automatic, nor without the rings
  const rss =
    form !== undefined &&
    data !== undefined &&
    steeringInUse(form.steering, { pppoe: data.pppoe, rssMissing: live.data !== undefined && live.data.rss === undefined }) ===
      'rss';

  return (
    <>
      <PageHeader
        title="Performance tuning"
        description="How the router handles heavy traffic. Changes apply at once and Wi-Fi and the internet stay up, except hardware offloading (WED), which takes a restart."
      />
      <div className="flex flex-col gap-8">
        <ApplyStatus state={state} />
        {restarting && (
          <Alert variant="info" role="status">
            <LoaderCircleIcon className="animate-spin" />
            <AlertTitle>Restarting the router…</AlertTitle>
          </Alert>
        )}
        {data?.form.wed === true && (
          <WedNotice title="Hardware offloading (WED) is on">
            Smart Queue and the guest speed limits were turned off for it, and connections the hardware forwards pass by the Wi-Fi
            queue limits, airtime fairness, packet steering and GRO settings below. Turning it off under Flow offloading puts
            everything back.
          </WedNotice>
        )}
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
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
                <SteeringCard form={form} data={data} live={live.data} set={set} />
                <OffloadCard
                  form={form}
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
                  <ChevronDownIcon
                    className={cn('transition-transform duration-fast', expertShown && 'rotate-180')}
                    aria-hidden
                  />
                </Button>
              }
            >
              <div id={expertPanel} hidden={!expertShown} className="grid items-start gap-4 xl:grid-cols-2">
                <div className="flex min-w-0 flex-col gap-4">
                  <CpuCard form={form} status={status.data} rss={rss} set={set} />
                  <GroCard form={form} data={data} port={status.data?.gro[0]} set={set} />
                </div>
                <div className="flex min-w-0 flex-col gap-4">
                  <EcnCard
                    form={form}
                    status={status.data}
                    targetMs={data.sqm?.targetMs ?? null}
                    set={set}
                    wedOn={data.form.wed}
                  />
                  <AqlCard form={form} errors={errors} status={status.data} set={set} wedOn={data.form.wed} />
                </div>
              </div>
            </Section>

            {logsError !== undefined && logs === undefined ? (
              <LoadError error={logsError} retry={reloadLogs} />
            ) : (
              diag !== undefined && <DiagnosticsCard form={diag} set={setDiag} />
            )}

            <Section title="Live" description="What the settings lead to, read every 2 s.">
              <WorkCard live={live} />
              <WaitsCard status={status.data} live={live.data} />
            </Section>
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={applying}
        invalid={Object.keys(errors).length > 0}
        onSave={() => {
          if (form !== undefined) save(form, true);
        }}
        onRevert={() => {
          setEdit(undefined);
          setDiagEdit(undefined);
        }}
      />
      {data !== undefined && (
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
      )}
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
