// Port forwards as a table, like the rules: forwards from the internet
// grouped by where they go, the redirects inside the network (the DNS page's
// intercept), and the ports devices opened themselves with UPnP, which are
// miniupnpd's to manage and only shown here.
import { ChevronRightIcon, DoorOpenIcon, MonitorIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatDuration } from '@/lib/format';
import { href } from '@/lib/router';
import { cn } from '@/lib/utils';
import { type Counters, type FirewallData, unreservedDevice, type UpnpMapping, zoneForIp } from './api';
import { type Actions, hitsText } from './forms';
import { enabledChange, isDmz, isInternetForward, managedBy, type Redirect, wanZone, zoneTitle } from './model';
import { GroupHeader, HeadRow, HeaderButton, Path, PowerButton, RouterPill, RowButton, Who } from './table-parts';

interface Group {
  key: string;
  from: string;
  to: string;
  internet: boolean;
  rows: Redirect[];
}

function zoneName(name: string | undefined, data: FirewallData): string {
  return name === undefined || name === '*' ? 'Any zone' : zoneTitle(name, data.cfg);
}

/** Forwards from the internet first, each kind of redirect grouped by where it comes from and goes. */
function groupsOf(data: FirewallData): Group[] {
  const byKey = new Map<string, Group>();
  const wan = wanZone(data.cfg)?.name ?? 'wan';
  // always a group for forwards from the internet into the home network, to open a port from
  byKey.set(`1:${wan}>lan`, { key: `1:${wan}>lan`, from: zoneName(wan, data), to: zoneName('lan', data), internet: true, rows: [] });
  for (const r of data.cfg.redirects) {
    const internet = isInternetForward(r, data.cfg);
    const dest = r.target !== 'DNAT' ? 'snat' : r.destIp === undefined ? 'router' : (r.dest ?? zoneForIp(data, r.destIp) ?? 'lan');
    const key = `${internet ? 1 : 2}:${r.src ?? '*'}>${dest}`;
    const group = byKey.get(key) ?? {
      key,
      from: zoneName(r.src, data),
      to: dest === 'snat' ? 'Source NAT' : dest === 'router' ? 'Router' : zoneName(dest, data),
      internet,
      rows: [],
    };
    group.rows.push(r);
    byKey.set(key, group);
  }
  // stable: forwards from the internet, then the rest, each in the order they first appear
  return [...byKey.values()].sort((a, b) => Number(b.internet) - Number(a.internet));
}

function protoText(r: Redirect): string {
  return isDmz(r) || r.proto.includes('all') ? 'any' : r.proto.join('/');
}

const dash = (p: string | undefined): string | undefined => p?.replace(/[-:]/, '–');

function Notes({ r, data }: { r: Redirect; data: FirewallData }): ReactElement {
  const managed = managedBy[r.section];
  const internet = isInternetForward(r, data.cfg);
  return (
    <span className="flex flex-wrap items-center gap-1">
      {isDmz(r) && <Badge variant="destructive">every port (DMZ)</Badge>}
      {internet && !r.reflection && (
        <Badge variant="outline" className="font-normal" title="NAT loopback is off: it works from outside only">
          no loopback
        </Badge>
      )}
      {r.destIp !== undefined && unreservedDevice(data, r.destIp) !== undefined && (
        <Badge variant="warning" className="font-normal" title="The device can get another address, and then the forward stops working: reserve it (edit, or the Clients page).">
          not reserved
        </Badge>
      )}
      {r.target !== 'DNAT' && <span className="text-xs text-muted-foreground">source NAT: edit it in LuCI</span>}
      {managed !== undefined && (
        <a href={href(managed.page)} className="text-xs text-primary underline-offset-4 hover:underline">
          {managed.title} page
        </a>
      )}
    </span>
  );
}

function ToCell({ r, data }: { r: Redirect; data: FirewallData }): ReactElement {
  if (r.target !== 'DNAT') return <span className="text-muted-foreground">—</span>;
  if (r.destIp === undefined) return <RouterPill />;
  return (
    <Who icon={MonitorIcon} title={r.destIp}>
      {data.names.byIp.get(r.destIp) ?? r.destIp}
    </Who>
  );
}

function RowActions({ r, actions }: { r: Redirect; actions: Actions }): ReactElement {
  const title = r.name ?? r.label;
  const managed = managedBy[r.section];
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
      {r.target === 'DNAT' && managed === undefined && (
        <RowButton
          label={`Edit ${title}`}
          icon={SquarePenIcon}
          onClick={() => {
            actions.editForward(r);
          }}
        />
      )}
      <RowButton
        label={`Delete ${title}`}
        icon={Trash2Icon}
        disabled={actions.applying}
        onClick={() => {
          actions.confirm({
            title: `Delete ${title}?`,
            body:
              managed === undefined
                ? 'The port closes and the forward is gone; turning it off keeps it for later.'
                : `The ${managed.title} page made it, and adds it back when you next save there.`,
            action: 'Delete',
            changes: [{ op: 'delete', config: 'firewall', section: r.section }],
          });
        }}
      />
    </span>
  );
}

const columns = [
  { label: '#', className: 'w-12' },
  { label: 'Name' },
  { label: 'Proto' },
  { label: 'Port' },
  { label: 'To' },
  { label: 'Device port' },
  { label: 'Only from' },
  { label: 'Notes' },
  { label: 'Hits', className: 'text-right' },
  { label: 'Actions', className: 'w-28', hidden: true },
] as const;

/** One line spanning the table, for an empty group. */
function EmptyRow({ children }: { children: ReactNode }): ReactElement {
  return (
    <tr className="border-b last:border-b-0">
      <td colSpan={columns.length} className="px-3 py-2.5 text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}

function UpnpHeader({ data, count, colSpan }: { data: FirewallData; count: number; colSpan?: number }): ReactElement {
  return (
    <GroupHeader
      title={<span className="font-medium">Opened by devices (UPnP)</span>}
      count={count}
      noun={['port', 'ports']}
      {...(colSpan === undefined ? {} : { colSpan })}
      action={
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" asChild>
          <a href={href('upnp')}>
            {data.upnp === true ? 'UPnP settings' : 'Turn UPnP on'} <ChevronRightIcon />
          </a>
        </Button>
      }
    />
  );
}

function upnpEmpty(data: FirewallData, mappings: readonly UpnpMapping[] | undefined): string | undefined {
  if (data.upnp !== true) return 'UPnP is off: games and consoles can’t open the ports they need themselves, and may report a strict NAT type.';
  if (mappings === undefined) return 'Loading…';
  return mappings.length === 0 ? 'No device has opened a port right now.' : undefined;
}

const upnpLeft = (m: UpnpMapping): string => (m.remaining === null ? 'until UPnP restarts' : `closes in ${formatDuration(m.remaining)}`);

export function ForwardsTable({
  data,
  counters,
  mappings,
  actions,
}: {
  data: FirewallData;
  counters: Counters | undefined;
  mappings: readonly UpnpMapping[] | undefined;
  actions: Actions;
}): ReactElement {
  const groups = groupsOf(data);
  const number = new Map(data.cfg.redirects.map((r, i) => [r.section, i + 1]));
  const forwards = data.cfg.redirects.filter((r) => isInternetForward(r, data.cfg)).length;
  const upnp = data.upnp === undefined ? undefined : (mappings ?? []);
  const openPort = (
    <HeaderButton
      disabled={actions.applying}
      onClick={() => {
        actions.editForward(undefined);
      }}
    >
      <PlusIcon /> Open a port
    </HeaderButton>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {forwards} port forward{forwards === 1 ? '' : 's'} from the internet
          {upnp === undefined || upnp.length === 0 ? '' : `, ${String(upnp.length)} opened by devices`}
        </p>
        <Button
          size="sm"
          disabled={actions.applying}
          onClick={() => {
            actions.editForward(undefined);
          }}
        >
          <DoorOpenIcon /> Open a port
        </Button>
      </div>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <HeadRow columns={columns} />
            </thead>
            {groups.map((g) => (
              <tbody key={g.key}>
                <GroupHeader
                  title={<Path from={g.from} to={g.to} />}
                  count={g.rows.length}
                  noun={g.internet ? ['forward', 'forwards'] : ['redirect', 'redirects']}
                  colSpan={columns.length}
                  {...(g.internet ? { action: openPort } : {})}
                />
                {g.rows.length === 0 && <EmptyRow>No ports are forwarded. Games and consoles that use UPnP open what they need themselves.</EmptyRow>}
                {g.rows.map((r) => {
                  const dmz = isDmz(r);
                  return (
                    <tr key={r.section} className={cn('border-b last:border-b-0 hover:bg-accent/30', !r.enabled && 'text-muted-foreground [&_td:not(:last-child)]:opacity-60')}>
                      <td className="px-3 py-1.5 text-xs text-muted-foreground tabular">{number.get(r.section)}</td>
                      <td className="max-w-48 truncate px-3 py-1.5 font-medium" title={r.name ?? r.label}>
                        {r.name ?? r.label}
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{protoText(r)}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{dmz ? 'all' : (dash(r.srcDport) ?? '—')}</td>
                      <td className="px-3 py-1.5">
                        <ToCell r={r} data={data} />
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs">{dmz ? 'all' : (dash(r.destPort ?? r.srcDport) ?? '—')}</td>
                      <td className="px-3 py-1.5 font-mono text-xs">{r.srcIp.length === 0 ? <span className="font-sans text-muted-foreground">anyone</span> : r.srcIp.join(' ')}</td>
                      <td className="px-3 py-1.5">
                        <Notes r={r} data={data} />
                      </td>
                      <td className="px-3 py-1.5 text-right text-xs tabular" title="Connections since the firewall last started">
                        {hitsText(counters?.nat.get(r.label))}
                      </td>
                      <td className="px-2 py-0.5">
                        <RowActions r={r} actions={actions} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
            {upnp !== undefined && (
              <tbody>
                <UpnpHeader data={data} count={upnp.length} colSpan={columns.length} />
                {upnpEmpty(data, mappings) !== undefined && <EmptyRow>{upnpEmpty(data, mappings)}</EmptyRow>}
                {upnp.map((m) => (
                  <tr key={`${m.proto}-${String(m.ext_port)}`} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">·</td>
                    <td className="max-w-48 truncate px-3 py-1.5 font-medium" title={m.description}>
                      {m.description === '' ? 'No description' : m.description}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{m.proto.toLowerCase()}</td>
                    <td className="px-3 py-1.5 font-mono text-xs">{m.ext_port}</td>
                    <td className="px-3 py-1.5">
                      <Who icon={MonitorIcon} title={m.int_addr}>
                        {data.names.byIp.get(m.int_addr) ?? m.int_addr}
                      </Who>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{m.int_port}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">anyone</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{upnpLeft(m)}</td>
                    <td className="px-3 py-1.5 text-right text-xs">–</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        <div className="lg:hidden">
          {groups.map((g) => (
            <section key={g.key} aria-label={`${g.from} to ${g.to}`}>
              <GroupHeader
                title={<Path from={g.from} to={g.to} />}
                count={g.rows.length}
                noun={g.internet ? ['forward', 'forwards'] : ['redirect', 'redirects']}
                {...(g.internet ? { action: openPort } : {})}
              />
              {g.rows.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No ports are forwarded.</p>}
              <ul className="divide-y">
                {g.rows.map((r) => {
                  const dmz = isDmz(r);
                  return (
                    <li key={r.section} className={cn('flex flex-col gap-1.5 px-4 py-3', !r.enabled && 'text-muted-foreground')}>
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
                          <span className="text-xs font-normal text-muted-foreground tabular">{number.get(r.section)}</span>
                          <span className="truncate">{r.name ?? r.label}</span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular">{hitsText(counters?.nat.get(r.label))}</span>
                      </span>
                      <span className="flex flex-wrap items-center gap-2 font-mono text-xs">
                        <span>
                          {protoText(r)} {dmz ? 'all' : (dash(r.srcDport) ?? '')}
                        </span>
                        <Path from="" to={<ToCell r={r} data={data} />} />
                        {!dmz && r.target === 'DNAT' && <span className="text-muted-foreground">:{dash(r.destPort ?? r.srcDport)}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        {r.srcIp.length > 0 && <span className="font-mono">from {r.srcIp.join(' ')}</span>}
                        <Notes r={r} data={data} />
                      </span>
                      <RowActions r={r} actions={actions} />
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {upnp !== undefined && (
            <section aria-label="Opened by devices (UPnP)">
              <UpnpHeader data={data} count={upnp.length} />
              {upnpEmpty(data, mappings) !== undefined && <p className="px-4 py-3 text-sm text-muted-foreground">{upnpEmpty(data, mappings)}</p>}
              <ul className="divide-y">
                {upnp.map((m) => (
                  <li key={`${m.proto}-${String(m.ext_port)}`} className="flex flex-col gap-1 px-4 py-3">
                    <span className="text-sm font-medium">{m.description === '' ? 'No description' : m.description}</span>
                    <span className="font-mono text-xs">
                      {m.proto.toLowerCase()} {m.ext_port} → {data.names.byIp.get(m.int_addr) ?? m.int_addr}:{m.int_port}
                    </span>
                    <span className="text-xs text-muted-foreground">{upnpLeft(m)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </Card>
      <p className="text-right text-xs text-muted-foreground">
        To test a forward, connect from outside, e.g. a phone on mobile data: from home it only works with NAT loopback. Hits count connections since the
        firewall last started.
      </p>
    </div>
  );
}
