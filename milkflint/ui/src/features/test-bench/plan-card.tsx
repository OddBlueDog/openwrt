import { InfoIcon, LoaderCircleIcon, PlayIcon } from 'lucide-react';
import { type ReactElement, useEffect, useMemo, useState } from 'react';
import { CardHeading } from '@/components/card-heading';
import { Note } from '@/components/note';
import { NumberInput } from '@/components/number-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import type { Member, Options, Phase, Poll, ScheduleRequest } from './api';
import { Arrowed } from '@/components/dir';
import { clockText, phaseRoles, phaseStyle } from './phases';
import {
  buildPlan,
  type CustomPlan,
  dataEstimate,
  defaultBudget,
  MAX_BUDGET_MB,
  MAX_PHASE_S,
  MAX_RUN_NAME,
  MIN_BUDGET_MB,
  MIN_PHASE_S,
  planMembers,
  type PresetId,
  presets,
  runName,
  scheduleLength,
  usesInternet,
} from './plans';
import { MAX_CUSTOM_SITES, parseSites, SITES } from './pages';
import { planChoices } from './plan-memory';
import { latencyTargets } from './probes';

/** The phases one after another, as wide as they last. */
export function PhaseStrip({ phases, className }: { phases: readonly Phase[]; className?: string }): ReactElement {
  const total = Math.max(1, scheduleLength({ phases }));
  return (
    <div className={cn('flex h-2.5 w-full gap-px overflow-hidden rounded-full bg-muted', className)} aria-hidden="true">
      {phases.map((p, i) => (
        <div key={i} className={cn('h-full', phaseStyle[p.kind].bar)} style={{ width: `${String((p.dur / total) * 100)}%` }} />
      ))}
    </div>
  );
}

// a setting as a row with a hairline under it, two to a line on a wider screen
const gridClass = 'grid border-t sm:grid-cols-2 sm:gap-x-8';
const rowClass = 'flex min-h-11 items-center justify-between gap-3 border-b py-1.5';

function PresetPicker({ value, onChange }: { value: PresetId; onChange: (p: PresetId) => void }): ReactElement {
  return (
    <div
      role="group"
      aria-label="Plan"
      className="grid grid-cols-2 gap-0.5 rounded-md border p-0.5 sm:inline-grid sm:w-fit sm:grid-cols-4"
    >
      {presets.map((p) => (
        <Button
          key={p.id}
          type="button"
          size="sm"
          variant={value === p.id ? 'secondary' : 'ghost'}
          className="h-7 px-3"
          aria-pressed={value === p.id}
          onClick={() => {
            onChange(p.id);
          }}
        >
          {p.title}
        </Button>
      ))}
    </div>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): ReactElement {
  return (
    <div className={rowClass}>
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function Seconds({
  id,
  label,
  value,
  min,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  onChange: (v: number) => void;
}): ReactElement {
  return (
    <div className={rowClass}>
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <NumberInput
          id={id}
          min={min}
          max={MAX_PHASE_S}
          integer
          value={value}
          className="h-7 w-16 text-right tabular"
          onChange={onChange}
        />
        <span className="text-xs text-muted-foreground">s</span>
      </div>
    </div>
  );
}

function CustomOptions({ c, onChange }: { c: CustomPlan; onChange: (c: CustomPlan) => void }): ReactElement {
  const set = <K extends keyof CustomPlan>(k: K, v: CustomPlan[K]): void => {
    onChange({ ...c, [k]: v });
  };
  return (
    <div className={gridClass}>
      <Seconds
        id="tb-idle"
        label="Idle first"
        value={c.idleS}
        min={0}
        onChange={(v) => {
          set('idleS', v);
        }}
      />
      <Seconds
        id="tb-load"
        label="Each load"
        value={c.loadS}
        min={MIN_PHASE_S}
        onChange={(v) => {
          set('loadS', v);
        }}
      />
      <Toggle
        id="tb-down"
        label="Download"
        checked={c.download}
        onChange={(v) => {
          set('download', v);
        }}
      />
      <Toggle
        id="tb-up"
        label="Upload"
        checked={c.upload}
        onChange={(v) => {
          set('upload', v);
        }}
      />
      <Toggle
        id="tb-both"
        label="Both ways at once"
        checked={c.both}
        onChange={(v) => {
          set('both', v);
        }}
      />
      <Toggle
        id="tb-everyone"
        label="Everyone downloads"
        checked={c.everyone}
        onChange={(v) => {
          set('everyone', v);
        }}
      />
      <Toggle
        id="tb-d2d"
        label="Device to device"
        checked={c.d2d}
        onChange={(v) => {
          set('d2d', v);
        }}
      />
      <Toggle
        id="tb-dns"
        label="DNS and pages"
        checked={c.dns}
        onChange={(v) => {
          set('dns', v);
        }}
      />
      <Toggle
        id="tb-household"
        label="Busy household"
        checked={c.household}
        onChange={(v) => {
          set('household', v);
        }}
      />
    </div>
  );
}

type Shaper = NonNullable<Poll['bench']['shaper']>;

/** "1,234 MB", "2.5 GB" */
function mb(v: number): string {
  return v >= 1000 ? `${formatNumber(v / 1000, 1)} GB` : `${formatNumber(v)} MB`;
}

/** The plan's own sites for DNS and page loads, besides the fixed list: host names, checked as they're typed. */
function SitesField({ sites, onSites }: { sites: readonly string[]; onSites: (s: string[]) => void }): ReactElement {
  const [text, setText] = useState(sites.join(', '));
  const parsed = parseSites(text);
  const over = parsed.over;
  return (
    <div className="flex flex-col gap-1.5 border-b py-2.5 sm:col-span-2">
      <Label htmlFor="tb-sites" className="font-normal">
        More sites for DNS and pages
      </Label>
      <Input
        id="tb-sites"
        value={text}
        placeholder="example.org, news.example.com"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          onSites(parseSites(e.target.value).sites);
        }}
      />
      <span className={cn('text-xs', parsed.bad.length > 0 || over ? 'text-warning' : 'text-muted-foreground')}>
        {parsed.bad.length > 0
          ? `Not a site's name, left out: ${parsed.bad.join(', ')}`
          : over
            ? `At most ${String(MAX_CUSTOM_SITES)}: the first ${String(MAX_CUSTOM_SITES)} are used.`
            : `Besides ${SITES.map((x) => x.site).join(', ')}. Devices load each one's icon, and the router looks up its name.`}
      </span>
    </div>
  );
}

function Settings({
  dry,
  options,
  estimate,
  wan,
  pages,
  onDry,
  onOptions,
}: {
  dry: boolean;
  options: Options;
  estimate: { down: number; up: number } | undefined;
  /** the plan loads the internet line */
  wan: boolean;
  /** the plan has DNS and page loads */
  pages: boolean;
  onDry: (v: boolean) => void;
  onOptions: (patch: Partial<Options>) => void;
}): ReactElement {
  return (
    <div className={gridClass}>
      <div className={cn(rowClass, 'sm:col-span-2')}>
        <div className="flex flex-col">
          <Label htmlFor="tb-dry">Rehearsal</Label>
          <span className="text-xs text-muted-foreground">
            No traffic: every device only marks when each phase starts, a check of the timing.
          </span>
        </div>
        <Switch id="tb-dry" checked={dry} onCheckedChange={onDry} />
      </div>
      <div className={rowClass}>
        <Label htmlFor="tb-latency" className="font-normal">
          Internet latency to
        </Label>
        <Select
          value={options.latency}
          onValueChange={(v) => {
            onOptions({ latency: v === 'eu' || v === 'us' ? v : 'uk' });
          }}
        >
          <SelectTrigger id="tb-latency" className="h-7 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(latencyTargets).map(([k, t]) => (
              <SelectItem key={k} value={k}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className={rowClass}>
        <Label htmlFor="tb-budget" className="font-normal">
          Data, each device
        </Label>
        <div className="flex items-center gap-1.5">
          <NumberInput
            id="tb-budget"
            min={MIN_BUDGET_MB}
            max={MAX_BUDGET_MB}
            integer
            value={options.budget_mb}
            className="h-7 w-24 text-right tabular"
            onChange={(v) => {
              onOptions({ budget_mb: v });
            }}
            onEmpty={() => {
              onOptions({ budget_mb: 0 });
            }}
          />
          <span className="text-xs text-muted-foreground">MB</span>
        </div>
      </div>
      {pages && !dry && (
        <SitesField
          sites={options.custom_sites}
          onSites={(custom_sites) => {
            onOptions({ custom_sites });
          }}
        />
      )}
      {import.meta.env.DEV && (
        <div className={cn(rowClass, 'sm:col-span-2')}>
          <Label htmlFor="tb-endpoint" className="font-normal">
            Loads go to (development)
          </Label>
          <Select
            value={options.endpoint}
            onValueChange={(v) => {
              onOptions({ endpoint: v === 'cloudflare' ? 'cloudflare' : 'dev' });
            }}
          >
            <SelectTrigger id="tb-endpoint" className="h-7 w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dev">This dev server</SelectItem>
              <SelectItem value="cloudflare">Cloudflare</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {!dry && (
        <p className="pt-2.5 text-xs text-muted-foreground sm:col-span-2">
          {!wan
            ? 'This plan sends nothing through your internet line.'
            : estimate === undefined
              ? 'Loads fill the line for as long as each lasts; with Smart Queue off, how much they move depends on your line.'
              : `At Smart Queue's speeds this plan moves up to about ${mb(estimate.down)} down and ${mb(estimate.up)} up. A device stops its loads at its data limit.`}{' '}
          {wan && options.endpoint === 'cloudflare' && "Downloads and uploads go to Cloudflare's speed test."}
        </p>
      )}
    </div>
  );
}

/** The coordinator's: pick a plan, see what it will do, start it. */
export function PlanCard({
  members,
  shaper,
  busy,
  onStart,
}: {
  members: readonly Member[];
  /** Smart Queue's shaped rates, for the data estimate */
  shaper: Shaper | null | undefined;
  /** a run is on: no new one */
  busy: boolean;
  onStart: (s: ScheduleRequest) => Promise<void>;
}): ReactElement {
  const [saved] = useState(() => planChoices.get());
  const [preset, setPreset] = useState<PresetId>(saved.preset);
  const [custom, setCustom] = useState<CustomPlan>(saved.custom);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const [dry, setDry] = useState(false);
  // undefined follows the plan's title; not saved with the other choices
  const [name, setName] = useState<string>();
  // in development, loads stay on the dev server unless asked otherwise; a budget of 0 follows the plan
  const [options, setOptions] = useState<Options>({
    endpoint: import.meta.env.DEV ? 'dev' : 'cloudflare',
    latency: saved.latency,
    budget_mb: saved.budget_mb,
    custom_sites: saved.custom_sites,
  });
  const { latency, budget_mb, custom_sites } = options;
  // the next visit starts where this one left off (not Rehearsal)
  useEffect(() => {
    planChoices.save({ preset, custom, latency, budget_mb, custom_sites });
  }, [preset, custom, latency, budget_mb, custom_sites]);
  const pm = useMemo(() => planMembers(members), [members]);
  const estimate = dataEstimate(buildPlan(preset, pm, dry, custom).schedule, shaper);
  const budget = options.budget_mb > 0 ? options.budget_mb : defaultBudget(estimate);
  const built = useMemo(
    () => buildPlan(preset, pm, dry, custom, { ...options, budget_mb: budget }),
    [preset, pm, dry, custom, options, budget],
  );
  const names = useMemo(() => new Map(members.map((m) => [m.id, m.name])), [members]);
  const planTitle = built.schedule.name ?? '';
  const runTitle = runName(name, planTitle);
  const length = scheduleLength(built.schedule);
  const wan = usesInternet(built.schedule);
  const pages = built.schedule.phases.some((p) => p.kind === 'dns' || p.kind === 'household');
  const start = async (): Promise<void> => {
    setStarting(true);
    setError(undefined);
    try {
      await onStart({ ...built.schedule, name: runTitle });
      setName(undefined);
      setConfirming(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  };
  return (
    <Card>
      <CardHeading title="Plan" description={presets.find((p) => p.id === preset)?.description} />
      <CardContent className="flex flex-col gap-4">
        <div className={cn(rowClass, 'border-b-0 py-0')}>
          <Label htmlFor="tb-name" className="font-normal">
            Name
          </Label>
          <Input
            id="tb-name"
            className="max-w-72"
            maxLength={MAX_RUN_NAME}
            value={name ?? planTitle}
            onChange={(e) => {
              setName(e.target.value);
            }}
            onBlur={() => {
              if (name?.trim() === '') setName(undefined);
            }}
          />
        </div>
        <PresetPicker value={preset} onChange={setPreset} />
        {preset === 'custom' && <CustomOptions c={custom} onChange={setCustom} />}
        <Settings
          dry={dry}
          options={{ ...options, budget_mb: budget }}
          estimate={estimate}
          wan={wan}
          pages={pages}
          onDry={setDry}
          onOptions={(patch) => {
            setOptions((o) => ({ ...o, ...patch }));
          }}
        />
        <div className="flex flex-col gap-2">
          <PhaseStrip phases={built.schedule.phases} />
          <ol className="-mx-5 flex flex-col divide-y border-t">
            {built.schedule.phases.map((p, i) => {
              const s = phaseStyle[p.kind];
              const Icon = s.icon;
              const roles = phaseRoles(p, names);
              return (
                <li key={i} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-10 shrink-0 text-xs text-muted-foreground tabular">{clockText(p.start)}</span>
                  <Icon className={cn('size-4 shrink-0', s.tone)} aria-hidden="true" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">
                      <Arrowed text={p.label ?? s.name} />
                    </span>
                    {roles !== '' && <span className="truncate text-xs text-muted-foreground">{roles}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular">{String(Math.round(p.dur / 1000))} s</span>
                </li>
              );
            })}
          </ol>
        </div>
        {built.notes.length > 0 && (
          <Note tone="info" icon={<InfoIcon />}>
            {built.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </Note>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center justify-between gap-3 border-t">
        <span className="text-sm text-muted-foreground">
          {String(members.length)} {members.length === 1 ? 'device' : 'devices'} · {clockText(length)} in all
        </span>
        <Button
          type="button"
          disabled={busy || members.length === 0}
          onClick={() => {
            setError(undefined);
            setConfirming(true);
          }}
        >
          <PlayIcon /> Start
        </Button>
      </CardFooter>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start {dry ? 'a rehearsal' : 'the run'}?</DialogTitle>
            <DialogDescription>
              {runTitle} on {String(members.length)} {members.length === 1 ? 'device' : 'devices'}, {clockText(length)} long,
              starting a few seconds after you press Start. Any device can stop it, and it stops by itself at the end.
              {!dry &&
                wan &&
                (estimate === undefined
                  ? ' Its loads fill your internet line while they run.'
                  : ` Its loads fill your internet line while they run: up to about ${mb(estimate.down)} down and ${mb(estimate.up)} up.`)}
            </DialogDescription>
          </DialogHeader>
          {error !== undefined && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setConfirming(false);
              }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={starting} onClick={() => void start()}>
              {starting ? <LoaderCircleIcon className="animate-spin" /> : <PlayIcon />} Start
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
