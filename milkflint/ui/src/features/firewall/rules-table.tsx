// Traffic rules as a table, one group per chain they land in: from a zone to
// the router, from a zone on through it, from the router out. fw4 checks a
// chain's rules in order and the first that matches decides, so order
// matters within a group and nothing sorts: drag a rule's grip (or focus it
// and use the arrow keys) to move it. On a phone each rule is a card with up
// and down buttons. OpenWrt's standard rules fold into one row per run unless
// "Show OpenWrt's rules" is on (remembered in this browser); a click on a
// row, or its edit button, opens the rule's side sheet, which also deletes it.
import { useNavigate } from '@tanstack/react-router';
import { addressLink } from '@/lib/router';
import {
  ArrowDownIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  GlobeIcon,
  GripVerticalIcon,
  MonitorIcon,
  PlusIcon,
  ShieldBanIcon,
  ShieldIcon,
  SquarePenIcon,
} from 'lucide-react';
import { type ComponentProps, type ReactElement, type ReactNode, useCallback, useId, useMemo, useRef, useState } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import { type Actions, hitsText, rowClick } from './forms';
import {
  builtInRules,
  enabledChange,
  type FirewallConfig,
  managerOf,
  moveTo,
  portsText,
  type Rule,
  scheduleText,
  zoneTitle,
} from './model';
import { foldOpenWrt, moveTarget, namesText, plural, ruleOrigin, type RuleRow } from './summary';
import { type DevctlRow, devctlRows } from '../device-control/model';
import {
  GroupHeader,
  HeaderButton,
  OffBadge,
  OnSwitch,
  OriginMark,
  Path,
  RouterPill,
  RowButton,
  VerdictBadge,
  Who,
} from './table-parts';

interface Chain {
  /** the chain in words, by its zones' names: unique, and its section's name on a phone */
  key: string;
  from: string;
  to: string;
  /** what "Add rule" in its header starts with: '' is the router */
  src: string;
  dest: string;
  rules: Rule[];
}

function zoneName(name: string, cfg: FirewallConfig): string {
  return name === '*' ? 'Any zone' : zoneTitle(name, cfg);
}

// (a zone's name has no spaces, so "any zone" is never one)
const keyName = (name: string): string => (name === '*' ? 'any zone' : name);

function chainOf(r: Rule, cfg: FirewallConfig): Omit<Chain, 'rules'> {
  if (r.src === undefined)
    return {
      key: r.dest === undefined ? 'the router out' : `the router to ${keyName(r.dest)}`,
      from: 'Router',
      to: r.dest === undefined ? 'Anywhere' : zoneName(r.dest, cfg),
      src: '',
      dest: r.dest ?? '',
    };
  if (r.dest === undefined)
    return { key: `${keyName(r.src)} to the router`, from: zoneName(r.src, cfg), to: 'Router', src: r.src, dest: '' };
  return { key: `${keyName(r.src)} forwarded`, from: zoneName(r.src, cfg), to: 'Forwarded traffic', src: r.src, dest: r.dest };
}

/** Rules grouped by chain, in the order each chain first appears. */
function chains(rules: readonly Rule[], cfg: FirewallConfig): Chain[] {
  const byKey = new Map<string, Chain>();
  for (const r of rules) {
    const c = chainOf(r, cfg);
    const chain = byKey.get(c.key) ?? { ...c, rules: [] };
    chain.rules.push(r);
    byKey.set(c.key, chain);
  }
  return [...byKey.values()];
}

function more(items: readonly string[]): string {
  return items.length > 1 ? `${items[0] ?? ''} +${String(items.length - 1)}` : (items[0] ?? '');
}

/** Addresses as their devices' names where known: the first, and how many more; in mono while the first is still an address. */
function Devices({ items, names }: { items: readonly string[]; names: ReadonlyMap<string, string> }): ReactElement {
  return (
    <Who icon={MonitorIcon} title={items.join(', ')} mono={!names.has(items[0] ?? '')}>
      {more(items.map((x) => names.get(x) ?? x))}
    </Who>
  );
}

function FromCell({ r, data }: { r: Rule; data: FirewallData }): ReactElement {
  if (r.srcMac.length > 0) return <Devices items={r.srcMac} names={data.names.byMac} />;
  if (r.srcIp.length > 0) return <Devices items={r.srcIp} names={data.names.byIp} />;
  if (r.src === undefined) return <RouterPill />;
  if (r.src === '*') return <Who icon={GlobeIcon}>any</Who>;
  return (
    <Who icon={ShieldIcon} mono>
      {r.src}
    </Who>
  );
}

function ToCell({ r, data }: { r: Rule; data: FirewallData }): ReactElement {
  if (r.destIp.length > 0) return <Devices items={r.destIp} names={data.names.byIp} />;
  if (r.dest === undefined) return <RouterPill />;
  if (r.dest === '*') return <Who icon={GlobeIcon}>any</Who>;
  return (
    <Who icon={ShieldIcon} mono>
      {r.dest}
    </Who>
  );
}

/** Where the rule's traffic comes from and goes, with the arrow read out as "to". */
function Traffic({ r, data }: { r: Rule; data: FirewallData }): ReactElement {
  return (
    <>
      <FromCell r={r} data={data} />
      <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
      <ToCell r={r} data={data} />
    </>
  );
}

function protoText(r: Rule): string {
  if (r.proto.includes('all')) return r.family === 'any' ? 'any' : `any · ${r.family === 'ipv4' ? 'v4' : 'v6'}`;
  const icmp6 = r.family === 'ipv6' && r.proto.length === 1 && r.proto[0] === 'icmp';
  const p = icmp6 ? 'icmpv6' : r.proto.join('/');
  return r.family === 'any' || icmp6 ? p : `${p} · ${r.family === 'ipv4' ? 'v4' : 'v6'}`;
}

function matchText(r: Rule): string {
  const parts: string[] = [protoText(r)];
  if (r.destPort.length > 0) parts.push(r.destPort.join(' '));
  if (r.srcPort.length > 0) parts.push(`from ${portsText(r.srcPort)}`);
  if (r.icmpTypes.length > 0) parts.push(r.icmpTypes.length <= 2 ? r.icmpTypes.join(' ') : `${String(r.icmpTypes.length)} types`);
  if (r.limit !== undefined) parts.push(`≤${r.limit.replace(/\/(sec|second)$/, '/s').replace(/\/(minute|min)$/, '/min')}`);
  const when = scheduleText(r.schedule);
  if (when !== undefined) parts.push(when);
  return parts.join(' · ');
}

/** What an OpenWrt rule is for, or which page made it (Device control's: who it's for and when, in words). */
function why(r: Rule, dc: DevctlRow | undefined): string | undefined {
  if (dc !== undefined) return dc.text;
  const managed = managerOf(r.section);
  if (managed !== undefined) return `Made by the ${managed.title} page.`;
  return r.name === undefined ? undefined : builtInRules[r.name];
}

/** The rule's name with its marks: who made it, and Off in words while it's off. */
function NameCell({ r, wide, dc }: { r: Rule; wide: boolean; dc?: DevctlRow | undefined }): ReactElement {
  const origin = ruleOrigin(r);
  const managed = managerOf(r.section);
  const description = why(r, dc);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn('truncate font-medium', r.enabled ? 'text-foreground' : 'text-muted-foreground')}>
          {r.name ?? r.label}
        </span>
        {origin === 'openwrt' && <OriginMark origin="openwrt" />}
        {managed !== undefined && <OriginMark origin={managed} {...(dc === undefined ? {} : { to: dc.href })} />}
        {!r.enabled && <OffBadge />}
      </span>
      {description !== undefined && (origin !== 'page' || dc !== undefined) && (
        <span
          className={cn('text-xs text-muted-foreground', wide ? 'max-w-md truncate' : 'line-clamp-2')}
          title={wide ? description : undefined}
        >
          {description}
        </span>
      )}
    </span>
  );
}

/** A chain's header: from → to, how many rules, and adding one to it. */
function ChainHeader({ chain, actions }: { chain: Chain; actions: Actions }): ReactElement {
  return (
    <GroupHeader
      title={<Path from={chain.from} to={chain.to} />}
      count={chain.rules.length}
      noun={['rule', 'rules']}
      action={
        <HeaderButton
          disabled={actions.applying}
          onClick={() => {
            actions.editRule(undefined, {
              name: '',
              target: 'ACCEPT',
              src: chain.src,
              dest: chain.dest,
              proto: 'tcp udp',
              ports: '',
            });
          }}
        >
          <PlusIcon /> Add rule
        </HeaderButton>
      }
    />
  );
}

/** A run of OpenWrt's standard rules, folded: how many, which, and a way to show them. */
function Folded({ rules, onShow }: { rules: readonly Rule[]; onShow: () => void }): ReactElement {
  const off = rules.filter((r) => !r.enabled).length;
  return (
    <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm">
          <span className="font-medium">{plural(rules.length, 'standard rule')} from OpenWrt</span>
          {off > 0 && <span className="text-muted-foreground"> · {off} off</span>}
        </span>
        <span className="text-xs text-muted-foreground">{namesText(rules, 3)}</span>
      </span>
      <Button variant="ghost" size="sm" className="h-7 text-xs text-primary" onClick={onShow}>
        Show them
      </Button>
    </span>
  );
}

const SHOW_KEY = 'milkflint.firewall.show-openwrt-rules';

/** "Show OpenWrt's rules", remembered in this browser (off when storage isn't there). */
function useShowOpenWrt(): [boolean, (v: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return window.localStorage.getItem(SHOW_KEY) === '1';
    } catch {
      return false;
    }
  });
  const set = useCallback((v: boolean): void => {
    setShow(v);
    try {
      window.localStorage.setItem(SHOW_KEY, v ? '1' : '0');
    } catch {
      // private window or storage blocked: it holds for this visit only
    }
  }, []);
  return [show, set];
}

/** A row of the table: a rule, or a folded run of OpenWrt's, with its chain's rows (a move steps over a folded run whole). */
interface Entry {
  row: RuleRow;
  chain: Chain['key'];
  rows: readonly RuleRow[];
}

const entryKey = (e: Entry): string => (e.row.kind === 'rule' ? e.row.rule.section : `fold-${e.row.rules[0]?.section ?? ''}`);

/** What the rows' cells and cards work with. */
interface Ctx {
  data: FirewallData;
  counters: Counters | undefined;
  actions: Actions;
  dc: ReadonlyMap<string, DevctlRow>;
  /** each rule's place in the whole list */
  number: ReadonlyMap<string, number>;
  showAll: () => void;
  /** to another page (Device control, for its rules) */
  goTo: (address: string) => void;
}

/** Device control's rules open there, unless they were changed by hand. */
function open(ctx: Ctx, r: Rule): void {
  const row = ctx.dc.get(r.section);
  if (row !== undefined && !row.byHand) ctx.goTo(row.href);
  else ctx.actions.editRule(r);
}

function move(ctx: Ctx, rows: readonly RuleRow[], r: Rule, dir: 'up' | 'down'): void {
  const to = moveTarget(rows, r.section, dir);
  if (to !== undefined && !ctx.actions.applying) ctx.actions.apply([moveTo(ctx.data.cfg.order, r.section, to)]);
}

const movable = (rows: readonly RuleRow[], r: Rule): boolean =>
  moveTarget(rows, r.section, 'up') !== undefined || moveTarget(rows, r.section, 'down') !== undefined;

function Toggle({ r, actions }: { r: Rule; actions: Actions }): ReactElement {
  return (
    <OnSwitch
      on={r.enabled}
      name={r.name ?? r.label}
      disabled={actions.applying}
      onToggle={() => {
        actions.apply([enabledChange(r.section, !r.enabled)]);
      }}
    />
  );
}

function EditButton({ r, ctx }: { r: Rule; ctx: Ctx }): ReactElement {
  const row = ctx.dc.get(r.section);
  return (
    <RowButton
      label={row !== undefined && !row.byHand ? `Edit ${r.name ?? r.label} on Device control` : `Edit ${r.name ?? r.label}`}
      icon={SquarePenIcon}
      onClick={() => {
        open(ctx, r);
      }}
    />
  );
}

/** The grip a rule drags by (its row arms on a press there) or moves by, focused, with the arrow keys; and its number. */
function Grip({ r, rows, ctx }: { r: Rule; rows: readonly RuleRow[]; ctx: Ctx }): ReactElement {
  const { actions } = ctx;
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular">
      <button
        type="button"
        className="rounded flex size-6 cursor-grab items-center justify-center hover:bg-accent active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
        aria-label={`Move ${r.name ?? r.label}: drag, or use the up and down arrow keys`}
        title="Drag to move, or focus and use ↑ ↓"
        disabled={actions.applying || !movable(rows, r)}
        data-grip
        onKeyDown={(e) => {
          const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : undefined;
          if (dir === undefined || moveTarget(rows, r.section, dir) === undefined || actions.applying) return;
          e.preventDefault();
          move(ctx, rows, r, dir);
        }}
      >
        <GripVerticalIcon className="size-3.5" />
      </button>
      {ctx.number.get(r.section)}
    </span>
  );
}

/** A cell drawn for a rule; a folded run's row leaves it empty. */
const forRule =
  (cell: (r: Rule) => ReactNode) =>
  (e: Entry): ReactNode =>
    e.row.kind === 'rule' ? cell(e.row.rule) : null;

function ruleColumns(ctx: Ctx): Column<Entry>[] {
  return [
    {
      label: '#',
      className: 'w-16',
      cell: (e) =>
        e.row.kind === 'rule' ? (
          <Grip r={e.row.rule} rows={e.rows} ctx={ctx} />
        ) : (
          // a run's numbers, under the rules' numbers (past the grip)
          <span className="pl-7.5 text-xs whitespace-nowrap text-muted-foreground tabular">
            {ctx.number.get(e.row.rules[0]?.section ?? '')}
            {e.row.rules.length > 1 && `–${String(ctx.number.get(e.row.rules.at(-1)?.section ?? '') ?? '')}`}
          </span>
        ),
    },
    {
      label: 'Rule',
      className: 'max-w-80',
      cell: (e) =>
        e.row.kind === 'rule' ? (
          <NameCell r={e.row.rule} wide dc={ctx.dc.get(e.row.rule.section)} />
        ) : (
          <Folded rules={e.row.rules} onShow={ctx.showAll} />
        ),
    },
    {
      label: 'Traffic',
      cell: forRule((r) => (
        <span className="flex items-center gap-1.5">
          <Traffic r={r} data={ctx.data} />
        </span>
      )),
    },
    {
      label: 'Match',
      className: 'max-w-56 truncate text-xs',
      cell: forRule((r) => <span title={matchText(r)}>{matchText(r)}</span>),
    },
    { label: 'Action', cell: forRule((r) => <VerdictBadge verdict={r.target} off={!r.enabled} />) },
    {
      label: 'Hits',
      className: 'text-right text-xs tabular',
      cell: forRule((r) => {
        const hits = ctx.counters?.rules.get(r.label);
        return (
          <span title={hits === undefined ? undefined : `${String(hits)} packets since the firewall last started`}>
            {hitsText(hits)}
          </span>
        );
      }),
    },
    { label: 'On', className: 'w-14', cell: forRule((r) => <Toggle r={r} actions={ctx.actions} />) },
    {
      label: 'Edit',
      className: 'w-12 py-1 text-right',
      hidden: true,
      cell: forRule((r) => <EditButton r={r} ctx={ctx} />),
    },
  ];
}

/** A rule's card on a phone or in a narrow window, or a folded run's. */
function RuleCard({ e, ctx }: { e: Entry; ctx: Ctx }): ReactElement {
  if (e.row.kind === 'openwrt') {
    return (
      <div className="px-4 py-3">
        <Folded rules={e.row.rules} onShow={ctx.showAll} />
      </div>
    );
  }
  const r = e.row.rule;
  const title = r.name ?? r.label;
  const hits = ctx.counters?.rules.get(r.label);
  const arrow = (dir: 'up' | 'down', Icon: typeof ArrowUpIcon): ReactElement => (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={`Move ${title} ${dir}`}
      disabled={moveTarget(e.rows, r.section, dir) === undefined || ctx.actions.applying}
      onClick={() => {
        move(ctx, e.rows, r, dir);
      }}
    >
      <Icon />
    </Button>
  );
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 gap-2">
          <span className="pt-px text-xs text-muted-foreground tabular">{ctx.number.get(r.section)}</span>
          <NameCell r={r} wide={false} dc={ctx.dc.get(r.section)} />
        </span>
        <VerdictBadge verdict={r.target} off={!r.enabled} />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <Traffic r={r} data={ctx.data} />
      </span>
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground tabular">
        <span className="min-w-0 break-words">{matchText(r)}</span>
        {hits !== undefined && (
          <span>
            {hitsText(hits)} {hits === 1 ? 'hit' : 'hits'}
          </span>
        )}
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Toggle r={r} actions={ctx.actions} />
          <span aria-hidden="true">{r.enabled ? 'On' : 'Off'}</span>
        </span>
        <span className="flex items-center">
          {arrow('up', ArrowUpIcon)}
          {arrow('down', ArrowDownIcon)}
          <EditButton r={r} ctx={ctx} />
        </span>
      </span>
    </div>
  );
}

export function RulesTable({
  data,
  counters,
  actions,
}: {
  data: FirewallData;
  counters: Counters | undefined;
  actions: Actions;
}): ReactElement {
  const id = useId();
  const [show, setShow] = useShowOpenWrt();
  const dc = useMemo(() => devctlRows(data.cfg, data.sections, data.milkflint, (mac) => data.names.byMac.get(mac)), [data]);
  const armed = useRef<string | undefined>(undefined);
  const navigate = useNavigate();
  const ctx = useMemo(
    (): Ctx => ({
      data,
      counters,
      actions,
      dc,
      number: new Map(data.cfg.rules.map((r, i) => [r.section, i + 1])),
      showAll: () => {
        setShow(true);
      },
      goTo: (address) => {
        void navigate(addressLink(address));
      },
    }),
    [data, counters, actions, dc, setShow, navigate],
  );
  const columns = useMemo(() => ruleColumns(ctx), [ctx]);
  const groups = useMemo(
    () =>
      chains(data.cfg.rules, data.cfg).map((chain) => {
        const rows = foldOpenWrt(chain.rules, show);
        return {
          key: chain.key,
          header: <ChainHeader chain={chain} actions={actions} />,
          rows: rows.map((row): Entry => ({ row, chain: chain.key, rows })),
        };
      }),
    [data, show, actions],
  );
  const openwrt = data.cfg.rules.filter((r) => ruleOrigin(r) === 'openwrt').length;
  const [dragging, setDragging] = useState<Chain['key']>();
  const [over, setOver] = useState<string>();
  // a row drags (within its chain) and opens on a click; a folded run does neither
  const rowProps = (e: Entry): ComponentProps<'tr'> => {
    if (e.row.kind !== 'rule') return {};
    const r = e.row.rule;
    return {
      draggable: !actions.applying && movable(e.rows, r),
      // only a press on the grip arms the row to drag
      onPointerDown: (ev) => {
        armed.current = ev.target instanceof Element && ev.target.closest('[data-grip]') !== null ? r.section : undefined;
      },
      onPointerUp: () => {
        armed.current = undefined;
      },
      onDragStart: (ev) => {
        if (armed.current !== r.section) {
          ev.preventDefault();
          return;
        }
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', r.section);
        setDragging(e.chain);
      },
      onDragEnd: () => {
        armed.current = undefined;
        setDragging(undefined);
        setOver(undefined);
      },
      onDragOver: (ev) => {
        if (dragging !== e.chain) return;
        ev.preventDefault();
        setOver(r.section);
      },
      onDrop: (ev) => {
        ev.preventDefault();
        const from = ev.dataTransfer.getData('text/plain');
        setOver(undefined);
        if (dragging === e.chain && from !== '' && from !== r.section) actions.apply([moveTo(data.cfg.order, from, r.section)]);
      },
      onClick: rowClick(() => {
        open(ctx, r);
      }),
      className: cn(
        'cursor-pointer',
        !r.enabled && 'text-muted-foreground',
        over === r.section && 'bg-primary-subtle outline outline-1 -outline-offset-1 outline-primary',
      ),
    };
  };

  return (
    // a container, so the hints below switch with the table's own cards
    <div className="@container flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <p className="text-sm text-muted-foreground">
            {plural(data.cfg.rules.length, 'rule')} in {plural(groups.length, 'chain')}
          </p>
          {openwrt > 0 && (
            <span className="flex items-center gap-2">
              <Switch id={`${id}-openwrt`} checked={show} onCheckedChange={setShow} />
              <label htmlFor={`${id}-openwrt`} className="text-sm">
                Show OpenWrt’s rules
              </label>
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={actions.applying}
            onClick={() => {
              actions.blockDevice();
            }}
          >
            <ShieldBanIcon /> Block a device
          </Button>
          <Button
            size="sm"
            disabled={actions.applying}
            onClick={() => {
              actions.editRule(undefined);
            }}
          >
            <PlusIcon /> Add rule
          </Button>
        </div>
      </div>
      <DataTable
        label="Traffic rules"
        columns={columns}
        groups={groups}
        rowKey={entryKey}
        empty="No traffic rules."
        wide="lg"
        card={(e) => <RuleCard e={e} ctx={ctx} />}
        rowProps={rowProps}
      />
      <p className="hidden max-w-prose text-xs text-muted-foreground @min-[60rem]:block">
        Within a chain the first matching rule wins: drag the grip to reorder (or focus it and use ↑ ↓). Click a rule to edit or
        delete it. Hits count since the firewall last started.
      </p>
      <p className="text-xs text-muted-foreground @min-[60rem]:hidden">
        Within a chain the first matching rule wins: move a rule with its arrows. Its edit button opens it, to change or delete
        it. Hits count since the firewall last started.
      </p>
    </div>
  );
}
