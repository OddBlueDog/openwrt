// The Device control page: when devices may use the internet, a group of
// them (one person's, the games consoles) or a single device. It opens on the
// answer (what's off now and until when, what changes next, what's online),
// then a card for each group and device with its state, its week and the two
// everyday actions, Pause and Extra time. Their
// times are firewall rules (the Firewall page shows the same ones), saved
// through UCI with fw4's check; pause and extra time are set on the router
// at once, with no reload. #/device-control/<mac> opens on that device.
import { ClockAlertIcon, InfoIcon, MonitorSmartphoneIcon, PlusIcon } from 'lucide-react';
import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { PageHeader } from '@/components/layout/page-header';
import { Answer, AnswerCell, Figure, GoLink } from '@/components/page-kit';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type ApplyState, useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import type { Change } from '@/lib/api/uci';
import { formatBytes } from '@/lib/format';
import { href, useSubPath } from '@/lib/router';
import { errorMessage } from '@/lib/utils';
import { ConfirmDialog } from '../firewall/parts';
import {
  clockOf,
  type DcData,
  type DcDevice,
  type DcStatus,
  getStatus,
  giveExtra,
  loadDeviceControl,
  overridesOf,
  pause,
  resume,
  whoAmI,
} from './api';
import {
  atText,
  type Clock,
  deviceRules,
  type ExtraChoice,
  extraUntil,
  morningAfter,
  NO_OVERRIDES,
  type PauseChoice,
  pauseUntil,
  personChanges,
  type PersonForm,
  stateText,
} from './model';
import { type Choices, PersonCard } from './person-card';
import { PersonSheet, type SheetData } from './person-sheet';
import { blockedByOlder, type Entry, entries, entryState, weekSpans } from './view';

type Sheet = { entry: Entry | undefined; kind: 'person' | 'device'; devices?: string[] } | undefined;

/** The router's clock now: its last answer, moved on by the time since (checked every 20 s). */
function useClock(status: DcStatus | undefined, fetched: number): Clock | undefined {
  const [nowMs, setNowMs] = useState(fetched);
  useEffect(() => {
    const t = window.setInterval(() => {
      setNowMs(Date.now());
    }, 20_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);
  if (status === undefined) return undefined;
  const c = clockOf(status);
  return { ...c, now: c.now + Math.max(0, Math.floor((Math.max(nowMs, fetched) - fetched) / 1000)) };
}

/** A name without the bits devices add to it ("Sams-iPhone.lan", "sams iphone"), for spotting the same device. */
function plainName(n: string | undefined): string {
  return (n ?? '')
    .toLowerCase()
    .replace(/\.lan$/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** Clock trouble, in words: not set from the internet, not set yet, or far from this device's clock. */
function clockTrouble(s: DcStatus, fetched: number): string | undefined {
  if (!s.clock.ntp) return 'The router doesn’t set its clock from the internet, so these times follow whatever its clock says.';
  if (s.clock.synced === false) return 'The router hasn’t set its clock from the internet yet, so these times may be off.';
  const drift = Math.abs(s.now - fetched / 1000);
  if (drift > 300)
    return `The router’s clock is ${String(Math.round(drift / 60))} minutes away from this device’s, so these times may be off.`;
  return undefined;
}

export function DeviceControlPage(): ReactElement {
  const sub = useSubPath();
  const { data, error, loading, reload } = useLoad(loadDeviceControl);
  const [fetched, setFetched] = useState(() => Date.now());
  const status = usePoll(
    useCallback(async () => {
      const s = await getStatus();
      setFetched(Date.now());
      return s;
    }, []),
    15_000,
  );
  const who = useLoad(whoAmI);
  const me = who.data?.mac;
  const refreshStatus = status.refresh;
  const onApplied = useCallback(() => {
    reload();
    refreshStatus();
  }, [reload, refreshStatus]);
  const { state: saveState, apply } = useApply(onApplied);
  const [actState, setActState] = useState<ApplyState>({ phase: 'idle' });
  const [lastShown, setLastShown] = useState<'save' | 'act'>('save');
  const [sheet, setSheet] = useState<Sheet>();
  const [deleting, setDeleting] = useState<Entry>();
  const [open, setOpen] = useState<{ key: string; which: Choices }>();
  const [busy, setBusy] = useState(false);
  const clock = useClock(status.data, fetched);

  const deviceMap = useMemo(() => new Map((data?.devices ?? []).map((d) => [d.mac, d])), [data]);
  const deviceName = useCallback((mac: string) => deviceMap.get(mac)?.name, [deviceMap]);
  const list = useMemo(
    () => (data === undefined ? [] : entries(data.fw.cfg, data.fw.sections, data.people, deviceName)),
    [data, deviceName],
  );
  const rules = useMemo(() => (data === undefined ? [] : deviceRules(data.fw.cfg)), [data]);
  const overrides = status.data === undefined ? NO_OVERRIDES : overridesOf(status.data);

  // #/device-control/<mac>: that device's card, or a sheet to set it up (once for each)
  const handled = useRef('');
  const ready = data !== undefined && status.data !== undefined;
  useEffect(() => {
    if (!ready || sub === '' || sub === handled.current) return;
    handled.current = sub;
    const mac = decodeURIComponent(sub).toLowerCase();
    const e = list.find((x) => x.macs.includes(mac) || x.key === mac);
    // after this render, once the cards are drawn (not cancelled by a re-render: it's done once)
    window.setTimeout(() => {
      if (e !== undefined) document.getElementById(`dc-${e.key}`)?.scrollIntoView({ block: 'center' });
      else if (/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) setSheet({ entry: undefined, kind: 'device', devices: [mac] });
    }, 0);
  }, [ready, sub, list]);

  const act = async (what: string, run: () => Promise<void>): Promise<void> => {
    setBusy(true);
    setLastShown('act');
    setActState({ phase: 'applying' });
    try {
      await run();
      setActState({ phase: 'done', nothingChanged: false, note: what });
      setOpen(undefined);
    } catch (err) {
      setActState({ phase: 'failed', message: errorMessage(err) });
    } finally {
      setBusy(false);
      refreshStatus();
    }
  };

  // after a save fw4 loads the rules and sets for a few seconds: no "not ready" warning meanwhile
  const [settling, setSettling] = useState(false);
  const save = (changes: Change[]): void => {
    setSheet(undefined);
    setLastShown('save');
    setSettling(true);
    window.setTimeout(() => {
      setSettling(false);
      refreshStatus();
    }, 20_000);
    void apply(changes);
  };

  const sheetData = (d: DcData, s: DcStatus | undefined): SheetData => ({
    cfg: d.fw.cfg,
    firewall: d.fw.sections,
    milkflint: d.milkflint,
    people: d.people,
    devices: d.devices.map((x) => ({ ...x, seen: s?.seen[x.mac] })),
    guestZones: d.guestZones,
    adguard: s?.adguard.state === 'active' ? 'on' : s?.adguard.installed === true ? 'off' : 'none',
    intercept: d.intercept,
  });

  const shownState = lastShown === 'save' ? saveState : actState;

  return (
    <>
      <PageHeader
        title="Device control"
        description="When your devices may use the internet, one at a time or in groups: bedtimes, school hours, and a pause when it’s time for dinner."
      />
      <div className="flex flex-col gap-4">
        <ApplyStatus state={shownState} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          data !== undefined && (
            <Body
              data={data}
              list={list}
              rules={rules}
              status={status.data}
              settling={settling}
              fetched={fetched}
              clock={clock}
              overrides={overrides}
              deviceMap={deviceMap}
              me={me}
              busy={busy}
              open={open}
              setOpen={setOpen}
              onAdd={(kind, devices) => {
                setSheet({ entry: undefined, kind, ...(devices === undefined ? {} : { devices }) });
              }}
              onEdit={(e) => {
                setSheet({ entry: e, kind: e.person?.name === undefined ? 'device' : 'person' });
              }}
              onAddDevice={(e, mac) => {
                if (e.person === undefined) return;
                const own = e.own;
                const form: PersonForm = {
                  name: e.person.name,
                  devices: [...e.person.devices, mac],
                  windows: own?.windows ?? [],
                  always: own?.always === true,
                  safeSearch: e.person.safeSearch,
                  guest: e.person.guest,
                };
                save(
                  personChanges(e.person.id, form, {
                    cfg: data.fw.cfg,
                    firewall: data.fw.sections,
                    milkflint: data.milkflint,
                    deviceName,
                  }),
                );
              }}
              onPause={(e, choice) => {
                if (clock === undefined) return;
                const until = pauseUntil(choice, e.own?.windows ?? [], clock);
                void act(
                  until === null
                    ? `${e.title} is paused until you resume.`
                    : `${e.title} is paused until ${atText(until, clock)}.`,
                  () => pause(e.macs, until),
                );
              }}
              onExtra={(e, choice, mac) => {
                if (clock === undefined) return;
                const until = extraUntil(choice, mac, rules, clock);
                if (until === undefined) return;
                void act(`${e.title} has extra time until ${atText(until, clock)}.`, () => giveExtra(e.macs, until));
              }}
              onResume={(e) => {
                void act(`The times for ${e.title} apply again.`, () => resume(e.macs));
              }}
            />
          )
        )}
      </div>
      {data !== undefined && sheet !== undefined && (
        <PersonSheet
          data={sheetData(data, status.data)}
          entry={sheet.entry}
          kind={sheet.kind}
          me={me}
          deviceName={deviceName}
          initialDevices={sheet.devices}
          onClose={() => {
            setSheet(undefined);
          }}
          onSave={save}
          onDelete={
            sheet.entry?.person === undefined
              ? undefined
              : () => {
                  setDeleting(sheet.entry);
                  setSheet(undefined);
                }
          }
        />
      )}
      {data !== undefined && deleting?.person !== undefined && (
        <ConfirmDialog
          title={`Delete ${deleting.title}?`}
          action="Delete"
          onClose={() => {
            setDeleting(undefined);
          }}
          onConfirm={() => {
            const p = deleting.person;
            setDeleting(undefined);
            if (p === undefined) return;
            save(
              personChanges(p.id, undefined, {
                cfg: data.fw.cfg,
                firewall: data.fw.sections,
                milkflint: data.milkflint,
                deviceName,
              }),
            );
            // a pause or extra time of theirs ends with them
            if (p.devices.some((m) => overrides.paused.has(m) || overrides.extra.has(m)))
              void resume(p.devices).catch(() => undefined);
          }}
        >
          <span>
            Their times go, from the Firewall page too, and their devices can use the internet. Their devices stay on your
            network.
          </span>
        </ConfirmDialog>
      )}
    </>
  );
}

function Body({
  data,
  list,
  rules,
  status,
  settling,
  fetched,
  clock,
  overrides,
  deviceMap,
  me,
  busy,
  open,
  setOpen,
  onAdd,
  onEdit,
  onAddDevice,
  onPause,
  onExtra,
  onResume,
}: {
  data: DcData;
  list: Entry[];
  rules: ReturnType<typeof deviceRules>;
  status: DcStatus | undefined;
  /** a save was just applied: fw4 may still be loading it */
  settling: boolean;
  fetched: number;
  clock: Clock | undefined;
  overrides: ReturnType<typeof overridesOf>;
  deviceMap: ReadonlyMap<string, DcDevice>;
  me: string | undefined;
  busy: boolean;
  open: { key: string; which: Choices } | undefined;
  setOpen: (o: { key: string; which: Choices } | undefined) => void;
  onAdd: (kind: 'person' | 'device', devices?: string[]) => void;
  onEdit: (e: Entry) => void;
  onAddDevice: (e: Entry, mac: string) => void;
  onPause: (e: Entry, c: PauseChoice) => void;
  onExtra: (e: Entry, c: ExtraChoice, mac: string) => void;
  onResume: (e: Entry) => void;
}): ReactElement {
  const states = clock === undefined ? [] : list.map((e) => ({ e, st: entryState(e, rules, overrides, clock) }));
  const off = states.filter((x) => x.st.blocked || x.st.partly);
  const [first] = off;
  const trouble = status === undefined ? undefined : clockTrouble(status, fetched);

  // devices on Guest Wi-Fi with the same name as one of a person's: likely the same phone, with a new address
  const strays = data.devices.flatMap((d) => {
    if (!d.guest || list.some((e) => e.macs.includes(d.mac))) return [];
    const name = plainName(d.name);
    if (name === '') return [];
    const owner = list.find(
      (e) => e.person?.name !== undefined && e.macs.some((m) => m !== d.mac && plainName(deviceMap.get(m)?.name) === name),
    );
    return owner === undefined ? [] : [{ d, owner }];
  });

  const usageOf = (e: Entry): number | undefined => {
    const t = status?.today;
    if (t === null || t === undefined) return undefined;
    let sum = 0;
    for (const m of e.macs) {
      const v = t.devices[m];
      if (v !== undefined) sum += v[0] + v[1];
    }
    return sum;
  };

  const next = states
    .filter((x) => typeof x.st.state.until === 'number')
    .sort((a, b) => (a.st.state.until ?? 0) - (b.st.state.until ?? 0))[0];
  const nextAt = typeof next?.st.state.until === 'number' ? next.st.state.until : undefined;
  const online = data.devices.filter((d) => d.online).length;
  const peopleDevices = new Set(list.flatMap((e) => e.macs));
  const onlineTheirs = data.devices.filter((d) => d.online && peopleDevices.has(d.mac)).length;
  const usedToday = list.reduce((a, e) => a + (usageOf(e) ?? 0), 0);

  if (list.length === 0) {
    return (
      <>
        {trouble !== undefined && <ClockAlert text={trouble} />}
        <Card className="items-start gap-3 px-6 py-8">
          <span aria-hidden="true" className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
            <MonitorSmartphoneIcon className="size-6" />
          </span>
          <h2 className="text-lg font-semibold">Choose when devices can use the internet</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Put devices in a group (Sam’s iPad, phone and Switch, or the games consoles) so one set of times covers them all, or
            give a single device times of its own: a bedtime, school hours, or off until you say. You can pause them, or give
            extra time, from here or from Home.
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Button
              size="lg"
              className="h-11"
              onClick={() => {
                onAdd('person');
              }}
            >
              <PlusIcon /> Add a group of devices
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-11"
              onClick={() => {
                onAdd('device');
              }}
            >
              <PlusIcon /> Add a single device
            </Button>
          </div>
        </Card>
        <OutOfScope />
      </>
    );
  }

  return (
    <>
      <Answer columns={3} label="Device control now">
        <AnswerCell
          title="Right now"
          value={
            <Figure className="whitespace-normal">
              {clock === undefined
                ? 'Checking…'
                : first === undefined
                  ? 'Every device can use the internet'
                  : `${first.e.title}: ${lowerFirst(stateText(first.st.state, clock))}`}
            </Figure>
          }
        >
          {clock !== undefined && off.length > 1
            ? off
                .slice(1)
                .map((x) => `${x.e.title}: ${lowerFirst(stateText(x.st.state, clock))}`)
                .join(' · ')
            : first === undefined
              ? 'Nothing is paused or in its time off.'
              : 'The rest can use the internet.'}
        </AnswerCell>
        <AnswerCell
          title="Next"
          value={<Figure>{clock === undefined || nextAt === undefined ? 'Nothing due' : atText(nextAt, clock)}</Figure>}
        >
          {next === undefined
            ? 'No times in the coming week.'
            : next.st.blocked
              ? `${next.e.title} can use the internet again.`
              : `Internet goes off for ${next.e.title}.`}
        </AnswerCell>
        <AnswerCell title="Online now" value={<Figure>{`${String(onlineTheirs)} of ${String(peopleDevices.size)}`}</Figure>}>
          Of the devices set up here ({String(online)} on the network in all)
          {status?.today !== null && status?.today !== undefined && usedToday > 0 && `; ${formatBytes(usedToday)} used today`}
          {status?.today !== null &&
          status?.today !== undefined &&
          clock !== undefined &&
          status.today.since > status.today.midnight + 60
            ? ` since ${atText(status.today.since, clock)}`
            : ''}
          .
        </AnswerCell>
      </Answer>

      {trouble !== undefined && <ClockAlert text={trouble} />}
      {status !== undefined && !status.ready && !settling && (
        <Alert variant="warning">
          <ClockAlertIcon />
          <AlertTitle>Pause and extra time aren’t ready</AlertTitle>
          <AlertDescription>
            The firewall hasn’t loaded Device control’s sets. Save a group or a device once, or restart the firewall.
          </AlertDescription>
        </Alert>
      )}
      {strays.map(({ d, owner }) => (
        <Alert key={d.mac} variant="info">
          <InfoIcon />
          <AlertTitle>{d.name ?? d.mac} joined Guest Wi-Fi with a new address</AlertTitle>
          <AlertDescription>
            <span>
              It has the same name as a device in {owner.title}, so it may be the same one with a new private address, and the
              times for {owner.title} don’t cover it yet.
            </span>
            <Button
              variant="outline"
              size="sm"
              className="mt-1"
              disabled={busy}
              onClick={() => {
                onAddDevice(owner, d.mac);
              }}
            >
              Add to {owner.title}
            </Button>
          </AlertDescription>
        </Alert>
      ))}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {clock !== undefined &&
          states.map(({ e, st }) => {
            const mac = st.mac ?? e.macs[0] ?? '';
            const older = blockedByOlder(mac, rules, overrides, clock);
            const safe = e.person?.safeSearch === true ? safeText(status) : undefined;
            return (
              <div key={e.key} id={`dc-${e.key}`} className="min-w-0 scroll-mt-20">
                <PersonCard
                  entry={e}
                  st={st}
                  spans={weekSpans(mac, rules)}
                  clock={clock}
                  devices={deviceMap}
                  seen={status?.seen ?? {}}
                  usage={usageOf(e)}
                  me={me}
                  safeSearch={safe}
                  extraOk={
                    e.person === undefined || older
                      ? 'old'
                      : st.state.reason === 'schedule' || st.state.reason === 'always'
                        ? 'yes'
                        : 'no'
                  }
                  morning={atText(morningAfter(e.own?.windows ?? [], clock), clock)}
                  busy={busy}
                  open={open?.key === e.key ? open.which : undefined}
                  onOpen={(which) => {
                    setOpen(which === undefined ? undefined : { key: e.key, which });
                  }}
                  onEdit={() => {
                    onEdit(e);
                  }}
                  onPause={(c) => {
                    onPause(e, c);
                  }}
                  onExtra={(c) => {
                    onExtra(e, c, mac);
                  }}
                  onResume={() => {
                    onResume(e);
                  }}
                />
              </div>
            );
          })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          className="h-11"
          onClick={() => {
            onAdd('person');
          }}
        >
          <PlusIcon /> Add a group of devices
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-11"
          onClick={() => {
            onAdd('device');
          }}
        >
          <PlusIcon /> Add a single device
        </Button>
      </div>
      <OutOfScope />
    </>
  );
}

const lowerFirst = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

function safeText(s: DcStatus | undefined): { on: boolean; text: string } {
  if (s?.adguard.state === 'active') return { on: true, text: 'SafeSearch on' };
  if (s?.adguard.enabled === true) return { on: false, text: 'SafeSearch waits for AdGuard Home to answer' };
  return { on: false, text: 'SafeSearch needs AdGuard Home' };
}

function ClockAlert({ text }: { text: string }): ReactElement {
  return (
    <Alert variant="warning">
      <ClockAlertIcon />
      <AlertTitle>Check the router’s clock</AlertTitle>
      <AlertDescription>
        <span>{text}</span>
        <GoLink href={href('time')}>Time</GoLink>
      </AlertDescription>
    </Alert>
  );
}

function OutOfScope(): ReactElement {
  return (
    <p className="max-w-prose text-xs text-muted-foreground">
      Device control works on this router’s networks only: it can’t reach mobile data, and it has no daily screen-time limits or
      limits for single apps. Devices stay on your network while their internet is off.
    </p>
  );
}
