// One person (or a device on its own) on the Device control page: whether
// their internet is on now and until when, their devices (online or when
// last seen), their week, their times in words, their data today, and the
// two things a parent does most: Pause, and Extra time while they're off.
// Pause and Extra time open their choices in place, as large buttons.
import {
  ChevronRightIcon,
  ClockPlusIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  SquarePenIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { type ReactElement, useEffect, useId, useRef, useState } from 'react';
import { Note } from '@/components/note';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatBytes } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import type { DcDevice } from './api';
import {
  type Clock,
  deviceRuleText,
  type ExtraChoice,
  localParts,
  nextText,
  type PauseChoice,
  scheduleSummary,
  stateText,
} from './model';
import { WeekTimeline } from './timeline';
import type { Entry, EntryState, Span } from './view';

export type Choices = 'pause' | 'extra' | undefined;

function ago(s: number): string {
  if (s < 90) return 'just now';
  if (s < 3600) return `${String(Math.round(s / 60))} min ago`;
  if (s < 86400 * 2) return `${String(Math.round(s / 3600))} h ago`;
  return `${String(Math.round(s / 86400))} days ago`;
}

function badgeOf(st: EntryState): ReactElement {
  if (st.partly) return <Badge variant="warning">Partly off</Badge>;
  switch (st.state.reason) {
    case 'paused':
      return <Badge variant="info">Paused</Badge>;
    case 'always':
    case 'schedule':
      return <Badge variant="warning">Off</Badge>;
    case 'extra':
      return <Badge variant="success">Extra time</Badge>;
    case 'free':
      return <Badge variant="success">On</Badge>;
  }
}

/** The first letter of a name, for the round mark beside it. */
function initial(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?';
}

export function PersonCard({
  entry,
  st,
  spans,
  clock,
  devices,
  seen,
  usage,
  me,
  safeSearch,
  extraOk,
  morning,
  busy,
  open,
  onOpen,
  onEdit,
  onPause,
  onExtra,
  onResume,
}: {
  entry: Entry;
  st: EntryState;
  spans: readonly (readonly Span[])[];
  clock: Clock;
  devices: ReadonlyMap<string, DcDevice>;
  seen: Readonly<Record<string, number>>;
  /** bytes today, received + sent; undefined: not counted */
  usage: number | undefined;
  /** this device's MAC */
  me: string | undefined;
  /** SafeSearch in words, when it's on for them */
  safeSearch: { on: boolean; text: string } | undefined;
  /** extra time can be given now (what's off is their Device control times) */
  extraOk: 'yes' | 'old' | 'no';
  /** "until tomorrow morning" in words: "07:00" */
  morning: string;
  busy: boolean;
  open: Choices;
  onOpen: (c: Choices) => void;
  onEdit: () => void;
  onPause: (c: PauseChoice) => void;
  onExtra: (c: ExtraChoice) => void;
  onResume: () => void;
}): ReactElement {
  const id = useId();
  const choices = useRef<HTMLDivElement>(null);
  const [confirmMe, setConfirmMe] = useState<PauseChoice>();
  const { day, sec } = localParts(clock.now, clock.offset);
  const s = st.state;
  const next = nextText(s, clock);
  const paused = s.reason === 'paused';
  const extra = s.reason === 'extra';
  const mine = me !== undefined && entry.macs.includes(me);
  const windows = entry.own?.windows ?? [];
  const summary = entry.person === undefined ? undefined : scheduleSummary(windows, entry.own?.always === true);

  // the choices take the focus, and Escape closes them, as a menu would
  useEffect(() => {
    if (open === undefined) return;
    const el = choices.current;
    el?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onOpen(undefined);
      setConfirmMe(undefined);
    };
    el?.addEventListener('keydown', onKey);
    return () => {
      el?.removeEventListener('keydown', onKey);
    };
  }, [open, onOpen]);

  const pauseChoices: readonly { value: PauseChoice; label: string }[] = [
    { value: '30m', label: '30 min' },
    { value: '1h', label: '1 hour' },
    { value: 'morning', label: `Until ${morning}` },
    { value: 'resume', label: 'Until I resume' },
  ];
  const extraChoices: readonly { value: ExtraChoice; label: string }[] = [
    { value: '15m', label: '15 min' },
    { value: '30m', label: '30 min' },
    { value: '1h', label: '1 hour' },
    { value: 'next', label: 'Until the next block' },
  ];

  const stateLine = st.partly
    ? `${devices.get(st.mac ?? '')?.name ?? 'One device'}: ${stateText(s, clock).toLowerCase()}`
    : stateText(s, clock);

  return (
    <Card className="gap-0 py-0" aria-labelledby={`${id}-name`}>
      <div className="flex items-start gap-3 px-5 pt-5">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-base font-semibold text-foreground"
        >
          {initial(entry.title)}
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center justify-between gap-3">
            <h2 id={`${id}-name`} className="truncate text-base font-semibold">
              {entry.title}
            </h2>
            {badgeOf(st)}
          </div>
          <p className="text-xl font-semibold tracking-tight tabular" aria-live="polite">
            {stateLine}
          </p>
          {next !== undefined && !st.partly && <p className="text-sm text-muted-foreground tabular">{next}</p>}
        </div>
      </div>

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 px-5 text-sm" aria-label={`${entry.title}’s devices`}>
        {entry.macs.map((m) => {
          const d = devices.get(m);
          const on = d?.online === true;
          const last = seen[m];
          return (
            <li key={m} className="flex min-w-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', on ? 'bg-success' : 'border border-muted-foreground')}
              />
              <span className="truncate">{d?.name ?? m}</span>
              <span className="text-xs text-muted-foreground">
                {on ? 'online' : last !== undefined ? `seen ${ago(last)}` : 'offline'}
                {m === me ? ' · this device' : ''}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 px-5">
        <WeekTimeline spans={spans} today={day} nowSec={sec} label={`${entry.title}’s week: time off is filled in`} />
      </div>

      <div className="mt-3 flex flex-col gap-1 px-5 text-sm">
        {summary !== undefined && <p>{summary}</p>}
        {entry.older.map((r) => (
          <p key={r.section} className="text-muted-foreground">
            {deviceRuleText(r)}
            {entry.person !== undefined && ' (an older rule on the Firewall page)'}
          </p>
        ))}
        {(entry.own?.byHand.length ?? 0) > 0 && (
          <Note tone="warning" icon={<TriangleAlertIcon />}>
            {entry.own?.byHand.length === 1 ? 'One rule was' : `${String(entry.own?.byHand.length)} rules were`} changed on the
            Firewall page, so it’s left as it is there.{' '}
            <a href={href('firewall')} className="link underline-offset-4">
              Firewall
            </a>
          </Note>
        )}
        <p className="text-muted-foreground">
          {usage === undefined ? '' : `${formatBytes(usage)} today`}
          {usage !== undefined && safeSearch !== undefined ? ' · ' : ''}
          {safeSearch !== undefined && (
            <span className="inline-flex items-center gap-1">
              <ShieldCheckIcon className="size-3.5" aria-hidden="true" />
              {safeSearch.text}
            </span>
          )}
        </p>
      </div>

      <div className="mt-4 border-t px-5 py-4">
        {open === undefined ? (
          <div className="flex flex-wrap items-center gap-2">
            {paused || extra ? (
              <Button size="lg" className="h-11 min-w-32 flex-1 sm:flex-none" disabled={busy} onClick={onResume}>
                <PlayIcon /> {paused ? 'Resume' : 'End extra time'}
              </Button>
            ) : (
              <Button
                size="lg"
                className="h-11 min-w-32 flex-1 sm:flex-none"
                disabled={busy || entry.macs.length === 0}
                aria-expanded={false}
                aria-controls={`${id}-choices`}
                onClick={() => {
                  onOpen('pause');
                }}
              >
                <PauseIcon /> Pause
              </Button>
            )}
            {extraOk !== 'no' && st.blocked && !paused && (
              <Button
                size="lg"
                variant="outline"
                className="h-11 min-w-32 flex-1 sm:flex-none"
                disabled={busy}
                aria-expanded={false}
                aria-controls={`${id}-choices`}
                onClick={() => {
                  onOpen('extra');
                }}
              >
                <ClockPlusIcon /> Extra time
              </Button>
            )}
            <Button size="lg" variant="ghost" className="ml-auto h-11" onClick={onEdit} aria-label={`Edit ${entry.title}`}>
              <SquarePenIcon /> Edit
            </Button>
          </div>
        ) : (
          <div
            ref={choices}
            id={`${id}-choices`}
            role="group"
            aria-labelledby={`${id}-choices-title`}
            className="flex flex-col gap-3"
          >
            <p id={`${id}-choices-title`} className="text-sm font-medium">
              {open === 'pause' ? `Pause ${entry.title}’s internet` : `Extra time for ${entry.title}`}
            </p>
            {open === 'extra' && extraOk === 'old' ? (
              <p className="text-sm text-muted-foreground">
                What’s off now is an older rule made on the Firewall page, which extra time can’t lift. Edit it here once and
                Device control takes it over; then extra time works.
              </p>
            ) : confirmMe !== undefined ? (
              <Note tone="warning" icon={<TriangleAlertIcon />} title="That’s the device you’re using">
                Pausing it cuts this page off too, until the pause ends or someone resumes it from another device.
              </Note>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              {open === 'pause'
                ? pauseChoices.map((c) => (
                    <Button
                      key={c.value}
                      size="lg"
                      className="h-11"
                      variant={confirmMe === c.value ? 'destructive' : 'outline'}
                      disabled={busy}
                      onClick={() => {
                        if (mine && confirmMe !== c.value) {
                          setConfirmMe(c.value);
                          return;
                        }
                        setConfirmMe(undefined);
                        onPause(c.value);
                      }}
                    >
                      {confirmMe === c.value ? `Pause anyway` : c.label}
                    </Button>
                  ))
                : extraOk === 'yes'
                  ? extraChoices.map((c) => (
                      <Button
                        key={c.value}
                        size="lg"
                        className="h-11"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          onExtra(c.value);
                        }}
                      >
                        {c.label}
                      </Button>
                    ))
                  : null}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {open === 'extra' && extraOk === 'old' ? (
                <Button variant="outline" onClick={onEdit}>
                  Edit {entry.title} <ChevronRightIcon />
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {open === 'pause' ? 'Open connections end too.' : 'Their times come back by themselves when it ends.'}
                </span>
              )}
              <Button
                variant="ghost"
                onClick={() => {
                  onOpen(undefined);
                  setConfirmMe(undefined);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
