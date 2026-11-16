// NAT rules (fw4 nat sections): which address traffic leaves with, as a
// table, and the dialog that edits one. Zones that share the router's
// address (masquerading) need none; these are the exceptions.
import { MonitorIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Change } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import { type Actions, hitsText, rowClick, splitList } from './forms';
import {
  editSection,
  enabledChange,
  type Family,
  isAddress,
  isIpv4,
  isShortName,
  type NatRule,
  portError,
  zoneTitle,
} from './model';
import { DialogField, Segmented } from './parts';
import { UciPreview } from './sheet-parts';
import { GroupHeader, HeadRow, HeaderButton, OffBadge, OnSwitch, RowButton, Who } from './table-parts';
import { EditorSheet } from '@/components/editor-sheet';

type NatTarget = 'MASQUERADE' | 'SNAT' | 'ACCEPT';
type NatProto = 'all' | 'tcp udp' | 'tcp' | 'udp';

interface NatForm {
  name: string;
  target: NatTarget;
  src: string;
  srcIp: string;
  destIp: string;
  proto: NatProto;
  destPort: string;
  snatIp: string;
  snatPort: string;
  family: Family;
}

function natTarget(t: string): NatTarget {
  return t === 'SNAT' || t === 'ACCEPT' ? t : 'MASQUERADE';
}

function natProto(p: readonly string[]): NatProto {
  const j = p.join(' ');
  return j === 'tcp' || j === 'udp' || j === 'tcp udp' ? j : 'all';
}

export function NatSheet({
  nat,
  data,
  onClose,
  onSave,
  onDelete,
}: {
  nat: NatRule | undefined;
  data: FirewallData;
  onClose: () => void;
  onSave: (c: Change[]) => void;
  /** asks first, then deletes the rule (an existing one only) */
  onDelete?: (() => void) | undefined;
}): ReactElement {
  const [f, setF] = useState<NatForm>(() => ({
    name: nat?.name ?? '',
    target: natTarget(nat?.target ?? 'SNAT'),
    src: nat?.src ?? data.cfg.zones.find((z) => z.name === 'wan')?.name ?? data.cfg.zones[0]?.name ?? 'wan',
    srcIp: nat?.srcIp.join(' ') ?? '',
    destIp: nat?.destIp.join(' ') ?? '',
    proto: natProto(nat?.proto ?? ['all']),
    destPort: nat?.destPort ?? '',
    snatIp: nat?.snatIp ?? '',
    snatPort: nat?.snatPort ?? '',
    family: nat?.family ?? 'ipv4',
  }));
  const set = <K extends keyof NatForm>(key: K, value: NatForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const ports = f.proto !== 'all';
  const e: Partial<Record<keyof NatForm, string>> = {};
  if (!isShortName(f.name)) e.name = 'A short name.';
  // one address or network each: fw4 takes no lists in NAT rules
  const addrError = (v: string): string | undefined => {
    const a = splitList(v);
    if (a.length > 1) return 'One address or network.';
    return a[0] !== undefined && !isAddress(a[0]) ? `“${a[0]}” isn’t an address or network.` : undefined;
  };
  const bs = addrError(f.srcIp);
  if (bs !== undefined) e.srcIp = bs;
  const bd = addrError(f.destIp);
  if (bd !== undefined) e.destIp = bd;
  const portProblem = ports && f.destPort !== '' ? portError(f.destPort) : undefined;
  if (portProblem !== undefined) e.destPort = portProblem;
  if (f.target === 'SNAT' && !isIpv4(f.snatIp)) e.snatIp = 'The address to send from, e.g. 203.0.113.9.';
  const snatPortProblem = f.target === 'SNAT' && ports && f.snatPort !== '' ? portError(f.snatPort) : undefined;
  if (snatPortProblem !== undefined) e.snatPort = snatPortProblem;
  const section = nat === undefined ? undefined : data.sections.find((s) => s['.name'] === nat.section);

  const changes = editSection('nat', section, {
    name: f.name.trim(),
    target: f.target,
    src: f.src,
    src_ip: f.srcIp.trim() === '' ? undefined : f.srcIp.trim(),
    dest_ip: f.destIp.trim() === '' ? undefined : f.destIp.trim(),
    proto: f.proto,
    dest_port: ports && f.destPort !== '' ? f.destPort : undefined,
    snat_ip: f.target === 'SNAT' ? f.snatIp : undefined,
    snat_port: f.target === 'SNAT' && ports && f.snatPort !== '' ? f.snatPort : undefined,
    family: f.family === 'any' ? undefined : f.family,
  });

  return (
    <EditorSheet
      title={nat === undefined ? 'New NAT rule' : (nat.name ?? 'Edit NAT rule')}
      description="Which address traffic leaves with. Rarely needed: zones that share the router’s address already do it for everything."
      onClose={onClose}
      status={
        nat !== undefined &&
        onDelete !== undefined && (
          <Button variant="ghost" className="-ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2Icon /> Delete
          </Button>
        )
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={Object.keys(e).length > 0 || changes.length === 0}
            onClick={() => {
              onSave(changes);
            }}
          >
            Save NAT rule
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-6 py-5">
        <DialogField id="nat-name" label="Name" error={f.name === '' ? undefined : e.name}>
          <Input
            id="nat-name"
            value={f.name}
            onChange={(ev) => {
              set('name', ev.target.value);
            }}
          />
        </DialogField>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Action</span>
          <Segmented<NatTarget>
            label="Action"
            value={f.target}
            onChange={(v) => {
              set('target', v);
            }}
            options={[
              { value: 'SNAT', label: 'Send from an address' },
              { value: 'MASQUERADE', label: 'Share the router’s' },
              { value: 'ACCEPT', label: 'No NAT' },
            ]}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DialogField id="nat-zone" label="Leaving through">
            <Select
              value={f.src}
              onValueChange={(v) => {
                set('src', v);
              }}
            >
              <SelectTrigger id="nat-zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.cfg.zones.map((z) => (
                  <SelectItem key={z.name} value={z.name}>
                    {zoneTitle(z.name, data.cfg)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DialogField>
          <DialogField id="nat-proto" label="Protocol">
            <Select
              value={f.proto}
              onValueChange={(v) => {
                set('proto', natProto(v.split(' ')));
              }}
            >
              <SelectTrigger id="nat-proto">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Everything</SelectItem>
                <SelectItem value="tcp udp">TCP and UDP</SelectItem>
                <SelectItem value="tcp">TCP</SelectItem>
                <SelectItem value="udp">UDP</SelectItem>
              </SelectContent>
            </Select>
          </DialogField>
          <DialogField id="nat-src-ip" label="From address" hint="Or network. Empty: any." error={e.srcIp}>
            <Input
              id="nat-src-ip"
              className="font-mono"
              value={f.srcIp}
              placeholder="Any"
              onChange={(ev) => {
                set('srcIp', ev.target.value);
              }}
            />
          </DialogField>
          <DialogField id="nat-dest-ip" label="To address" hint="Or network. Empty: any." error={e.destIp}>
            <Input
              id="nat-dest-ip"
              className="font-mono"
              value={f.destIp}
              placeholder="Any"
              onChange={(ev) => {
                set('destIp', ev.target.value);
              }}
            />
          </DialogField>
          {ports && (
            <DialogField id="nat-port" label="To port" hint="Empty: any." error={e.destPort}>
              <Input
                id="nat-port"
                className="tabular"
                value={f.destPort}
                placeholder="Any"
                onChange={(ev) => {
                  set('destPort', ev.target.value.trim());
                }}
              />
            </DialogField>
          )}
        </div>
        {f.target === 'SNAT' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <DialogField id="nat-snat-ip" label="Send from address" error={f.snatIp === '' ? undefined : e.snatIp}>
              <Input
                id="nat-snat-ip"
                className="font-mono"
                value={f.snatIp}
                onChange={(ev) => {
                  set('snatIp', ev.target.value.trim());
                }}
              />
            </DialogField>
            {ports && (
              <DialogField id="nat-snat-port" label="Send from port" hint="Empty: keep it." error={e.snatPort}>
                <Input
                  id="nat-snat-port"
                  className="tabular"
                  value={f.snatPort}
                  onChange={(ev) => {
                    set('snatPort', ev.target.value.trim());
                  }}
                />
              </DialogField>
            )}
          </div>
        )}
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">IP version</span>
          <Segmented<Family>
            label="IP version"
            value={f.family}
            onChange={(v) => {
              set('family', v);
            }}
            options={[
              { value: 'ipv4', label: 'IPv4' },
              { value: 'ipv6', label: 'IPv6' },
              { value: 'any', label: 'Both' },
            ]}
          />
        </div>
      </div>
      <div className="border-t px-6 py-5">
        <UciPreview type="nat" original={section} changes={changes} />
      </div>
    </EditorSheet>
  );
}

const natLabels: Record<string, string> = { MASQUERADE: 'masquerade', SNAT: 'snat', ACCEPT: 'no nat' };

const columns = [
  { label: 'Name' },
  { label: 'Leaves via' },
  { label: 'From' },
  { label: 'To' },
  { label: 'Proto' },
  { label: 'Action' },
  { label: 'Sent as' },
  { label: 'Hits', className: 'text-right' },
  { label: 'On', className: 'w-14' },
  { label: 'Edit', className: 'w-12', hidden: true },
] as const;

/** Where a NAT rule's traffic goes: addresses and the port in mono, "anywhere" in words. */
function To({ r }: { r: NatRule }): ReactElement {
  const port = r.destPort === undefined ? '' : `:${r.destPort}`;
  if (r.destIp.length > 0) return <span className="font-mono">{`${r.destIp.join(' ')}${port}`}</span>;
  return (
    <>
      anywhere
      {port !== '' && <span className="font-mono">{port}</span>}
    </>
  );
}

/** The address a NAT rule sends traffic from: in mono when the rule names one. */
function SentAs({ r }: { r: NatRule }): ReactElement {
  if (r.target === 'SNAT')
    return <span className="font-mono">{`${r.snatIp ?? '?'}${r.snatPort === undefined ? '' : `:${r.snatPort}`}`}</span>;
  return <>{r.target === 'MASQUERADE' ? 'the router’s address' : 'its own address'}</>;
}

export function NatTable({
  data,
  counters,
  actions,
}: {
  data: FirewallData;
  counters: Counters | undefined;
  actions: Actions;
}): ReactElement {
  const nats = data.cfg.nats;
  const masq = data.cfg.zones.filter((z) => z.masq).map((z) => z.name);
  const header = (colSpan?: number): ReactElement => (
    <GroupHeader
      title={<span className="font-medium">NAT rules</span>}
      count={nats.length}
      noun={['rule', 'rules']}
      {...(colSpan === undefined ? {} : { colSpan })}
      action={
        <HeaderButton
          disabled={actions.applying}
          onClick={() => {
            actions.editNat(undefined);
          }}
        >
          <PlusIcon /> Add NAT rule
        </HeaderButton>
      }
    />
  );
  const toggle = (r: NatRule): ReactElement => (
    <OnSwitch
      on={r.enabled}
      name={r.name ?? r.label}
      disabled={actions.applying}
      onToggle={() => {
        actions.apply([enabledChange(r.section, !r.enabled)]);
      }}
    />
  );
  const edit = (r: NatRule): ReactElement => (
    <RowButton
      label={`Edit ${r.name ?? r.label}`}
      icon={SquarePenIcon}
      onClick={() => {
        actions.editNat(r);
      }}
    />
  );
  const empty = `None: ${masq.length === 0 ? 'no zone shares the router’s address' : `${masq.join(', ')} share${masq.length === 1 ? 's' : ''} the router’s address (masquerading)`}, which covers ordinary use.`;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <thead>
            <HeadRow columns={columns} />
          </thead>
          <tbody>
            {header(columns.length)}
            {nats.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-2.5 text-sm text-muted-foreground">
                  {empty}
                </td>
              </tr>
            )}
            {nats.map((r) => (
              <tr
                key={r.section}
                onClick={rowClick(() => {
                  actions.editNat(r);
                })}
                className={cn('cursor-pointer border-b last:border-b-0 hover:bg-muted/60', !r.enabled && 'text-muted-foreground')}
              >
                <td className="max-w-48 px-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={cn('truncate font-medium', r.enabled && 'text-foreground')}>{r.name ?? r.label}</span>
                    {!r.enabled && <OffBadge />}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.src ?? '—'}</td>
                <td className="px-3 py-1.5">
                  {r.srcIp.length === 0 ? (
                    <span className="text-muted-foreground">anyone</span>
                  ) : (
                    <Who icon={MonitorIcon} mono={r.srcIp.some((ip) => !data.names.byIp.has(ip))}>
                      {r.srcIp.map((ip) => data.names.byIp.get(ip) ?? ip).join(' ')}
                    </Who>
                  )}
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <To r={r} />
                </td>
                <td className="px-3 py-1.5 text-xs">{r.proto.includes('all') ? 'any' : r.proto.join('/')}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="secondary" className="font-normal">
                    {natLabels[r.target] ?? r.target.toLowerCase()}
                  </Badge>
                </td>
                <td className="px-3 py-1.5 text-xs">
                  <SentAs r={r} />
                </td>
                <td className="px-3 py-1.5 text-right text-xs tabular">{hitsText(counters?.nat.get(r.label))}</td>
                <td className="px-3 py-1.5">{toggle(r)}</td>
                <td className="px-2 py-0.5 text-right">{edit(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="lg:hidden">
        {header()}
        {nats.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">{empty}</p>}
        <ul className="divide-y">
          {nats.map((r) => (
            <li key={r.section} className="flex flex-col gap-1.5 px-4 py-3">
              <span className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{r.name ?? r.label}</span>
                  {!r.enabled && <OffBadge />}
                </span>
                <Badge variant="secondary" className="font-normal">
                  {natLabels[r.target] ?? r.target.toLowerCase()}
                </Badge>
              </span>
              <span className="text-xs break-words text-muted-foreground">
                {r.srcIp.length === 0 ? 'anyone' : <span className="font-mono">{r.srcIp.join(' ')}</span>} → <To r={r} /> via{' '}
                {zoneTitle(r.src ?? '', data.cfg)}, sent as <SentAs r={r} />
              </span>
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {toggle(r)}
                  {r.enabled ? 'On' : 'Off'}
                </span>
                {edit(r)}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
