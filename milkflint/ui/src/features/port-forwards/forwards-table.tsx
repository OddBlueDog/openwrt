// Port forwards as a table: forwards from the internet grouped by where they
// go, the redirects inside the network (the DNS page's intercept), and the
// ports devices opened themselves with UPnP, which are miniupnpd's to manage
// and only shown here. A row opens its side sheet (which also deletes it);
// on a phone each row is a card.
import { pageLink } from '@/lib/router';
import { Link } from '@tanstack/react-router';
import { ChevronRightIcon, MonitorIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type Counters, type FirewallData, unreservedDevice, type UpnpMapping, zoneForIp } from '../firewall/api';
import { type Actions, hitsText, rowClick } from '../firewall/forms';
import { enabledChange, isDmz, isInternetForward, managedBy, type Redirect, wanZone, zoneTitle } from '../firewall/model';
import {
  GroupHeader,
  HeaderButton,
  OffBadge,
  OnSwitch,
  OriginMark,
  Path,
  RouterPill,
  RowButton,
  Who,
} from '../firewall/table-parts';
import { portText } from './summary';

interface Group {
  /** in words, by the zones' names: unique, and its section's name on a phone */
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
  byKey.set(`forwards from ${wan} to lan`, {
    key: `forwards from ${wan} to lan`,
    from: zoneName(wan, data),
    to: zoneName('lan', data),
    internet: true,
    rows: [],
  });
  for (const r of data.cfg.redirects) {
    const internet = isInternetForward(r, data.cfg);
    const dest =
      r.target !== 'DNAT' ? 'snat' : r.destIp === undefined ? 'router' : (r.dest ?? zoneForIp(data, r.destIp) ?? 'lan');
    const key = `${internet ? 'forwards' : 'redirects'} from ${r.src ?? '*'} to ${dest}`;
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

const dash = (p: string | undefined): string | undefined => p?.replace(/[-:]/, '–');

/** Whether the sheet can edit it: a forward this page made or could have (not another page's, not source NAT). */
const editable = (r: Redirect): boolean => r.target === 'DNAT' && managedBy[r.section] === undefined;

/** What's worth knowing about a forward beside its name: DMZ, loopback off, an address that can change, who made it. */
function Notes({ r, data }: { r: Redirect; data: FirewallData }): ReactElement | null {
  const managed = managedBy[r.section];
  const internet = isInternetForward(r, data.cfg);
  const notes: ReactElement[] = [];
  if (managed !== undefined) notes.push(<OriginMark key="page" origin={managed} />);
  if (isDmz(r))
    notes.push(
      <Badge key="dmz" variant="warning" className="h-5 px-2">
        every port (DMZ)
      </Badge>,
    );
  if (r.destIp !== undefined && unreservedDevice(data, r.destIp) !== undefined) {
    notes.push(
      <Badge
        key="res"
        variant="warning"
        className="h-5 px-2 font-normal"
        title="The device can get another address, and then the forward stops working: reserve it (edit, or the Clients page)."
      >
        address not reserved
      </Badge>,
    );
  }
  if (internet && !r.reflection) {
    notes.push(
      <Badge
        key="loop"
        variant="outline"
        className="h-5 px-2 font-normal"
        title="NAT loopback is off: it works from outside only"
      >
        no loopback
      </Badge>,
    );
  }
  if (r.target !== 'DNAT')
    notes.push(
      <span key="snat" className="text-xs text-muted-foreground">
        source NAT: edit it in LuCI
      </span>,
    );
  return notes.length === 0 ? null : <span className="flex flex-wrap items-center gap-1.5">{notes}</span>;
}

function ToCell({ r, data }: { r: Redirect; data: FirewallData }): ReactElement {
  if (r.target !== 'DNAT') return <span className="text-muted-foreground">—</span>;
  const port = isDmz(r) ? undefined : dash(r.destPort ?? r.srcDport);
  // the port reads as part of an address, and as a figure after a device's name
  const address = r.destIp !== undefined && !data.names.byIp.has(r.destIp);
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      {r.destIp === undefined ? (
        <RouterPill />
      ) : (
        <Who icon={MonitorIcon} title={r.destIp} mono={address}>
          {data.names.byIp.get(r.destIp) ?? r.destIp}
        </Who>
      )}
      {port !== undefined && (
        <span className={cn('text-xs text-muted-foreground', address ? 'font-mono' : 'tabular')}>:{port}</span>
      )}
    </span>
  );
}

function Name({ r }: { r: Redirect }): ReactElement {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className={cn('truncate font-medium', r.enabled ? 'text-foreground' : 'text-muted-foreground')}>
        {r.name ?? r.label}
      </span>
      {!r.enabled && <OffBadge />}
    </span>
  );
}

/** Edit for what the sheet edits; delete (with a question first) for the rest, which have no sheet. */
function RowAction({ r, actions }: { r: Redirect; actions: Actions }): ReactElement {
  const title = r.name ?? r.label;
  const managed = managedBy[r.section];
  if (editable(r)) {
    return (
      <RowButton
        label={`Edit ${title}`}
        icon={SquarePenIcon}
        onClick={() => {
          actions.editForward(r);
        }}
      />
    );
  }
  return (
    <RowButton
      label={`Delete ${title}`}
      icon={Trash2Icon}
      disabled={actions.applying}
      onClick={() => {
        actions.confirm({
          title: `Delete ${title}?`,
          body:
            managed === undefined
              ? 'It’s gone for good; turning it off keeps it for later.'
              : `The ${managed.title} page made it, and adds it back when you next save there.`,
          action: 'Delete',
          changes: [{ op: 'delete', config: 'firewall', section: r.section }],
        });
      }}
    />
  );
}

function UpnpHeader({ data, count }: { data: FirewallData; count: number }): ReactElement {
  return (
    <GroupHeader
      title={<span className="font-medium">Opened by devices (UPnP)</span>}
      count={count}
      noun={['port', 'ports']}
      action={
        <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-foreground" asChild>
          <Link {...pageLink('upnp')}>
            {data.upnp === true ? 'UPnP settings' : 'Turn UPnP on'} <ChevronRightIcon />
          </Link>
        </Button>
      }
    />
  );
}

function upnpEmpty(data: FirewallData, mappings: readonly UpnpMapping[] | undefined): string | undefined {
  if (data.upnp !== true)
    return 'UPnP is off: games and consoles can’t open the ports they need themselves, and may report a strict NAT type.';
  if (mappings === undefined) return 'Loading…';
  return mappings.length === 0 ? 'No device has opened a port right now.' : undefined;
}

const upnpLeft = (m: UpnpMapping): string =>
  m.remaining === null ? 'open until UPnP restarts' : `closes in ${formatDuration(m.remaining)}`;

/** A row: a forward (or redirect) in the firewall config, or a port a device opened with UPnP, under the same headings. */
type Row = { kind: 'forward'; r: Redirect } | { kind: 'upnp'; m: UpnpMapping };

// (a section's name has no colon, so no forward's key is a mapping's)
const rowKey = (row: Row): string => (row.kind === 'forward' ? row.r.section : `upnp:${row.m.proto}-${String(row.m.ext_port)}`);

const internetPort = (r: Redirect): string =>
  r.target === 'DNAT' ? portText({ ...r, destPort: r.srcDport }) : `${r.proto.join('/')} ${dash(r.srcDport) ?? ''}`.trim();

/** Where a UPnP port goes: the device, and its port. */
function UpnpTo({ m, data }: { m: UpnpMapping; data: FirewallData }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      <Who icon={MonitorIcon} title={m.int_addr} mono={!data.names.byIp.has(m.int_addr)}>
        {data.names.byIp.get(m.int_addr) ?? m.int_addr}
      </Who>
      <span className={cn('text-xs text-muted-foreground', data.names.byIp.has(m.int_addr) ? 'tabular' : 'font-mono')}>
        :{m.int_port}
      </span>
    </span>
  );
}

function Toggle({ r, actions }: { r: Redirect; actions: Actions }): ReactElement {
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

const anyone = <span className="text-xs text-muted-foreground">anyone</span>;

function forwardColumns(data: FirewallData, counters: Counters | undefined, actions: Actions): Column<Row>[] {
  return [
    {
      label: 'Name',
      className: 'max-w-72',
      cell: (row) =>
        row.kind === 'forward' ? (
          <span className="flex min-w-0 flex-col gap-1">
            <Name r={row.r} />
            <Notes r={row.r} data={data} />
          </span>
        ) : (
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-medium" title={row.m.description}>
              {row.m.description === '' ? 'No description' : row.m.description}
            </span>
            <span className="text-xs text-muted-foreground">{upnpLeft(row.m)}</span>
          </span>
        ),
    },
    {
      label: 'Internet port',
      className: 'text-xs whitespace-nowrap',
      cell: (row) => (row.kind === 'forward' ? internetPort(row.r) : `${row.m.proto.toLowerCase()} ${String(row.m.ext_port)}`),
    },
    {
      label: 'Goes to',
      cell: (row) => (row.kind === 'forward' ? <ToCell r={row.r} data={data} /> : <UpnpTo m={row.m} data={data} />),
    },
    {
      label: 'Only from',
      cell: (row) =>
        row.kind === 'forward' && row.r.srcIp.length > 0 ? (
          <span className="font-mono text-xs">{row.r.srcIp.join(' ')}</span>
        ) : (
          anyone
        ),
    },
    {
      label: 'Hits',
      className: 'text-right text-xs tabular',
      cell: (row) =>
        row.kind === 'forward' ? (
          <span title="Connections since the firewall last started">{hitsText(counters?.nat.get(row.r.label))}</span>
        ) : (
          <span className="text-muted-foreground">–</span>
        ),
    },
    {
      label: 'On',
      className: 'w-14',
      // a UPnP port is miniupnpd's: no switch, just whose it is
      cell: (row) =>
        row.kind === 'forward' ? (
          <Toggle r={row.r} actions={actions} />
        ) : (
          <span className="text-xs text-muted-foreground">UPnP</span>
        ),
    },
    {
      label: 'Edit',
      className: 'w-12 py-1 text-right',
      hidden: true,
      cell: (row) => row.kind === 'forward' && <RowAction r={row.r} actions={actions} />,
    },
  ];
}

/** A row's card on a phone or in a narrow window. */
function ForwardCard({
  row,
  data,
  counters,
  actions,
}: {
  row: Row;
  data: FirewallData;
  counters: Counters | undefined;
  actions: Actions;
}): ReactElement {
  if (row.kind === 'upnp') {
    const { m } = row;
    return (
      <div className="flex flex-col gap-1 px-4 py-3">
        <span className="text-sm font-medium">{m.description === '' ? 'No description' : m.description}</span>
        <span className="text-xs break-all tabular">
          {m.proto.toLowerCase()} {m.ext_port} →{' '}
          {data.names.byIp.has(m.int_addr) ? (
            `${data.names.byIp.get(m.int_addr) ?? ''}:${String(m.int_port)}`
          ) : (
            <span className="font-mono">
              {m.int_addr}:{m.int_port}
            </span>
          )}
        </span>
        <span className="text-xs text-muted-foreground">{upnpLeft(m)}</span>
      </div>
    );
  }
  const { r } = row;
  const hits = counters?.nat.get(r.label);
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <span className="flex items-start justify-between gap-3">
        <Name r={r} />
        {hits !== undefined && (
          <span className="shrink-0 text-xs text-muted-foreground tabular">
            {hitsText(hits)} {hits === 1 ? 'hit' : 'hits'}
          </span>
        )}
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-xs">{internetPort(r)}</span>
        <Path from="" to={<ToCell r={r} data={data} />} />
      </span>
      {r.srcIp.length > 0 && (
        <span className="text-xs break-all text-muted-foreground">
          only from <span className="font-mono">{r.srcIp.join(' ')}</span>
        </span>
      )}
      <Notes r={r} data={data} />
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Toggle r={r} actions={actions} />
          <span aria-hidden="true">{r.enabled ? 'On' : 'Off'}</span>
        </span>
        <RowAction r={r} actions={actions} />
      </span>
    </div>
  );
}

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
  const columns = useMemo(() => forwardColumns(data, counters, actions), [data, counters, actions]);
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
  const groups = [
    ...groupsOf(data).map((g) => ({
      key: g.key,
      header: (
        <GroupHeader
          title={<Path from={g.from} to={g.to} />}
          count={g.rows.length}
          noun={g.internet ? ['forward', 'forwards'] : ['redirect', 'redirects']}
          {...(g.internet ? { action: openPort } : {})}
        />
      ),
      rows: g.rows.map((r): Row => ({ kind: 'forward', r })),
      // only the internet's group is there with nothing in it
      empty: 'No ports are forwarded. Games and consoles that use UPnP open what they need themselves.',
    })),
    ...(upnp === undefined
      ? []
      : [
          {
            key: 'opened by devices (UPnP)',
            header: <UpnpHeader data={data} count={upnp.length} />,
            rows: upnp.map((m): Row => ({ kind: 'upnp', m })),
            empty: upnpEmpty(data, mappings),
          },
        ]),
  ];

  return (
    <div className="flex flex-col gap-3">
      <DataTable
        label="Port forwards"
        columns={columns}
        groups={groups}
        rowKey={rowKey}
        empty="No port forwards."
        wide="lg"
        card={(row) => <ForwardCard row={row} data={data} counters={counters} actions={actions} />}
        rowProps={(row) =>
          row.kind === 'forward'
            ? {
                ...(editable(row.r)
                  ? {
                      onClick: rowClick(() => {
                        actions.editForward(row.r);
                      }),
                    }
                  : {}),
                className: cn(editable(row.r) && 'cursor-pointer', !row.r.enabled && 'text-muted-foreground'),
              }
            : {}
        }
      />
      <p className="max-w-prose text-xs text-muted-foreground">
        To test a forward, connect from outside, e.g. a phone on mobile data: from home it only works with NAT loopback. Hits
        count connections since the firewall last started.
      </p>
    </div>
  );
}
