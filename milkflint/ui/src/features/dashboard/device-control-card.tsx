// Device control on Home: each person's state now (off until 07:00, paused
// until 19:30, on) with Pause, or Resume, beside it. Pause offers its four
// lengths in place. It reads the people and their rules once and the
// router's pause and clock every 15 s, while it's on Home; two of them share
// the calls.
import { PauseIcon, PlayIcon, XIcon } from 'lucide-react';
import { type ReactElement, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { getHostHints, hintName } from '@/lib/api/network';
import { getConfig, type Section } from '@/lib/api/uci';
import { href } from '@/lib/router';
import { sharedCall } from '@/lib/shared-call';
import { cn, errorMessage } from '@/lib/utils';
import { clockOf, getStatus, overridesOf, pause, resume } from '../device-control/api';
import { atText, deviceRules, morningAfter, type PauseChoice, pauseUntil, parsePeople, stateText } from '../device-control/model';
import { entries, entryState } from '../device-control/view';
import { parseFirewall } from '../firewall/model';
import { EMPTY_GOES } from './fit';
import { Dot, OffNote, Widget, WidgetLink } from './widget';

const loadPeople = sharedCall(async () => {
  const [firewall, milkflint, hints] = await Promise.all([
    getConfig('firewall'),
    getConfig('milkflint').catch((): Section[] => []),
    getHostHints().catch(() => ({})),
  ]);
  const names = new Map(Object.entries(hints).map(([mac, h]) => [mac.toLowerCase(), hintName(h)]));
  const cfg = parseFirewall(firewall, milkflint);
  const name = (mac: string): string | undefined => names.get(mac);
  return { list: entries(cfg, firewall, parsePeople(milkflint), name), rules: deviceRules(cfg) };
});
const loadStatus = sharedCall(getStatus);

const CHOICES: readonly { value: PauseChoice; label: string }[] = [
  { value: '30m', label: '30 min' },
  { value: '1h', label: '1 hour' },
  { value: 'morning', label: 'Morning' },
  { value: 'resume', label: 'Until I resume' },
];

export function DeviceControlCard(): ReactElement {
  const people = useLoad(loadPeople);
  const status = usePoll(loadStatus, 15_000);
  const [choosing, setChoosing] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const refresh = status.refresh;
  const run = useCallback(
    async (job: () => Promise<void>) => {
      setBusy(true);
      setError(undefined);
      try {
        await job();
        setChoosing(undefined);
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setBusy(false);
        refresh();
      }
    },
    [refresh],
  );
  const link = <WidgetLink href={href('device-control')}>Device control</WidgetLink>;

  if (people.data === undefined || status.data === undefined) {
    return (
      <Widget aside={link}>
        <OffNote action={null}>
          {people.error !== undefined || status.error !== undefined ? 'Device control didn’t load.' : 'Reading Device control…'}
        </OffNote>
      </Widget>
    );
  }
  const { list, rules } = people.data;
  if (list.length === 0) {
    return (
      <Widget>
        <OffNote action={<WidgetLink href={href('device-control')}>Set times for devices</WidgetLink>}>
          A bedtime, school hours and a pause, for a group of devices or a single one.
        </OffNote>
      </Widget>
    );
  }
  const clock = clockOf(status.data);
  const o = overridesOf(status.data);
  const rows = list.map((e) => ({ e, st: entryState(e, rules, o, clock) }));
  const off = rows.filter((r) => r.st.blocked).length;
  const picked = rows.find((r) => r.e.key === choosing);

  return (
    <Widget status={off === 0 ? 'All on' : `${String(off)} off now`} aside={link}>
      {picked !== undefined ? (
        <div className="flex flex-col gap-2 px-5" role="group" aria-label={`Pause ${picked.e.title}`}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">Pause {picked.e.title}</span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Cancel"
              onClick={() => {
                setChoosing(undefined);
              }}
            >
              <XIcon />
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {CHOICES.map((c) => {
              const until = pauseUntil(c.value, picked.e.own?.windows ?? [], clock);
              return (
                <Button
                  key={c.value}
                  variant="outline"
                  className="h-10"
                  disabled={busy}
                  onClick={() => {
                    void run(() => pause(picked.e.macs, until));
                  }}
                >
                  {c.value === 'morning' ? `Until ${atText(morningAfter(picked.e.own?.windows ?? [], clock), clock)}` : c.label}
                </Button>
              );
            })}
          </div>
        </div>
      ) : (
        <ul className={cn('mt-auto flex flex-col divide-y px-5', EMPTY_GOES)} aria-label="People">
          {rows.map(({ e, st }) => {
            const paused = st.state.reason === 'paused';
            return (
              <li key={e.key} data-fit className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <span className="flex min-w-0 items-center gap-2">
                  <Dot tone={st.blocked ? (paused ? 'info' : 'warning') : 'success'} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-medium">{e.title}</span>
                    <span className="truncate text-xs text-muted-foreground tabular">{stateText(st.state, clock)}</span>
                  </span>
                </span>
                {paused ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={busy}
                    aria-label={`Resume ${e.title}`}
                    onClick={() => {
                      void run(() => resume(e.macs));
                    }}
                  >
                    <PlayIcon /> Resume
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 shrink-0"
                    disabled={busy}
                    aria-label={`Pause ${e.title}`}
                    onClick={() => {
                      setChoosing(e.key);
                    }}
                  >
                    <PauseIcon /> Pause
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {error !== undefined && (
        <p role="alert" className="px-5 text-xs text-destructive">
          {error}
        </p>
      )}
    </Widget>
  );
}
