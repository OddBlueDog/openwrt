// Traffic rules as a table, one group per chain they land in: from a zone to
// the router, from a zone on through it, from the router out. fw4 checks a
// chain's rules in order and the first that matches decides, so order
// matters within a group: drag a rule's grip (or focus it and use the arrow
// keys) to move it. On a phone each rule is a card with up and down buttons.
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
  Trash2Icon,
} from 'lucide-react';
import { type DragEvent, type KeyboardEvent, type ReactElement, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { Change } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import { type Actions, hitsText } from './forms';
import { builtInRules, enabledChange, type FirewallConfig, managedBy, portsText, type Rule, scheduleText, zoneTitle } from './model';
import { GroupHeader, HeadRow, HeaderButton, Path, PowerButton, RouterPill, RowButton, VerdictBadge, Who } from './table-parts';

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
  if (r.src === undefined) return { key: `out:${r.dest ?? ''}`, from: 'Router', to: r.dest === undefined ? 'Anywhere' : zoneName(r.dest, cfg), src: '', dest: r.dest ?? '' };
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

function FromCell({ r, data }: { r: Rule; data: FirewallData }): ReactElement {
  if (r.srcMac.length > 0) return <Who icon={MonitorIcon} title={r.srcMac.join(', ')}>{more(r.srcMac.map((m) => data.names.byMac.get(m) ?? m))}</Who>;
  if (r.srcIp.length > 0) return <Who icon={MonitorIcon} title={r.srcIp.join(', ')}>{more(r.srcIp.map((ip) => data.names.byIp.get(ip) ?? ip))}</Who>;
  if (r.src === undefined) return <RouterPill />;
  if (r.src === '*') return <Who icon={GlobeIcon}>any</Who>;
  return <Who icon={ShieldIcon}>{r.src}</Who>;
}

function ToCell({ r, data }: { r: Rule; data: FirewallData }): ReactElement {
  if (r.destIp.length > 0) return <Who icon={MonitorIcon} title={r.destIp.join(', ')}>{more(r.destIp.map((ip) => data.names.byIp.get(ip) ?? ip))}</Who>;
  if (r.dest === undefined) return <RouterPill />;
  if (r.dest === '*') return <Who icon={GlobeIcon}>any</Who>;
  return <Who icon={ShieldIcon}>{r.dest}</Who>;
}

function protoText(r: Rule): string {
  if (r.proto.includes('all')) return r.family === 'any' ? 'any' : `any · ${r.family === 'ipv4' ? 'v4' : 'v6'}`;
  const icmp6 = r.family === 'ipv6' && r.proto.length === 1 && r.proto[0] === 'icmp';
  const p = icmp6 ? 'icmpv6' : r.proto.join('/');
  return r.family === 'any' || icmp6 ? p : `${p} · ${r.family === 'ipv4' ? 'v4' : 'v6'}`;
}

function matchText(r: Rule): string {
  const parts: string[] = [];
  if (r.destPort.length > 0) parts.push(r.destPort.join(' '));
  if (r.srcPort.length > 0) parts.push(`from ${portsText(r.srcPort)}`);
  if (r.icmpTypes.length > 0) parts.push(r.icmpTypes.length <= 2 ? r.icmpTypes.join(' ') : `${String(r.icmpTypes.length)} types`);
  if (r.limit !== undefined) parts.push(`≤${r.limit.replace(/\/(sec|second)$/, '/s').replace(/\/(minute|min)$/, '/min')}`);
  const when = scheduleText(r.schedule);
  if (when !== undefined) parts.push(when);
  return parts.length === 0 ? '—' : parts.join(' · ');
}

function why(r: Rule): string | undefined {
  const managed = managedBy[r.section];
  if (managed !== undefined) return `Made by the ${managed.title} page.`;
  return r.name === undefined ? undefined : builtInRules[r.name];
}

/** The order with `section` moved to where `target` is (after it when moving down). */
function moveTo(data: FirewallData, section: string, target: string): Change {
  const order = data.cfg.order.filter((s) => s !== section);
  const down = data.cfg.order.indexOf(section) < data.cfg.order.indexOf(target);
  order.splice(order.indexOf(target) + (down ? 1 : 0), 0, section);
  return { op: 'order', config: 'firewall', sections: order };
}

function RowActions({ r, actions }: { r: Rule; actions: Actions }): ReactElement {
  const title = r.name ?? r.label;
  return (
    <span className="flex items-center justify-end">
      <PowerButton
        on={r.enabled}
        name={title}
        disabled={actions.applying}
        onToggle={() => {
          actions.apply([enabledChange(r.section, !r.enabled)]);
        }}
      />
      <RowButton
        label={`Edit ${title}`}
        icon={SquarePenIcon}
        onClick={() => {
          actions.editRule(r);
        }}
      />
      <RowButton
        label={`Delete ${title}`}
        icon={Trash2Icon}
        disabled={actions.applying}
        onClick={() => {
          const reason = why(r);
          actions.confirm({
            title: `Delete ${title}?`,
            body: reason === undefined ? 'The rule is gone for good; turning it off keeps it for later.' : `${reason} Turning it off keeps it for later.`,
            action: 'Delete',
            changes: [{ op: 'delete', config: 'firewall', section: r.section }],
          });
        }}
      />
    </span>
  );
}

const columns = [
  { label: '#', className: 'w-16' },
  { label: 'Name' },
  { label: 'From' },
  { label: 'To' },
  { label: 'Proto' },
  { label: 'Match' },
  { label: 'Action' },
  { label: 'Hits', className: 'text-right' },
  { label: 'Actions', className: 'w-28', hidden: true },
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
            actions.editRule(undefined, { name: '', target: 'ACCEPT', src: chain.src, dest: chain.dest, proto: 'tcp udp', ports: '' });
          }}
        >
          <PlusIcon /> Add rule
        </HeaderButton>
      }
    />
  );
}

export function RulesTable({ data, counters, actions }: { data: FirewallData; counters: Counters | undefined; actions: Actions }): ReactElement {
  const groups = chains(data.cfg.rules, data.cfg);
  const number = new Map(data.cfg.rules.map((r, i) => [r.section, i + 1]));
  // a row drags only from its grip: the grip arms it on pointer down
  const armed = useRef<string | undefined>(undefined);
  const [dragging, setDragging] = useState<Chain['key'] | undefined>();
  const [over, setOver] = useState<string>();
  const neighbours = (chain: Chain, r: Rule): { up: Rule | undefined; down: Rule | undefined } => {
    const i = chain.rules.indexOf(r);
    return { up: chain.rules[i - 1], down: chain.rules[i + 1] };
  };
  const onGripKey = (e: KeyboardEvent, chain: Chain, r: Rule): void => {
    const { up, down } = neighbours(chain, r);
    const to = e.key === 'ArrowUp' ? up : e.key === 'ArrowDown' ? down : undefined;
    if (to === undefined || actions.applying) return;
    e.preventDefault();
    actions.apply([moveTo(data, r.section, to.section)]);
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
      if (dragging === chain.key && from !== '' && from !== r.section) actions.apply([moveTo(data, from, r.section)]);
    },
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {data.cfg.rules.length} rules in {groups.length} chain{groups.length === 1 ? '' : 's'}
        </p>
        <div className="flex gap-2">
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
            {groups.map((chain) => (
              <tbody key={chain.key}>
                <ChainHeader chain={chain} actions={actions} colSpan={columns.length} />
                {chain.rules.map((r) => {
                  const title = r.name ?? r.label;
                  const hits = counters?.rules.get(r.label);
                  return (
                    <tr
                      key={r.section}
                      draggable={!actions.applying && chain.rules.length > 1}
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
                      className={cn(
                        'border-b last:border-b-0 hover:bg-accent/30',
                        !r.enabled && 'text-muted-foreground [&_td:not(:last-child)]:opacity-60',
                        over === r.section && 'bg-primary/5 outline outline-1 -outline-offset-1 outline-primary/40',
                      )}
                    >
                      <td className="px-3 py-1.5">
                        <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular">
                          <button
                            type="button"
                            className="cursor-grab rounded p-0.5 hover:bg-accent active:cursor-grabbing disabled:cursor-not-allowed"
                            aria-label={`Move ${title}: drag, or use the up and down arrow keys`}
                            title="Drag to move, or focus and use ↑ ↓"
                            disabled={actions.applying || chain.rules.length < 2}
                            onPointerDown={() => {
                              armed.current = r.section;
                            }}
                            onPointerUp={() => {
                              armed.current = undefined;
                            }}
                            onKeyDown={(e) => {
                              onGripKey(e, chain, r);
                            }}
                          >
                            <GripVerticalIcon className="size-3.5" />
                          </button>
                          {number.get(r.section)}
                        </span>
                      </td>
                      <td className="max-w-56 truncate px-3 py-1.5 font-medium" title={why(r)}>
                        {title}
                      </td>
                      <td className="px-3 py-1.5">
                        <FromCell r={r} data={data} />
                      </td>
                      <td className="px-3 py-1.5">
                        <ToCell r={r} data={data} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs whitespace-nowrap">{protoText(r)}</td>
                      <td className="max-w-56 truncate px-3 py-1.5 font-mono text-xs" title={matchText(r)}>
                        {matchText(r)}
                      </td>
                      <td className="px-3 py-1.5">
                        <VerdictBadge verdict={r.target} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular" title={hits === undefined ? undefined : `${String(hits)} packets since the firewall last started`}>
                        {hitsText(hits)}
                      </td>
                      <td className="px-2 py-0.5">
                        <RowActions r={r} actions={actions} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        {/* phones and narrow windows: a card per rule */}
        <div className="lg:hidden">
          {groups.map((chain) => (
            <section key={chain.key} aria-label={`${chain.from} to ${chain.to}`}>
              <ChainHeader chain={chain} actions={actions} />
              <ul className="divide-y">
                {chain.rules.map((r) => {
                  const title = r.name ?? r.label;
                  const { up, down } = neighbours(chain, r);
                  const hits = counters?.rules.get(r.label);
                  return (
                    <li key={r.section} className={cn('flex flex-col gap-1.5 px-4 py-3', !r.enabled && 'text-muted-foreground')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium" title={why(r)}>
                          <span className="text-xs font-normal text-muted-foreground tabular">{number.get(r.section)}</span>
                          <span className="truncate">{title}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular">{hits === undefined ? '' : hitsText(hits)}</span>
                          <VerdictBadge verdict={r.target} />
                        </span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 text-sm">
                        <FromCell r={r} data={data} />
                        <ArrowRightIcon className="size-3.5 text-muted-foreground" aria-label="to" />
                        <ToCell r={r} data={data} />
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {protoText(r)}
                        {matchText(r) === '—' ? '' : ` · ${matchText(r)}`}
                      </span>
                      <span className="flex items-center justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          aria-label={`Move ${title} up`}
                          disabled={up === undefined || actions.applying}
                          onClick={() => {
                            if (up !== undefined) actions.apply([moveTo(data, r.section, up.section)]);
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
                            if (down !== undefined) actions.apply([moveTo(data, r.section, down.section)]);
                          }}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <RowActions r={r} actions={actions} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </Card>
      <p className="text-right text-xs text-muted-foreground">
        Within a chain the first matching rule wins: drag the grip to reorder (or focus it and use ↑ ↓), or add to a chain from its header. Hits
        count since the firewall last started.
      </p>
    </div>
  );
}
