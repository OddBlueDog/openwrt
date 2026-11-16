// The Smart Queue page: SQM with CAKE on the internet connection. It opens on
// the answer (whether the line is shaped, at what speeds, and how long
// packets wait in CAKE, every 2 s), or, while it's off, on what it does and
// how to set it up. The line's speeds and connection type come next, the
// rest under More settings, and everything sqm-scripts and CAKE take in the
// advanced sheet. How the queues sit on the CPUs is at the bottom.
import { SlidersHorizontalIcon, TriangleAlertIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { getDevices, getInterfaces } from '@/lib/api/network';
import { getConfig } from '@/lib/api/uci';
import { cpuText } from '@/lib/network-text';
import { cn } from '@/lib/utils';
import { useWed } from '../tuning/use-wed';
import { WedNotice } from '../tuning/wed-notice';
import { advancedData } from './advanced';
import { AdvancedSheet, type TabId } from './advanced-sheet';
import { ShapingNow } from './answer';
import { useSqmLive } from './live';
import { type SqmData, type SqmErrors, type SqmForm, sqmData, toChanges, validate } from './model';
import { usesMultiQueue } from './multi-queue';
import { PowerSwitch } from '@/components/power-switch';
import { QueuesCard } from './queues';
import { shapingProblems } from './running';
import { SettingsCard } from './settings';

async function loadSqm(): Promise<SqmData> {
  const [sqm, firewall, interfaces, devices, milkflint] = await Promise.all([
    getConfig('sqm').catch(() => undefined),
    getConfig('firewall'),
    getInterfaces(),
    getDevices(),
    getConfig('milkflint').catch(() => undefined),
  ]);
  const wan = interfaces.find((i) => i.interface === 'wan');
  return sqmData({
    sqm,
    firewall,
    milkflint,
    wanDevice: wan?.l3_device ?? wan?.device,
    wanProto: wan?.proto,
    devices: Object.keys(devices),
  });
}

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
  const { data, error, loading, reload } = useLoad(loadSqm);
  const [edit, setEdit] = useState<SqmForm>();
  // hardware offloading with WED turns Smart Queue off; turning it on here turns WED off
  const wed = useWed();
  const reloadWed = wed.reload;
  const onApplied = useCallback(() => {
    setEdit(undefined);
    reload();
    reloadWed();
  }, [reload, reloadWed]);
  const { state, apply } = useApply(onApplied);
  // the advanced sheet, open at a tab
  const [advanced, setAdvanced] = useState<TabId>();
  const live = useSqmLive();
  const form = edit ?? data?.form;
  const errors: SqmErrors = form === undefined || data === undefined ? {} : validate(form, data);
  // what tc runs against what's saved, once it has lasted past a restart
  const running = live.data === undefined || data === undefined ? [] : shapingProblems(data.queue, live.data.net.qdiscs);
  const problems = useLasting(running.length === 0 ? undefined : running.join('\n'), SETTLE_MS)?.split('\n') ?? [];
  // Functional update: several edits in one render can't overwrite each other.
  const set = <K extends keyof SqmForm>(key: K, value: SqmForm[K]): void => {
    setEdit((current) => {
      const base = current ?? data?.form;
      return base === undefined ? undefined : { ...base, [key]: value };
    });
  };
  const dirty = edit !== undefined && JSON.stringify(edit) !== JSON.stringify(data?.form);
  // Hardware offloading forwards connections in the Ethernet's PPE, past CAKE. Software offloading's
  // fast path still goes through the qdiscs, and MilkFlint's kernel keeps CAKE's per-device fairness
  // with it.
  const offloadOn = data?.offloading?.hardware === true;
  const advancedWhy =
    data === undefined
      ? 'Loading…'
      : data.queue === undefined
        ? 'Turn Smart Queue on and save first.'
        : dirty
          ? 'Save or revert the changes on this page first.'
          : state.phase === 'applying'
            ? 'Saving…'
            : undefined;
  // multi-queue as saved, and why its queues don't spread over the CPUs now
  const saved = data?.form;
  const mqOn = saved !== undefined && usesMultiQueue(Math.round(Number(saved.downloadMbit) * 1000), saved.multiQueue);
  const multiQueueText =
    saved === undefined
      ? '—'
      : saved.multiQueue === 'auto'
        ? `Automatic, ${mqOn ? 'on' : 'off'} at this speed`
        : saved.multiQueue === 'on'
          ? 'On'
          : 'Off';
  const net = live.data?.net;
  const rssNote =
    net !== undefined && net.rss?.spreading !== true
      ? `RSS isn’t spreading downloads now, so they all use one queue${net.rps.length > 0 ? `, and packet steering spreads the rest over ${cpuText(net.rps)}` : ''}.`
      : undefined;

  return (
    <>
      <PageHeader
        title="Smart Queue"
        description="Keeps latency low when the line is busy, by shaping traffic just below your line’s speed (SQM with CAKE)."
        actions={
          <>
            {form !== undefined && (
              <PowerSwitch
                name="Smart Queue"
                on={form.enabled}
                saved={data?.form.enabled}
                onChange={(v) => {
                  set('enabled', v);
                }}
              />
            )}
            <AdvancedButton
              why={advancedWhy}
              onClick={() => {
                setAdvanced('down');
              }}
            />
          </>
        }
      />
      {advanced !== undefined && data?.queue !== undefined && (
        <AdvancedSheet
          data={advancedData(data.queue, data.milkflint)}
          tab={advanced}
          rssNote={rssNote}
          onClose={() => {
            setAdvanced(undefined);
          }}
          onSave={(changes) => {
            setAdvanced(undefined);
            void apply(changes);
          }}
        />
      )}
      <div className="flex flex-col gap-4">
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading || form === undefined || data === undefined ? (
          <FormSkeleton />
        ) : (
          <>
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
              <WedNotice title="Smart Queue is off: hardware offloading (WED) is on" turningOff={form.enabled}>
                {form.enabled
                  ? 'Smart Queue and WED can’t both run: the connections WED forwards in hardware never reach a queue.'
                  : 'The router’s chip forwards established connections by itself, and they never reach a queue, so Smart Queue was turned off for it. Its settings are kept, and it comes back when WED is turned off; turning it on here turns WED off instead.'}
              </WedNotice>
            )}
            {!wed.on && offloadOn && form.enabled && !form.offloadOff && (
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
                      set('offloadOff', true);
                    }}
                  >
                    Turn hardware offloading off when I save
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {form.enabled && data.pppoe !== undefined && form.device !== data.pppoe && (
              <Alert variant="warning">
                <TriangleAlertIcon />
                <AlertTitle>Smart Queue shapes the port under PPPoE</AlertTitle>
                <AlertDescription>
                  Your internet connection is PPPoE, but Smart Queue shapes {form.device}, where CAKE sees only PPPoE frames and
                  can&apos;t read the packets inside them: Fair share per device, ECN marks, the upload ACK filter and priorities
                  don&apos;t work there. The session&apos;s own device, {data.pppoe}, carries the same traffic as plain IP
                  packets.
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      if (data.pppoe !== undefined) set('device', data.pppoe);
                    }}
                  >
                    Shape {data.pppoe} instead
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
              <SettingsCard form={form} data={data} errors={errors} set={set} />
              {live.data !== undefined && (
                <QueuesCard
                  live={live.data}
                  multiQueue={multiQueueText}
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
          </>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={Object.keys(errors).length > 0}
        onSave={() => {
          if (form === undefined || data === undefined) return;
          // Smart Queue on is WED off: its changes first, so this page's own stand
          void apply([...(wed.on && form.enabled ? wed.offChanges() : []), ...toChanges(form, data)]);
        }}
        onRevert={() => {
          setEdit(undefined);
        }}
      />
    </>
  );
}
