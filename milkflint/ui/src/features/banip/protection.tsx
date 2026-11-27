// The banIP page's Protection tab: how much to block (the presets, each with
// what it costs), every list in banIP's catalogue by what it holds, the
// countries and networks (ASNs) to block, and when the lists are updated.
// The meter shows the memory the choice needs while banIP loads it; the
// save bar writes only what changed.
import {
  BuildingIcon,
  CalendarClockIcon,
  CheckIcon,
  ChevronDownIcon,
  GaugeIcon,
  GlobeIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
import { type ReactElement, useEffect, useId, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { CardHeading } from '@/components/card-heading';
import { Field } from '@/components/field';
import { SaveBar } from '@/components/save-bar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { ApplyState } from '@/hooks/use-apply';
import { formatBytes, formatNumber } from '@/lib/format';
import { cn, errorMessage } from '@/lib/utils';
import { type BanipConfig, type BanipStatus, enableBanip, type Feed, saveOptions } from './api';
import { useBanipWrite } from './queries';
import { CATEGORIES, type Category, infoOf, PRESETS, type PresetId, type Risk } from './feeds';
import { FeedSheet } from './feed-sheet';
import {
  countryWarnings,
  type Direction,
  estimate,
  feedDirection,
  limitText,
  memoryCheck,
  needsKey,
  portLimit,
  presetOf,
  REGIONS,
  RESULTS,
  selectionOf,
  withDirection,
  withPreset,
} from './model';
import { checkValue, effective, type OptionName, type Options, optionChanges } from './options';
import { Segmented } from '@/components/ui/segmented';

const KEYS: readonly OptionName[] = [
  'ban_feed',
  'ban_feedin',
  'ban_feedout',
  'ban_feedinout',
  'ban_feedreset',
  'ban_country',
  'ban_region',
  'ban_countrysplit',
  'ban_asn',
  'ban_asnsplit',
  // set in a list's row (urlhaus): the lists that need one
  'ban_authkey',
];

const DIRECTIONS: readonly { value: Direction; label: string; title: string }[] = [
  { value: 'in', label: 'In', title: 'Blocks connections coming in from these addresses' },
  { value: 'out', label: 'Out', title: 'Blocks your devices reaching these addresses' },
  { value: 'inout', label: 'Both', title: 'Both ways' },
];

const RISK: Record<Risk, { label: string; variant: 'secondary' | 'warning' | 'destructive' } | null> = {
  low: null,
  some: { label: 'Some false positives', variant: 'warning' },
  high: { label: 'Many false positives', variant: 'destructive' },
};

const RISK_ORDER: Record<Risk, number> = { low: 0, some: 1, high: 2 };

const list = (o: Options, k: OptionName): readonly string[] => {
  const v = effective(o, k);
  return typeof v === 'string' ? [] : v;
};

const mb = (kb: number): string => formatBytes(Math.max(0, kb) * 1024);

export interface Draft {
  options: Options;
  milkflint: Record<string, string>;
}

function initialDraft(c: BanipConfig): Draft {
  const options: Options = {};
  for (const k of KEYS) options[k] = c.options?.[k] ?? null;
  return { options, milkflint: { ...(c.milkflint ?? {}) } };
}

function MemoryMeter({ c, opts }: { c: BanipConfig; opts: Options }): ReactElement | null {
  const regions = useMemo(() => new Map((c.countries ?? []).map((x) => [x.code, x.region])), [c.countries]);
  if (c.meta === undefined || c.memory === undefined) return null;
  const all: Options = { ...(c.options ?? {}), ...opts };
  const est = estimate(selectionOf(all, regions), c.meta, c.known ?? {}, c.cpus ?? 1);
  const now = estimate(selectionOf(c.options ?? {}, regions), c.meta, c.known ?? {}, c.cpus ?? 1);
  const check = memoryCheck(est, c.memory, c.runtime?.counts?.elements ?? 0, now.perEntry);
  const total = Math.max(1, check.totalKb);
  const w = (kb: number): string => `${String(Math.max(0, Math.min(100, (kb / total) * 100)))}%`;
  const used = total - check.availableKb - check.freedKb;
  return (
    <div className="flex flex-col gap-2" aria-live="polite">
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Memory: ${mb(est.keptKb)} kept for the lists, ${mb(est.loadKb)} more while loading, ${mb(check.leftKb)} left of ${mb(total)}`}
      >
        <div className="h-full bg-muted-foreground/35" style={{ width: w(used) }} />
        <div className={cn('h-full', check.ok ? 'bg-primary' : 'bg-destructive')} style={{ width: w(est.keptKb) }} />
        <div className={cn('h-full', check.ok ? 'bg-primary/40' : 'bg-destructive/50')} style={{ width: w(est.loadKb) }} />
      </div>
      <p className={cn('text-xs', check.ok ? 'text-muted-foreground' : 'text-destructive')}>
        {est.entries === 0
          ? 'No lists chosen.'
          : `About ${formatNumber(Math.round(est.entries / 100) * 100)} addresses: ${mb(est.keptKb)} kept, and ${mb(est.loadKb)} more while banIP loads them. `}
        {check.ok
          ? `${mb(check.leftKb)} of the router’s ${mb(total)} stays free while it loads; each update downloads about ${mb(est.downloadKb)}.`
          : `That would leave the router short: only ${mb(check.leftKb)} free while loading, under the ${mb(check.reserveKb)} it keeps for everything else. Choose fewer lists, or a split size (Advanced, Firewall).`}
      </p>
    </div>
  );
}

function PresetPicker({
  value,
  onChange,
  c,
}: {
  value: PresetId;
  onChange: (p: PresetId) => void;
  c: BanipConfig;
}): ReactElement {
  const regions = useMemo(() => new Map((c.countries ?? []).map((x) => [x.code, x.region])), [c.countries]);
  const id = useId();
  return (
    <div role="radiogroup" aria-labelledby={`${id}-label`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <span id={`${id}-label`} className="sr-only">
        How much to block
      </span>
      {PRESETS.map((p) => {
        const on = p.id === value;
        const cost =
          c.meta === undefined || p.id === 'off' || p.id === 'custom'
            ? null
            : estimate(
                selectionOf({ ...(c.options ?? {}), ban_feed: p.feeds, ban_country: [], ban_asn: [] }, regions),
                c.meta,
                c.known ?? {},
                c.cpus ?? 1,
              );
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              onChange(p.id);
            }}
            className={cn(
              'flex flex-col items-start gap-1.5 rounded-lg border px-4 py-3 text-left transition-colors',
              on ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'bg-card hover:bg-accent/50',
            )}
          >
            <span className="flex w-full items-center gap-2">
              <span
                className={cn(
                  'flex size-4 items-center justify-center rounded-full border',
                  on ? 'border-primary' : 'border-input',
                )}
                aria-hidden="true"
              >
                {on && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="text-sm font-semibold">{p.title}</span>
            </span>
            <span className="text-xs text-muted-foreground">{p.text}</span>
            {cost !== null && (
              <span className="mt-auto pt-1 text-xs tabular">
                {p.feeds.length} lists, about {formatNumber(Math.round(cost.entries / 1000))} thousand addresses:{' '}
                {mb(cost.keptKb)} of memory, {mb(cost.downloadKb)} to download at each update
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function FeedRow({
  f,
  on,
  dir,
  reset,
  entries,
  known,
  result,
  loaded,
  onToggle,
  onDirection,
  onReset,
  onEdit,
  authKey,
}: {
  f: Feed;
  on: boolean;
  dir: Direction;
  reset: boolean;
  entries: number | undefined;
  known: boolean;
  result: string | undefined;
  loaded: boolean;
  onToggle: (v: boolean) => void;
  onDirection: (d: Direction) => void;
  onReset: (v: boolean) => void;
  onEdit: (() => void) | undefined;
  /** the Auth-Key, for a list that needs one (banIP has one for all of them) */
  authKey: { value: string; onChange: (v: string) => void } | undefined;
}): ReactElement {
  const info = infoOf(f.name);
  const risk = RISK[info?.risk ?? 'low'];
  const limit = portLimit(f.flag);
  const id = `banip-feed-${f.name}`;
  return (
    // the switch beside the name at every width; the direction under the text on a phone, at the right from sm
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:gap-x-4">
      <Switch id={id} className="mt-0.5 shrink-0" checked={on} onCheckedChange={onToggle} aria-describedby={`${id}-text`} />
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <label htmlFor={id} className="text-sm font-medium">
            {f.name}
          </label>
          {risk !== null && <Badge variant={risk.variant}>{risk.label}</Badge>}
          {f.own && <Badge variant="secondary">yours</Badge>}
          {f.changed && !f.own && <Badge variant="outline">changed</Badge>}
        </div>
        <p id={`${id}-text`} className="text-sm text-muted-foreground">
          {info?.text ?? f.descr ?? ''}
          {info?.riskText !== undefined && <span className="text-xs"> {info.riskText}</span>}
          {authKey !== undefined && (
            <span className="text-xs">
              {' '}
              It needs an Auth-Key
              {info?.keyFrom === undefined ? (
                ' from the list’s provider'
              ) : (
                <>
                  , free from{' '}
                  <a href={info.keyFrom.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                    {info.keyFrom.name}
                  </a>
                </>
              )}
              : banIP skips it until one is set.
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground tabular">
          {entries !== undefined && entries > 0
            ? `${known ? '' : 'about '}${formatNumber(entries)} addresses`
            : 'size unknown until it’s loaded'}
          {limit !== null && !reset ? `, on ${limitText(limit)} only` : ''}
          {on && loaded && result === undefined ? ', loaded' : ''}
          {result !== undefined && <span className="text-warning">, last update: {RESULTS[result] ?? result}</span>}
        </p>
        {authKey !== undefined && on && <AuthKeyField name={f.name} {...authKey} />}
        {limit !== null && on && (
          <label className="flex w-fit items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={reset} onCheckedChange={onReset} className="scale-90" aria-label={`${f.name}: every port`} />
            Every port, not only {limit.ports.join(', ')}
          </label>
        )}
      </div>
      <div className="col-start-2 flex items-center gap-2 sm:col-start-3 sm:row-start-1">
        <Segmented label={`${f.name}: direction`} value={dir} options={DIRECTIONS} onChange={onDirection} disabled={!on} />
        {onEdit !== undefined && (
          <Button variant="ghost" size="icon" className="size-8" aria-label={`Edit ${f.name}`} onClick={onEdit}>
            <PencilIcon />
          </Button>
        )}
      </div>
    </li>
  );
}

// The key a list with "{authkey}" in its address needs: banIP has one for
// all of them (ban_authkey), as luci-app-banip's Feed Auth-Key. Hidden as
// it's typed, like a password: it's a personal account's.
function AuthKeyField({ name, value, onChange }: { name: string; value: string; onChange: (v: string) => void }): ReactElement {
  const id = useId();
  const bad = value !== '' && checkValue('ban_authkey', value) !== null;
  return (
    <div className="flex max-w-sm flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted-foreground">
        Auth-Key {value === '' && <span className="text-warning">(not set: {name} is skipped)</span>}
      </label>
      <Input
        id={id}
        type="password"
        autoComplete="off"
        spellCheck={false}
        className="h-8"
        value={value}
        aria-invalid={bad}
        onChange={(e) => {
          onChange(e.target.value.trim());
        }}
      />
      {bad && <p className="text-xs text-destructive">Letters, digits, - and _ only.</p>}
    </div>
  );
}

function Catalogue({
  c,
  s,
  opts,
  setOpts,
  onFeedSaved,
}: {
  c: BanipConfig;
  s: BanipStatus | undefined;
  opts: Options;
  setOpts: (o: Options) => void;
  onFeedSaved: () => void;
}): ReactElement {
  const [q, setQ] = useState('');
  const [onlyOn, setOnlyOn] = useState(false);
  const [editing, setEditing] = useState<Feed | 'new'>();
  const regions = useMemo(() => new Map((c.countries ?? []).map((x) => [x.code, x.region])), [c.countries]);
  const all: Options = { ...(c.options ?? {}), ...opts };
  const est =
    c.meta === undefined
      ? undefined
      : estimate(
          selectionOf({ ...all, ban_feed: (c.catalogue ?? []).map((f) => f.name) }, regions),
          c.meta,
          c.known ?? {},
          c.cpus ?? 1,
        );
  const feeds = list(opts, 'ban_feed');
  const reset = list(opts, 'ban_feedreset');
  const results = s?.last?.results ?? {};
  const loadedSets = new Set(s?.feeds ?? []);
  const known = c.known ?? {};
  const query = q.trim().toLowerCase();
  const shown = (c.catalogue ?? []).filter((f) => f.name !== 'country' && f.name !== 'asn');
  const match = (f: Feed): boolean =>
    (!onlyOn || feeds.includes(f.name)) &&
    (query === '' || `${f.name} ${f.descr ?? ''} ${infoOf(f.name)?.text ?? ''}`.toLowerCase().includes(query));
  const category = (f: Feed): Category => (f.own && !f.builtin ? 'own' : (infoOf(f.name)?.category ?? 'attackers'));
  const toggle = (name: string, v: boolean): void => {
    setOpts({ ...opts, ban_feed: v ? [...feeds.filter((x) => x !== name), name] : feeds.filter((x) => x !== name) });
  };
  return (
    <Card>
      <CardHeading
        icon={ListIcon}
        title="Lists"
        description="Each list is a set of addresses banIP downloads and keeps up to date. In blocks what they send you; Out blocks your devices reaching them."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing('new');
            }}
          >
            <PlusIcon /> Add a list
          </Button>
        }
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
            <Input
              aria-label="Find a list"
              placeholder="Find a list"
              className="pl-8"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <Switch checked={onlyOn} onCheckedChange={setOnlyOn} aria-label="Only the lists that are on" />
            Only the ones on ({feeds.filter((f) => f !== 'country' && f !== 'asn').length})
          </label>
        </div>
        {CATEGORIES.map((cat) => {
          const rows = shown
            .filter((f) => category(f) === cat.id && match(f))
            .sort(
              (a, z) =>
                (RISK_ORDER[infoOf(a.name)?.risk ?? 'low'] - RISK_ORDER[infoOf(z.name)?.risk ?? 'low']) * 100 +
                a.name.localeCompare(z.name),
            );
          if (rows.length === 0) return null;
          const chosen = rows.filter((f) => feeds.includes(f.name)).length;
          return (
            // collapsed unless one of its lists is on (or a search is showing them)
            <details key={cat.id} className="group flex flex-col" open={query !== '' || onlyOn || chosen > 0}>
              <summary className="flex cursor-pointer list-none items-start gap-3 border-b pb-2">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">
                    {cat.title}
                    <span className="ml-2 text-xs font-normal text-muted-foreground tabular">
                      {chosen > 0 ? `${String(chosen)} of ${String(rows.length)} on` : `${String(rows.length)} lists`}
                    </span>
                  </h3>
                  <p className="text-xs text-muted-foreground">{cat.text}</p>
                </div>
                <ChevronDownIcon
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <ul className="divide-y">
                {rows.map((f) => {
                  const k4 = known[`${f.name}.v4`];
                  const k6 = known[`${f.name}.v6`];
                  const isKnown = k4 !== undefined || k6 !== undefined;
                  const entries = isKnown ? (k4 ?? 0) + (k6 ?? 0) : est?.sizes[f.name];
                  const res = results[`${f.name}.v4`] ?? results[`${f.name}.v6`] ?? results[f.name];
                  return (
                    <FeedRow
                      key={f.name}
                      f={f}
                      on={feeds.includes(f.name)}
                      dir={feedDirection(f.name, f, opts)}
                      reset={reset.includes(f.name)}
                      entries={entries}
                      known={isKnown}
                      result={res}
                      loaded={loadedSets.has(f.name)}
                      onToggle={(v) => {
                        toggle(f.name, v);
                      }}
                      onDirection={(d) => {
                        setOpts(withDirection(opts, f.name, d, f));
                      }}
                      onReset={(v) => {
                        setOpts({
                          ...opts,
                          ban_feedreset: v ? [...reset.filter((x) => x !== f.name), f.name] : reset.filter((x) => x !== f.name),
                        });
                      }}
                      onEdit={
                        f.own
                          ? () => {
                              setEditing(f);
                            }
                          : undefined
                      }
                      authKey={
                        needsKey(f)
                          ? {
                              value: typeof opts.ban_authkey === 'string' ? opts.ban_authkey : '',
                              onChange: (v) => {
                                setOpts({ ...opts, ban_authkey: v === '' ? null : v });
                              },
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </ul>
            </details>
          );
        })}
        {shown.filter(match).length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">No list matches “{q}”.</p>
        )}
        {c.custom?.state === 'edited' && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" /> banIP’s custom feed file was changed outside this page, so
            lists can’t be added here until it’s taken over or reset (Advanced, Downloads).
          </p>
        )}
      </CardContent>
      {editing !== undefined && (
        <FeedSheet
          feed={editing === 'new' ? undefined : editing}
          names={(c.catalogue ?? []).map((f) => f.name)}
          onClose={() => {
            setEditing(undefined);
          }}
          onSaved={() => {
            setEditing(undefined);
            onFeedSaved();
          }}
        />
      )}
    </Card>
  );
}

function Countries({ c, opts, setOpts }: { c: BanipConfig; opts: Options; setOpts: (o: Options) => void }): ReactElement {
  const [q, setQ] = useState('');
  const chosen = list(opts, 'ban_country');
  const regions = list(opts, 'ban_region');
  const feeds = list(opts, 'ban_feed');
  const countryFeed = (c.catalogue ?? []).find((f) => f.name === 'country');
  const query = q.trim().toLowerCase();
  const byCode = new Map((c.countries ?? []).map((x) => [x.code, x]));
  const blocked = new Set([...chosen, ...(c.countries ?? []).filter((x) => regions.includes(x.region)).map((x) => x.code)]);
  const warn = countryWarnings([...blocked], c.wifi_country);
  const set = (codes: readonly string[], regs: readonly string[]): void => {
    const any = codes.length > 0 || regs.length > 0;
    setOpts({
      ...opts,
      ban_country: [...codes],
      ban_region: [...regs],
      ban_feed: any ? [...feeds.filter((f) => f !== 'country'), 'country'] : feeds.filter((f) => f !== 'country'),
    });
  };
  return (
    <Card>
      <CardHeading
        icon={GlobeIcon}
        title="Countries"
        description="Addresses given to a country or a whole region (ipdeny.com’s lists, by registry). Coming in by default: for a server at home; Out stops your devices reaching them."
        action={
          countryFeed !== undefined && (
            <Segmented
              label="Countries: direction"
              value={feedDirection('country', countryFeed, opts)}
              options={DIRECTIONS}
              disabled={blocked.size === 0}
              onChange={(d) => {
                setOpts(withDirection(opts, 'country', d, countryFeed));
              }}
            />
          )
        }
      />
      <CardContent className="flex flex-col gap-4">
        {blocked.size > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {[...regions].map((r) => (
              <Badge key={r} variant="secondary" className="gap-1 pr-1">
                {REGIONS.find((x) => x.id === r)?.title ?? r}
                <button
                  type="button"
                  aria-label={`Stop blocking ${r}`}
                  className="-mr-0.5 flex size-6 items-center justify-center rounded-full hover:bg-foreground/10"
                  onClick={() => {
                    set(
                      chosen,
                      regions.filter((x) => x !== r),
                    );
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
            {chosen.map((code) => (
              <Badge key={code} variant="secondary" className="gap-1 pr-1">
                {byCode.get(code)?.name ?? code}
                <button
                  type="button"
                  aria-label={`Stop blocking ${byCode.get(code)?.name ?? code}`}
                  className="-mr-0.5 flex size-6 items-center justify-center rounded-full hover:bg-foreground/10"
                  onClick={() => {
                    set(
                      chosen.filter((x) => x !== code),
                      regions,
                    );
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {warn.length > 0 && (
          <p className="flex items-start gap-2 text-sm text-warning">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            {byCode.get(warn[0] ?? '')?.name ?? warn[0]} is where this router is (its Wi-Fi country): blocking it blocks your own
            provider’s other customers, and, outbound, most local sites.
          </p>
        )}
        <Input
          aria-label="Find a country"
          placeholder="Find a country"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
          }}
          className="sm:max-w-xs"
        />
        <ul className="flex flex-col divide-y border-y">
          {REGIONS.map((r) => {
            const members = (c.countries ?? []).filter(
              (x) => x.region === r.id && (query === '' || x.name.toLowerCase().includes(query) || x.code === query),
            );
            if (members.length === 0) return null;
            const whole = regions.includes(r.id);
            return (
              <li key={r.id}>
                <details className="group" open={query !== ''}>
                  <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 py-2 text-sm [&::-webkit-details-marker]:hidden">
                    <ChevronDownIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-fast group-open:rotate-180"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 font-medium">{r.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular">
                      {whole
                        ? 'all blocked'
                        : `${String(members.filter((x) => blocked.has(x.code)).length)} of ${String(members.length)}`}
                    </span>
                  </summary>
                  <div className="flex flex-col gap-3 pb-3 pl-6">
                    <label className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={whole}
                        aria-label={`The whole region: ${r.title}`}
                        onCheckedChange={(v) => {
                          set(chosen, v ? [...regions, r.id] : regions.filter((x) => x !== r.id));
                        }}
                      />
                      The whole region ({r.id})
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {members.map((x) => {
                        const on = blocked.has(x.code);
                        return (
                          <button
                            key={x.code}
                            type="button"
                            aria-pressed={on}
                            disabled={whole}
                            onClick={() => {
                              set(on ? chosen.filter((y) => y !== x.code) : [...chosen, x.code], regions);
                            }}
                            className={cn(
                              'inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors disabled:opacity-60',
                              on
                                ? 'border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary'
                                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                            )}
                          >
                            {on && <CheckIcon className="size-3" aria-hidden="true" />}
                            {x.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
        <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={effective(opts, 'ban_countrysplit') === '1'}
            aria-label="A set per country"
            onCheckedChange={(v) => {
              setOpts({ ...opts, ban_countrysplit: v ? '1' : '0' });
            }}
          />
          A set per country (each counted on its own in Activity)
        </div>
      </CardContent>
    </Card>
  );
}

function Asns({ c, opts, setOpts }: { c: BanipConfig; opts: Options; setOpts: (o: Options) => void }): ReactElement {
  const [v, setV] = useState('');
  const asns = list(opts, 'ban_asn');
  const feeds = list(opts, 'ban_feed');
  const asnFeed = (c.catalogue ?? []).find((f) => f.name === 'asn');
  const n = v.trim().replace(/^as/i, '');
  const bad = n !== '' && (!/^[1-9]\d{0,9}$/.test(n) || Number(n) > 4294967295);
  const set = (l: readonly string[]): void => {
    setOpts({
      ...opts,
      ban_asn: [...l],
      ban_feed: l.length > 0 ? [...feeds.filter((f) => f !== 'asn'), 'asn'] : feeds.filter((f) => f !== 'asn'),
    });
  };
  return (
    <Card>
      <CardHeading
        icon={BuildingIcon}
        title="Networks by number (ASN)"
        description="Every address of a provider or company, by its autonomous system number (ipinfo.app’s lists). Find one with Who is it? in a lookup."
        action={
          asnFeed !== undefined && (
            <Segmented
              label="Networks: direction"
              value={feedDirection('asn', asnFeed, opts)}
              options={DIRECTIONS}
              disabled={asns.length === 0}
              onChange={(d) => {
                setOpts(withDirection(opts, 'asn', d, asnFeed));
              }}
            />
          )
        }
      />
      <CardContent className="flex flex-col gap-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (n !== '' && !bad && !asns.includes(n)) set([...asns, n]);
            setV('');
          }}
        >
          <Input
            aria-label="An AS number"
            placeholder="AS number, e.g. 64496"
            className="tabular sm:max-w-xs"
            value={v}
            aria-invalid={bad}
            onChange={(e) => {
              setV(e.target.value);
            }}
          />
          <Button type="submit" variant="outline" disabled={n === '' || bad}>
            <PlusIcon /> Add
          </Button>
        </form>
        {bad && <p className="text-xs text-destructive">A number from 1 to 4294967295.</p>}
        {asns.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {asns.map((a) => (
              <Badge key={a} variant="secondary" className="gap-1 pr-1 tabular">
                AS{a}
                <button
                  type="button"
                  aria-label={`Remove AS${a}`}
                  className="-mr-0.5 flex size-6 items-center justify-center rounded-full hover:bg-foreground/10"
                  onClick={() => {
                    set(asns.filter((x) => x !== a));
                  }}
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex w-fit items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={effective(opts, 'ban_asnsplit') === '1'}
            aria-label="A set per network"
            onCheckedChange={(x) => {
              setOpts({ ...opts, ban_asnsplit: x ? '1' : '0' });
            }}
          />
          A set per network (each counted on its own)
        </div>
      </CardContent>
    </Card>
  );
}

const SCHEDULES = [
  { value: 'daily', label: 'Every day' },
  { value: '12h', label: 'Twice a day' },
  { value: '6h', label: 'Every 6 hours' },
  { value: 'weekly', label: 'Once a week' },
  { value: 'off', label: 'Only when I ask' },
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function Updates({ m, setM }: { m: Record<string, string>; setM: (m: Record<string, string>) => void }): ReactElement {
  const schedule = m['schedule'] ?? 'daily';
  const time = m['time'] ?? '04:00';
  const timeOk = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  return (
    <Card>
      <CardHeading
        icon={CalendarClockIcon}
        title="Updates"
        description="The lists change by the hour. banIP downloads them again on this schedule; a failed download keeps the last copy."
      />
      <CardContent className="divide-y">
        <Field id="banip-schedule" label="Update the lists">
          <Select
            value={schedule}
            onValueChange={(v) => {
              setM({ ...m, schedule: v });
            }}
          >
            <SelectTrigger id="banip-schedule">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SCHEDULES.map((x) => (
                <SelectItem key={x.value} value={x.value}>
                  {x.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {schedule !== 'off' && (
          <Field
            id="banip-time"
            label={schedule === '6h' || schedule === '12h' ? 'Starting at' : 'At'}
            hint="The router’s time. Early morning keeps it out of the way."
            error={timeOk ? undefined : 'A time as 04:30.'}
          >
            <Input
              id="banip-time"
              type="time"
              value={time}
              className="w-32"
              onChange={(e) => {
                setM({ ...m, time: e.target.value });
              }}
            />
          </Field>
        )}
        {schedule === 'weekly' && (
          <Field id="banip-day" label="On">
            <Select
              value={m['day'] ?? '0'}
              onValueChange={(v) => {
                setM({ ...m, day: v });
              }}
            >
              <SelectTrigger id="banip-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DAYS.map((d, i) => (
                  <SelectItem key={d} value={String(i)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </CardContent>
    </Card>
  );
}

export function ProtectionTab({
  c,
  s,
  onSaved,
  onPick,
}: {
  c: BanipConfig;
  s: BanipStatus | undefined;
  onSaved: () => void;
  /** The preset card chosen here and not saved yet, so the page's switch can start it. */
  onPick?: (p: PresetId | undefined) => void;
}): ReactElement {
  const [draft, setDraft] = useState<Draft>(() => initialDraft(c));
  // a preset card chosen here: the one way this tab turns banIP on or off
  const [picked, setPicked] = useState<PresetId>();
  useEffect(() => {
    onPick?.(picked);
    return () => onPick?.(undefined);
  }, [picked, onPick]);
  const [state, setState] = useState<ApplyState>({ phase: 'idle' });
  // banIP's reads are asked again once the save went through
  const write = useBanipWrite();
  const saved = initialDraft(c);
  const enabled = c.enabled === true;
  const ap = c.mode === 'ap';
  const regions = useMemo(() => new Map((c.countries ?? []).map((x) => [x.code, x.region])), [c.countries]);
  const all: Options = { ...(c.options ?? {}), ...draft.options };
  const preset: PresetId = picked ?? (enabled ? presetOf(all, true) : 'off');
  const turnOn = picked !== undefined && picked !== 'off' && !enabled;
  const turnOff = picked === 'off' && enabled;
  const changes = optionChanges(saved.options, draft.options);
  const milkflint: Record<string, string> = {
    ...draft.milkflint,
    ...(enabled || turnOn ? { preset: preset === 'off' ? 'custom' : preset } : {}),
  };
  if (turnOff) milkflint['preset'] = 'off';
  const mchanges: Record<string, string> = {};
  for (const [k, v] of Object.entries(milkflint)) if (saved.milkflint[k] !== v) mchanges[k] = v;
  const dirty = Object.keys(changes).length > 0 || Object.keys(mchanges).length > 0 || turnOn || turnOff;
  const est = c.meta === undefined ? undefined : estimate(selectionOf(all, regions), c.meta, c.known ?? {}, c.cpus ?? 1);
  const now =
    c.meta === undefined ? undefined : estimate(selectionOf(c.options ?? {}, regions), c.meta, c.known ?? {}, c.cpus ?? 1);
  const short =
    est !== undefined &&
    now !== undefined &&
    c.memory !== undefined &&
    !memoryCheck(est, c.memory, c.runtime?.counts?.elements ?? 0, now.perEntry).ok;
  const timeBad = !/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.milkflint['time'] ?? '04:00');
  const keyBad = checkValue('ban_authkey', draft.options.ban_authkey ?? null) !== null;
  const setOpts = (o: Options): void => {
    setDraft((d) => ({ ...d, options: o }));
    // a list changed by hand: no preset card stands for it any more
    if (picked !== undefined && picked !== 'off') setPicked(presetOf({ ...(c.options ?? {}), ...o }, true));
  };
  const choosePreset = (p: PresetId): void => {
    setPicked(p);
    if (p !== 'off' && p !== 'custom') setDraft((d) => ({ ...d, options: withPreset(d.options, p) }));
  };
  const save = (): void => {
    setState({ phase: 'applying' });
    write
      .mutateAsync(async () => {
        if (Object.keys(changes).length > 0 || Object.keys(mchanges).length > 0) await saveOptions(changes, mchanges);
        if (turnOn) await enableBanip(true);
        if (turnOff) await enableBanip(false);
      })
      .then(
        () => {
          setState({
            phase: 'done',
            nothingChanged: false,
            note: turnOn
              ? 'banIP is on: it’s downloading and loading the lists now.'
              : turnOff
                ? 'banIP is off: nothing is blocked.'
                : enabled && Object.keys(changes).length > 0
                  ? 'banIP is loading the lists again: the ones it has stay as they are, new ones are downloaded.'
                  : !enabled && Object.keys(changes).length > 0
                    ? 'Saved. banIP is off: choose a preset or turn it on at the top to start blocking.'
                    : undefined,
          });
          setPicked(undefined);
          onSaved();
        },
        (err: unknown) => {
          setState({ phase: 'failed', message: errorMessage(err) });
        },
      );
  };
  return (
    <div className="flex flex-col gap-4">
      <ApplyStatus state={state} />
      <Card>
        <CardHeading
          icon={GaugeIcon}
          title="How much to block"
          description="A starting point: the lists stay yours to change below."
        />
        <CardContent className="flex flex-col gap-4">
          <PresetPicker value={ap ? 'off' : preset} onChange={choosePreset} c={c} />
          {!ap && preset !== 'off' && <MemoryMeter c={c} opts={draft.options} />}
          {ap && (
            <p className="text-sm text-muted-foreground">
              In access point mode banIP stays off: the main router faces the internet.
            </p>
          )}
        </CardContent>
      </Card>
      <Catalogue
        c={c}
        s={s}
        opts={draft.options}
        setOpts={setOpts}
        onFeedSaved={() => {
          onSaved();
        }}
      />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Countries c={c} opts={draft.options} setOpts={setOpts} />
        <div className="flex flex-col gap-4">
          <Asns c={c} opts={draft.options} setOpts={setOpts} />
          <Updates
            m={draft.milkflint}
            setM={(m) => {
              setDraft((d) => ({ ...d, milkflint: m }));
            }}
          />
        </div>
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={short || timeBad || keyBad}
        onSave={save}
        onRevert={() => {
          setDraft(initialDraft(c));
          setPicked(undefined);
          setState({ phase: 'idle' });
        }}
      />
    </div>
  );
}
