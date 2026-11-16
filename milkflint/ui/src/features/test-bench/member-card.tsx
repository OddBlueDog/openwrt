import {
  CheckIcon,
  CrownIcon,
  EthernetPortIcon,
  LaptopIcon,
  PencilIcon,
  SmartphoneIcon,
  TabletIcon,
  UserMinusIcon,
  WifiIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, type SyntheticEvent, useState } from 'react';
import { SignalBars } from '@/components/charts/signal-bars';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatNumber } from '@/lib/format';
import { errorMessage } from '@/lib/utils';
import type { Link, Member } from './api';
import { Arrowed, Dir } from './dir';
import { presence } from './summary';
import { agentText, parseAgent } from './ua';

/** "5 GHz · ch 44 · 80 MHz" */
function wifiText(l: Link): string {
  const parts = [
    l.band === undefined || l.band === null ? undefined : `${l.band} GHz`,
    l.channel === undefined || l.channel === null ? undefined : `ch ${String(l.channel)}`,
    l.width === undefined || l.width === null ? undefined : `${String(l.width)} MHz`,
  ];
  const text = parts.filter((p) => p !== undefined).join(' · ');
  return text === '' ? 'Wi-Fi' : text;
}

const mbit = (v: number | null | undefined): string => (v === undefined || v === null ? '—' : formatNumber(v, v < 100 ? 1 : 0));

export function LinkLine({ link }: { link: Link | null | undefined }): ReactElement {
  if (link === undefined || link === null) {
    return <span className="text-muted-foreground">Link not known</span>;
  }
  if (link.kind === 'wired') {
    const speed =
      link.speed === undefined || link.speed === null
        ? undefined
        : link.speed >= 1000
          ? `${formatNumber(link.speed / 1000, 1)} Gbit/s`
          : `${String(link.speed)} Mbit/s`;
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <EthernetPortIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">
          Wired · {link.port ?? link.dev ?? 'port not known'}
          {speed !== undefined && ` · ${speed}`}
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <WifiIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{wifiText(link)}</span>
        {link.generation !== undefined && link.generation !== null && (
          <span className="shrink-0 text-muted-foreground">· Wi-Fi {link.generation}</span>
        )}
      </span>
      {link.signal !== undefined && link.signal !== null && (
        <span className="inline-flex flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <SignalBars dbm={link.signal} className="ml-0.5" />
          {/* the router's send rate is the device's download */}
          <span className="inline-flex items-center gap-1 tabular">
            {link.signal} dBm · <Dir d="down" /> {mbit(link.tx_mbit)} <Dir d="up" /> {mbit(link.rx_mbit)} Mbit/s
          </span>
        </span>
      )}
    </span>
  );
}

function DeviceIcon({ ua }: { ua: string | null | undefined }): ReactElement {
  const a = parseAgent(ua);
  const Icon = a.device === 'phone' ? SmartphoneIcon : a.device === 'tablet' ? TabletIcon : LaptopIcon;
  return <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** Whether the device is there and its page in front, in a word. */
function Presence({ m }: { m: Member }): ReactElement {
  const p = presence(m);
  if (p === 'away') return <Badge variant="warning">Away · {formatNumber(m.seen_ms / 1000)} s</Badge>;
  if (p === 'hidden') return <Badge variant="warning">Page hidden</Badge>;
  return <Badge variant="success">Ready</Badge>;
}

function NameEditor({
  name,
  onSave,
  onCancel,
}: {
  name: string;
  onSave: (name: string) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const [value, setValue] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (e: SyntheticEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(value.trim());
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex items-center gap-1">
        <Input
          aria-label="Name"
          value={value}
          maxLength={32}
          className="h-8 min-w-0"
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button
          type="submit"
          size="icon"
          variant="ghost"
          className="size-8"
          disabled={busy || value.trim() === ''}
          aria-label="Save the name"
        >
          <CheckIcon />
        </Button>
        <Button type="button" size="icon" variant="ghost" className="size-8" onClick={onCancel} aria-label="Keep the name">
          <XIcon />
        </Button>
      </div>
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </form>
  );
}

export interface MemberActions {
  rename?: (name: string) => Promise<void>;
  makeCoordinator?: () => Promise<void>;
  remove?: () => Promise<void>;
}

export interface MemberEntry {
  m: Member;
  me: boolean;
  coordinator: boolean;
  /** what it's doing in the run, when one is on */
  phaseLabel: string | undefined;
  actions: MemberActions;
}

/** A member's row state: renaming, and an action under way or failed. */
function useRow(): {
  editing: boolean;
  setEditing: (v: boolean) => void;
  busy: boolean;
  error: string | undefined;
  act: (f: (() => Promise<void>) | undefined) => Promise<void>;
} {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const act = async (f: (() => Promise<void>) | undefined): Promise<void> => {
    if (f === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await f();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return { editing, setEditing, busy, error, act };
}

/** You and Coordinator, as marks beside a device. */
function Marks({ e }: { e: MemberEntry }): ReactElement | null {
  if (!e.me && !e.coordinator) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {e.me && <Badge variant="secondary">You</Badge>}
      {e.coordinator && (
        <Badge variant="outline">
          <CrownIcon /> Coordinator
        </Badge>
      )}
    </span>
  );
}

/** The device's name (renamed in place) and its browser, with its address when `ip`; `marks` beside the name. */
function NameBlock({
  e,
  editing,
  setEditing,
  marks,
  ip,
}: {
  e: MemberEntry;
  editing: boolean;
  setEditing: (v: boolean) => void;
  marks: boolean;
  ip: boolean;
}): ReactElement {
  const { m, actions } = e;
  const rename = actions.rename;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-2.5">
      <DeviceIcon ua={m.ua} />
      {editing && rename !== undefined ? (
        <NameEditor
          name={m.name}
          onSave={async (name) => {
            await rename(name);
            setEditing(false);
          }}
          onCancel={() => {
            setEditing(false);
          }}
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
            <span className="truncate font-medium">{m.name}</span>
            {rename !== undefined && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-6 text-muted-foreground"
                aria-label={`Rename ${m.name}`}
                onClick={() => {
                  setEditing(true);
                }}
              >
                <PencilIcon className="size-3" />
              </Button>
            )}
            {marks && <Marks e={e} />}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {agentText(parseAgent(m.ua))}
            {ip && <span className="font-mono"> · {m.ip}</span>}
          </span>
        </div>
      )}
    </div>
  );
}

const clockText = (m: Member): string =>
  m.clock_us === undefined || m.clock_us === null
    ? 'not synced yet'
    : `±${formatNumber(m.clock_us / 1000, m.clock_us < 10_000 ? 1 : 0)} ms`;

/** A device as a table row, on a wide screen. */
function MemberTableRow({ e }: { e: MemberEntry }): ReactElement {
  const { m, actions } = e;
  const row = useRow();
  return (
    <TableRow className={e.me ? 'bg-primary-subtle/40 hover:bg-primary-subtle/40' : undefined}>
      <TableCell className="min-w-48 whitespace-normal">
        <NameBlock e={e} editing={row.editing} setEditing={row.setEditing} marks ip />
        {row.error !== undefined && <p className="mt-1 text-xs text-destructive">{row.error}</p>}
      </TableCell>
      <TableCell className="max-w-72 text-xs whitespace-normal">
        <LinkLine link={m.link} />
      </TableCell>
      <TableCell className="text-xs text-muted-foreground tabular">{clockText(m)}</TableCell>
      <TableCell className="whitespace-normal">
        <div className="flex flex-col items-start gap-1">
          <Presence m={m} />
          {e.phaseLabel !== undefined && (
            <span className="text-xs font-medium">
              <Arrowed text={e.phaseLabel} />
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          {actions.makeCoordinator !== undefined && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label={`Make ${m.name} the coordinator`}
              title={`Make ${m.name} the coordinator`}
              disabled={row.busy}
              onClick={() => void row.act(actions.makeCoordinator)}
            >
              <CrownIcon />
            </Button>
          )}
          {actions.remove !== undefined && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8 text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${m.name} from the bench`}
              title={`Remove ${m.name} from the bench`}
              disabled={row.busy}
              onClick={() => void row.act(actions.remove)}
            >
              <UserMinusIcon />
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

/** A device as stacked lines, on a phone. */
function MemberListItem({ e }: { e: MemberEntry }): ReactElement {
  const { m, actions } = e;
  const row = useRow();
  return (
    <li className="flex flex-col gap-2 px-5 py-3">
      <NameBlock e={e} editing={row.editing} setEditing={row.setEditing} marks={false} ip={false} />
      <div className="flex flex-wrap items-center gap-1.5 pl-6.5">
        <Presence m={m} />
        <Marks e={e} />
      </div>
      <div className="flex flex-col gap-1 pl-6.5 text-xs">
        <LinkLine link={m.link} />
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-muted-foreground">
          <span className="font-mono">{m.ip}</span>
          <span className="tabular">Clock {clockText(m)}</span>
        </span>
        {e.phaseLabel !== undefined && (
          <span className="font-medium">
            <Arrowed text={e.phaseLabel} />
          </span>
        )}
      </div>
      {(actions.makeCoordinator !== undefined || actions.remove !== undefined) && (
        <div className="flex flex-wrap gap-2 pl-6.5">
          {actions.makeCoordinator !== undefined && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={row.busy}
              onClick={() => void row.act(actions.makeCoordinator)}
            >
              <CrownIcon /> Make coordinator
            </Button>
          )}
          {actions.remove !== undefined && (
            <Button type="button" size="sm" variant="ghost" disabled={row.busy} onClick={() => void row.act(actions.remove)}>
              <UserMinusIcon /> Remove
            </Button>
          )}
        </div>
      )}
      {row.error !== undefined && <p className="pl-6.5 text-xs text-destructive">{row.error}</p>}
    </li>
  );
}

/** The bench's devices: name, browser, how it's connected, its address, clock and state. A table on a wide screen, stacked rows on a phone. */
export function MemberList({ entries }: { entries: readonly MemberEntry[] }): ReactElement {
  return (
    <>
      <div className="hidden lg:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Device</TableHead>
              <TableHead>Connected</TableHead>
              <TableHead>Clock</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <MemberTableRow key={e.m.id} e={e} />
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="divide-y border-t lg:hidden">
        {entries.map((e) => (
          <MemberListItem key={e.m.id} e={e} />
        ))}
      </ul>
    </>
  );
}
