// The Smart Queue page: SQM with CAKE on the internet connection. It opens on
// the answer (whether the line is shaped, at what speeds, and how long
// packets wait in CAKE, every 2 s), or, while it's off, on what it does and
// how to set it up. The line's speeds and connection type come next, the
// rest under More settings, and everything sqm-scripts and CAKE take in the
// advanced sheet. How the queues sit on the CPUs is at the bottom.
import { useQuery } from '@tanstack/react-query';
import { SlidersHorizontalIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { FormSaveBar } from '@/components/form';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { PowerSwitch } from '@/components/power-switch';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApply } from '@/hooks/use-apply';
import type { Change } from '@/lib/api/uci';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { cpuText } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { useWed } from '../tuning/use-wed';
import { WedNotice } from '../tuning/wed-notice';
import { advancedData } from './advanced';
import { AdvancedSheet, type TabId } from './advanced-sheet';
import { ShapingNow } from './answer';
import { useSqmLive } from './live';
import { type SqmData, type SqmErrors, sqmFormSchema, toChanges } from './model';
import { multiQueueThresholdKbit, usesMultiQueue } from './multi-queue';
import { sqmQueries } from './queries';
import { QueuesCard } from './queues';
import { shapingProblems } from './running';
import { SettingsCard } from './settings';

const TITLE = 'Smart Queue';
const DESCRIPTION = 'Keeps latency low when the line is busy, by shaping traffic just below your line’s speed (SQM with CAKE).';

/** a problem once it has lasted this long: a save restarts Smart Queue, which takes a few seconds */
const SETTLE_MS = 10_000;

/** value once it has stayed the same for ms; undefined until then */
function useLasting(value: string | undefined, ms: number): string | undefined {
  const [lasting, setLasting] = useState<string>();
  useEffect(() => {
    const t = window.setTimeout(
      () => {
        setLasting(value);
      },
      value === undefined ? 0 : ms,
    );
    return () => {
      window.clearTimeout(t);
    };
  }, [value, ms]);
  return value === lasting ? value : undefined;
}

// The header's way into the advanced sheet; why it can't open, when it can't
function AdvancedButton({ why, onClick }: { why: string | undefined; onClick: () => void }): ReactElement {
  // aria-disabled rather than disabled: a disabled button gets no pointer events, so no tooltip
  const button = (
    <Button
      variant="outline"
      aria-disabled={why !== undefined}
      className={cn(why !== undefined && 'cursor-not-allowed opacity-50')}
      onClick={() => {
        if (why === undefined) onClick();
      }}
    >
      <SlidersHorizontalIcon />
      Advanced
    </Button>
  );
  if (why === undefined) return button;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{why}</TooltipContent>
    </Tooltip>
  );
}

export function SqmPage(): ReactElement {
  const { data, error, refetch } = useQuery(sqmQueries.settings());
  if (data !== undefined) return <SqmSettings data={data} />;
  return (
    <>
      <PageHeader title={TITLE} description={DESCRIPTION} actions={<AdvancedButton why="Loading…" onClick={() => undefined} />} />
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
    </>
  );
}

function SqmSettings({ data }: { data: SqmData }): ReactElement {
  // hardware offloading with WED turns Smart Queue off; turning it on here turns WED off
  const wed = useWed();
  const { state, apply } = useApply(wed.reload);
  const schema = useMemo(() => sqmFormSchema(data), [data]);
  const settings = useSettingsForm({
    schema,
    saved: data.form,
    // Smart Queue on is WED off: its changes first, so this page's own stand
    onSave: (values) => apply([...(wed.on && values.enabled ? wed.offChanges() : []), ...toChanges(values, data)]),
  });
  const { form } = settings;
  const values = useFormValues(form);
  // the advanced sheet, open at a tab
  const [advanced, setAdvanced] = useState<TabId>();
  const live = useSqmLive();
  // the checks as they stand: the multi-queue note and the save bar's
  const errors: SqmErrors = formErrors(schema, values);
  // what tc runs against what's saved, once it has lasted past a restart
  const running = live.data === undefined ? [] : shapingProblems(data.queue, live.data.net.qdiscs);
  const problems = useLasting(running.length === 0 ? undefined : running.join('\n'), SETTLE_MS)?.split('\n') ?? [];
  // Hardware offloading forwards connections in the Ethernet's PPE, past CAKE. Software offloading's
  // fast path still goes through the qdiscs, and MilkFlint's kernel keeps CAKE's per-device fairness
  // with it.
  const offloadOn = data.offloading?.hardware === true;
  const advancedWhy =
    data.queue === undefined
      ? 'Turn Smart Queue on and save first.'
      : settings.dirty
        ? 'Save or revert the changes on this page first.'
        : state.phase === 'applying'
          ? 'Saving…'
          : undefined;
  // multi-queue as saved, and why its queues don't spread over the CPUs now
  const saved = data.form;
  const pppoeLine = data.pppoe !== undefined;
  const mqOn = usesMultiQueue(Math.round(Number(saved.downloadMbit) * 1000), saved.multiQueue, pppoeLine);
  const net = live.data?.net;
  // a download queue per CPU: by the RSS rings, or by packet steering (a PPPoE
  // line's, or an Ethernet line's with RSS off: sqm-scripts' XPS)
  const perCpu = net?.queues.some((q) => q.download && q.cpu !== undefined) === true;
  const spreadBy = !mqOn || !perCpu ? undefined : net.rss?.spreading === true ? 'RSS' : 'packet steering';
  const multiQueueText =
    (saved.multiQueue === 'auto'
      ? `Automatic, ${mqOn ? 'on' : 'off'} at this speed (from ${String(multiQueueThresholdKbit(pppoeLine) / 1000)} Mbit/s${pppoeLine ? ' on PPPoE' : ''})`
      : saved.multiQueue === 'on'
        ? 'On'
        : 'Off') + (spreadBy === undefined ? '' : `, a queue per CPU by ${spreadBy}`);
  const rssNote =
    net !== undefined && net.rss?.spreading !== true && !perCpu
      ? `RSS isn’t spreading downloads now, so they all use one queue${net.rps.length > 0 ? `, and packet steering spreads the rest over ${cpuText(net.rps)}` : ''}.`
      : undefined;
  const sheetData = useMemo(
    () => (data.queue === undefined ? undefined : advancedData(data.queue, data.milkflint, data.pppoe !== undefined)),
    [data],
  );
  // the sheet's save: it closes once that went through, and keeps the failure on screen when it didn't
  const submitAdvanced = async (changes: Change[]): Promise<string | undefined> => {
    const end = await apply(changes);
    if (end.phase === 'failed') return end.message;
    setAdvanced(undefined);
    return undefined;
  };

  return (
    <>
      <PageHeader
        title={TITLE}
        description={DESCRIPTION}
        actions={
          <>
            <PowerSwitch
              name="Smart Queue"
              on={values.enabled}
              saved={data.form.enabled}
              onChange={(v) => {
                form.setFieldValue('enabled', v);
              }}
            />
            <AdvancedButton
              why={advancedWhy}
              onClick={() => {
                setAdvanced('down');
              }}
            />
          </>
        }
      />
      {advanced !== undefined && sheetData !== undefined && (
        <AdvancedSheet
          data={sheetData}
          tab={advanced}
          rssNote={rssNote}
          onClose={() => {
            setAdvanced(undefined);
          }}
          onSubmit={submitAdvanced}
        />
      )}
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        <ShapingNow live={live} problems={problems} savedOn={data.form.enabled} />
        {!data.installed && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>SQM isn&apos;t installed</AlertTitle>
            <AlertDescription>
              The sqm-scripts package is missing from this firmware image: install it with apk or in LuCI, or upgrade to a
              MilkFlint image.
            </AlertDescription>
          </Alert>
        )}
        {wed.on && (
          <WedNotice title="Smart Queue is off: hardware offloading (WED) is on" turningOff={values.enabled}>
            {values.enabled
              ? 'Smart Queue and WED can’t both run: the connections WED forwards in hardware never reach a queue.'
              : 'The router’s chip forwards established connections by itself, and they never reach a queue, so Smart Queue was turned off for it. Its settings are kept, and it comes back when WED is turned off; turning it on here turns WED off instead.'}
          </WedNotice>
        )}
        {!wed.on && offloadOn && values.enabled && !values.offloadOff && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Hardware flow offloading bypasses Smart Queue</AlertTitle>
            <AlertDescription>
              Once a connection is offloaded, the Ethernet forwards its packets itself and CAKE never sees them, so shaping
              won&apos;t work. Software offloading is fine with Smart Queue.
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  form.setFieldValue('offloadOff', true);
                }}
              >
                Turn hardware offloading off when I save
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {values.enabled && data.pppoe !== undefined && values.device !== data.pppoe && (
          <Alert variant="warning">
            <TriangleAlertIcon />
            <AlertTitle>Smart Queue shapes the port under PPPoE</AlertTitle>
            <AlertDescription>
              Your internet connection is PPPoE, but Smart Queue shapes {values.device}, where CAKE sees only PPPoE frames and
              can&apos;t read the packets inside them: Fair share per device, ECN marks, the upload ACK filter and priorities
              don&apos;t work there. The session&apos;s own device, {data.pppoe}, carries the same traffic as plain IP packets.
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={() => {
                  if (data.pppoe !== undefined) form.setFieldValue('device', data.pppoe);
                }}
              >
                Shape {data.pppoe} instead
              </Button>
            </AlertDescription>
          </Alert>
        )}
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
          <SettingsCard form={form} values={values} data={data} errors={errors} />
          {live.data !== undefined && (
            <QueuesCard
              live={live.data}
              multiQueue={multiQueueText}
              spread={spreadBy !== undefined}
              rssNote={rssNote}
              advanced={{
                why: advancedWhy,
                open: () => {
                  setAdvanced('down');
                },
              }}
            />
          )}
        </div>
      </div>
      <FormSaveBar settings={{ ...settings, invalid: Object.keys(errors).length > 0 }} busy={state.phase === 'applying'} />
    </>
  );
}
