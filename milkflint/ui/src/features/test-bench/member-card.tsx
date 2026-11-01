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
import { formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import type { Link, Member } from './api';
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
    const speed = link.speed === undefined || link.speed === null ? undefined : link.speed >= 1000 ? `${formatNumber(link.speed / 1000, 1)} Gbit/s` : `${String(link.speed)} Mbit/s`;
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <EthernetPortIcon className="size-3.5 shrink-0 text-chart-3" />
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
        <WifiIcon className="size-3.5 shrink-0 text-chart-4" />
        <span className="truncate">{wifiText(link)}</span>
        {link.generation !== undefined && link.generation !== null && <span className="text-muted-foreground">· Wi-Fi {link.generation}</span>}
      </span>
      {link.signal !== undefined && link.signal !== null && (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <SignalBars dbm={link.signal} className="ml-0.5" />
          {/* the router's send rate is the device's download */}
          <span className="tabular">
            {link.signal} dBm · ↓{mbit(link.tx_mbit)} ↑{mbit(link.rx_mbit)} Mbit/s
          </span>
        </span>
      )}
    </span>
  );
}

function DeviceIcon({ ua }: { ua: string | null | undefined }): ReactElement {
  const a = parseAgent(ua);
  const Icon = a.device === 'phone' ? SmartphoneIcon : a.device === 'tablet' ? TabletIcon : LaptopIcon;
  return (
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      <Icon className="size-4" />
    </div>
  );
}

function Presence({ m }: { m: Member }): ReactElement {
  if (m.seen_ms > 15_000) {
    return (
      <span className="inline-flex items-center gap-1.5 text-warning">
        <span className="size-2 rounded-full bg-warning" /> Away · {formatNumber(m.seen_ms / 1000)} s
      </span>
    );
  }
  if (m.visible === false) {
    return (
      <span className="inline-flex items-center gap-1.5 text-warning">
        <span className="size-2 rounded-full bg-warning" /> Page in the background
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2 rounded-full bg-success" /> Ready
    </span>
  );
}

function NameEditor({ name, onSave, onCancel }: { name: string; onSave: (name: string) => Promise<void>; onCancel: () => void }): ReactElement {
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
          className="h-8"
          onChange={(e) => {
            setValue(e.target.value);
          }}
        />
        <Button type="submit" size="icon" variant="ghost" className="size-8" disabled={busy || value.trim() === ''} aria-label="Save the name">
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

/** A member of the bench: name, browser, address and how it's connected. */
export function MemberCard({
  m,
  me,
  coordinator,
  phaseLabel,
  actions,
}: {
  m: Member;
  me: boolean;
  coordinator: boolean;
  /** what it's doing in the run, when one is on */
  phaseLabel: string | undefined;
  actions: MemberActions;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const agent = parseAgent(m.ua);
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
  const rename = actions.rename;
  return (
    <div className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4', me && 'border-primary/40 ring-1 ring-primary/15')}>
      <div className="flex items-start gap-3">
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
            <div className="flex min-w-0 items-center gap-1.5">
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
            </div>
            <span className="truncate text-xs text-muted-foreground">{agentText(agent)}</span>
          </div>
        )}
        <div className="flex shrink-0 flex-col items-end gap-1">
          {me && <Badge variant="secondary">You</Badge>}
          {coordinator && (
            <Badge variant="outline" className="gap-1">
              <CrownIcon className="text-chart-4" /> Coordinator
            </Badge>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 border-t pt-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-muted-foreground">{m.ip}</span>
          <Presence m={m} />
        </div>
        <LinkLine link={m.link} />
        <div className="flex items-center justify-between gap-3 text-muted-foreground">
          <span className="tabular">
            Clock {m.clock_us === undefined || m.clock_us === null ? 'not synced yet' : `±${formatNumber(m.clock_us / 1000, m.clock_us < 10_000 ? 1 : 0)} ms`}
          </span>
          {phaseLabel !== undefined && <span className="truncate font-medium text-foreground">{phaseLabel}</span>}
        </div>
      </div>
      {(actions.makeCoordinator !== undefined || actions.remove !== undefined) && (
        <div className="flex flex-wrap gap-2">
          {actions.makeCoordinator !== undefined && (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void act(actions.makeCoordinator)}>
              <CrownIcon /> Make coordinator
            </Button>
          )}
          {actions.remove !== undefined && (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void act(actions.remove)}>
              <UserMinusIcon /> Remove
            </Button>
          )}
        </div>
      )}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
