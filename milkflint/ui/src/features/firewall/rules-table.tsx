// Traffic rules as a table, one group per chain they land in: from a zone to
// the router, from a zone on through it, from the router out. fw4 checks a
// chain's rules in order and the first that matches decides, so order
// matters within a group: drag a rule's grip (or focus it and use the arrow
// keys) to move it. On a phone each rule is a card with up and down buttons.
// OpenWrt's standard rules fold into one row per run unless "Show OpenWrt's
// rules" is on (remembered in this browser); a click on a row, or its edit
// button, opens the rule's side sheet, which also deletes it.
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
import { type DragEvent, type KeyboardEvent, type ReactElement, useId, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  HeadRow,
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

function chainOf(r: Rule, cfg: FirewallConfig): Omit<Chain, 'rules'> {
  if (r.src === undefined)
    return {
      key: `out:${r.dest ?? ''}`,
      from: 'Router',
      to: r.dest === undefined ? 'Anywhere' : zoneName(r.dest, cfg),
      src: '',
      dest: r.dest ?? '',
    };
  if (r.dest === undefined) return { key: `in:${r.src}`, from: zoneName(r.src, cfg), to: 'Router', src: r.src, dest: '' };
  return { key: `fwd:${r.src}`, from: zoneName(r.src, cfg), to: 'Forwarded traffic', src: r.src, dest: r.dest };
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

const columns = [
  { label: '#', className: 'w-16' },
  { label: 'Rule' },
  { label: 'Traffic' },
  { label: 'Match' },
  { label: 'Action' },
  { label: 'Hits', className: 'text-right' },
  { label: 'On', className: 'w-14' },
  { label: 'Edit', className: 'w-12', hidden: true },
] as const;

/** A chain's header: from → to, how many rules, and adding one to it. */
function ChainHeader({ chain, actions, colSpan }: { chain: Chain; actions: Actions; colSpan?: number }): ReactElement {
  return (
    <GroupHeader
      title={<Path from={chain.from} to={chain.to} />}
      count={chain.rules.length}
      noun={['rule', 'rules']}
      {...(colSpan === undefined ? {} : { colSpan })}
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

/** To another page (Device control, for its rules). */
function goTo(to: string): void {
  window.location.hash = to;
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
  const set = (v: boolean): void => {
    setShow(v);
    try {
      window.localStorage.setItem(SHOW_KEY, v ? '1' : '0');
    } catch {
      // private window or storage blocked: it holds for this visit only
    }
  };
  return [show, set];
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
  // Device control's rules open there, unless they were changed by hand
  const open = (r: Rule): void => {
    const row = dc.get(r.section);
    if (row !== undefined && !row.byHand) goTo(row.href);
    else actions.editRule(r);
  };
  const groups = chains(data.cfg.rules, data.cfg).map((chain) => ({ chain, rows: foldOpenWrt(chain.rules, show) }));
  const number = new Map(data.cfg.rules.map((r, i) => [r.section, i + 1]));
  const openwrt = data.cfg.rules.filter((r) => ruleOrigin(r) === 'openwrt').length;
  // a row drags only from its grip: the grip arms it on pointer down
  const armed = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState<Chain['key'] | undefined>();
  const [over, setOver] = useState<string>();
  const move = (rows: readonly RuleRow[], r: Rule, dir: 'up' | 'down'): void => {
    const to = moveTarget(rows, r.section, dir);
    if (to !== undefined && !actions.applying) actions.apply([moveTo(data.cfg.order, r.section, to)]);
  };
  const onGripKey = (e: KeyboardEvent, rows: readonly RuleRow[], r: Rule): void => {
    const dir = e.key === 'ArrowUp' ? 'up' : e.key === 'ArrowDown' ? 'down' : undefined;
    if (dir === undefined || moveTarget(rows, r.section, dir) === undefined || actions.applying) return;
    e.preventDefault();
    move(rows, r, dir);
  };
  const dropProps = (
    chain: Chain,
    r: Rule,
  ): { onDragOver: (e: DragEvent<HTMLTableRowElement>) => void; onDrop: (e: DragEvent<HTMLTableRowElement>) => void } => ({
    onDragOver: (e) => {
      if (dragging !== chain.key) return;
      e.preventDefault();
      setOver(r.section);
    },
    onDrop: (e) => {
      e.preventDefault();
      const from = e.dataTransfer.getData('text/plain');
      setOver(undefined);
      if (dragging === chain.key && from !== '' && from !== r.section) actions.apply([moveTo(data.cfg.order, from, r.section)]);
    },
  });
  const toggle = (r: Rule): ReactElement => (
    <OnSwitch
      on={r.enabled}
      name={r.name ?? r.label}
      disabled={actions.applying}
      onToggle={() => {
        actions.apply([enabledChange(r.section, !r.enabled)]);
      }}
    />
  );
  const edit = (r: Rule): ReactElement => {
    const row = dc.get(r.section);
    return (
      <RowButton
        label={row !== undefined && !row.byHand ? `Edit ${r.name ?? r.label} on Device control` : `Edit ${r.name ?? r.label}`}
        icon={SquarePenIcon}
        onClick={() => {
          open(r);
        }}
      />
    );
  };
  const showAll = (): void => {
    setShow(true);
  };

  return (
    <div className="flex flex-col gap-3">
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
      <Card className="gap-0 overflow-hidden py-0">
        {/* wide screens: a table */}
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <HeadRow columns={columns} />
            </thead>
            {groups.map(({ chain, rows }) => (
              <tbody key={chain.key}>
                <ChainHeader chain={chain} actions={actions} colSpan={columns.length} />
                {rows.map((row) => {
                  if (row.kind === 'openwrt') {
                    return (
                      <tr key={`fold-${row.rules[0]?.section ?? ''}`} className="border-b last:border-b-0">
                        <td className="px-3 py-2 text-xs whitespace-nowrap text-muted-foreground tabular">
                          <span className="pl-7.5">
                            {number.get(row.rules[0]?.section ?? '')}
                            {row.rules.length > 1 && `–${String(number.get(row.rules.at(-1)?.section ?? '') ?? '')}`}
                          </span>
                        </td>
                        <td colSpan={columns.length - 1} className="py-2 pr-3 pl-3">
                          <Folded rules={row.rules} onShow={showAll} />
                        </td>
                      </tr>
                    );
                  }
                  const r = row.rule;
                  const title = r.name ?? r.label;
                  const hits = counters?.rules.get(r.label);
                  const movable =
                    moveTarget(rows, r.section, 'up') !== undefined || moveTarget(rows, r.section, 'down') !== undefined;
                  return (
                    <tr
                      key={r.section}
                      draggable={!actions.applying && movable}
                      onDragStart={(e) => {
                        if (armed.current !== r.section) {
                          e.preventDefault();
                          return;
                        }
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', r.section);
                        setDragging(chain.key);
                      }}
                      onDragEnd={() => {
                        armed.current = undefined;
                        setDragging(undefined);
                        setOver(undefined);
                      }}
                      {...dropProps(chain, r)}
                      onClick={rowClick(() => {
                        open(r);
                      })}
                      className={cn(
                        'cursor-pointer border-b last:border-b-0 hover:bg-muted/60',
                        !r.enabled && 'text-muted-foreground',
                        over === r.section && 'bg-primary-subtle outline outline-1 -outline-offset-1 outline-primary',
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular">
                          <button
                            type="button"
                            className="rounded flex size-6 cursor-grab items-center justify-center hover:bg-accent active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40"
                            aria-label={`Move ${title}: drag, or use the up and down arrow keys`}
                            title="Drag to move, or focus and use ↑ ↓"
                            disabled={actions.applying || !movable}
                            onPointerDown={() => {
                              armed.current = r.section;
                            }}
                            onPointerUp={() => {
                              armed.current = undefined;
                            }}
                            onKeyDown={(e) => {
                              onGripKey(e, rows, r);
                            }}
                          >
                            <GripVerticalIcon className="size-3.5" />
                          </button>
                          {number.get(r.section)}
                        </span>
                      </td>
                      <td className="max-w-80 px-3 py-2">
                        <NameCell r={r} wide dc={dc.get(r.section)} />
                      </td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-1.5">
                          <FromCell r={r} data={data} />
                          <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                          <ToCell r={r} data={data} />
                        </span>
                      </td>
                      <td className="max-w-56 truncate px-3 py-2 text-xs" title={matchText(r)}>
                        {matchText(r)}
                      </td>
                      <td className="px-3 py-2">
                        <VerdictBadge verdict={r.target} off={!r.enabled} />
                      </td>
                      <td
                        className="px-3 py-2 text-right text-xs tabular"
                        title={hits === undefined ? undefined : `${String(hits)} packets since the firewall last started`}
                      >
                        {hitsText(hits)}
                      </td>
                      <td className="px-3 py-2">{toggle(r)}</td>
                      <td className="px-2 py-1 text-right">{edit(r)}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        {/* phones and narrow windows: a card per rule */}
        <div className="lg:hidden">
          {groups.map(({ chain, rows }) => (
            <section key={chain.key} aria-label={`${chain.from} to ${chain.to}`}>
              <ChainHeader chain={chain} actions={actions} />
              <ul className="divide-y">
                {rows.map((row) => {
                  if (row.kind === 'openwrt') {
                    return (
                      <li key={`fold-${row.rules[0]?.section ?? ''}`} className="px-4 py-3">
                        <Folded rules={row.rules} onShow={showAll} />
                      </li>
                    );
                  }
                  const r = row.rule;
                  const title = r.name ?? r.label;
                  const up = moveTarget(rows, r.section, 'up');
                  const down = moveTarget(rows, r.section, 'down');
                  const hits = counters?.rules.get(r.label);
                  return (
                    <li key={r.section} className="flex flex-col gap-2 px-4 py-3">
                      <span className="flex items-start justify-between gap-3">
                        <span className="flex min-w-0 gap-2">
                          <span className="pt-px text-xs text-muted-foreground tabular">{number.get(r.section)}</span>
                          <NameCell r={r} wide={false} dc={dc.get(r.section)} />
                        </span>
                        <VerdictBadge verdict={r.target} off={!r.enabled} />
                      </span>
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                        <FromCell r={r} data={data} />
                        <ArrowRightIcon className="size-3.5 shrink-0 text-muted-foreground" aria-label="to" />
                        <ToCell r={r} data={data} />
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
                          {toggle(r)}
                          <span aria-hidden="true">{r.enabled ? 'On' : 'Off'}</span>
                        </span>
                        <span className="flex items-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Move ${title} up`}
                            disabled={up === undefined || actions.applying}
                            onClick={() => {
                              move(rows, r, 'up');
                            }}
                          >
                            <ArrowUpIcon />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            aria-label={`Move ${title} down`}
                            disabled={down === undefined || actions.applying}
                            onClick={() => {
                              move(rows, r, 'down');
                            }}
                          >
                            <ArrowDownIcon />
                          </Button>
                          {edit(r)}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Card>
      <p className="hidden max-w-prose text-xs text-muted-foreground lg:block">
        Within a chain the first matching rule wins: drag the grip to reorder (or focus it and use ↑ ↓). Click a rule to edit or
        delete it. Hits count since the firewall last started.
      </p>
      <p className="text-xs text-muted-foreground lg:hidden">
        Within a chain the first matching rule wins: move a rule with its arrows. Its edit button opens it, to change or delete
        it. Hits count since the firewall last started.
      </p>
    </div>
  );
}
