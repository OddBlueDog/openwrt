// NAT rules (fw4 nat sections): which address traffic leaves with, as a
// table, and the dialog that edits one. Zones that share the router's
// address (masquerading) need none; these are the exceptions.
import { MonitorIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Change } from '@/lib/api/uci';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import { type Actions, hitsText, splitList } from './forms';
import { editSection, enabledChange, type Family, isAddress, isIpv4, isShortName, type NatRule, portError, zoneTitle } from './model';
import { DialogField, Segmented } from './parts';
import { GroupHeader, HeadRow, HeaderButton, PowerButton, RowButton, Who } from './table-parts';

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

export function NatDialog({ nat, data, onClose, onSave }: { nat: NatRule | undefined; data: FirewallData; onClose: () => void; onSave: (c: Change[]) => void }): ReactElement {
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

  const save = (): void => {
    onSave(
      editSection('nat', section, {
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
      }),
    );
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{nat === undefined ? 'New NAT rule' : 'Edit NAT rule'}</DialogTitle>
          <DialogDescription>
            Which address traffic leaves with. Rarely needed: zones that share the router’s address already do it for everything.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
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
                  className="font-mono"
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
                    className="font-mono"
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
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Object.keys(e).length > 0} onClick={save}>
            Save &amp; apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const natLabels: Record<string, string> = { MASQUERADE: 'masquerade', SNAT: 'snat', ACCEPT: 'no nat' };

const columns = [
  { label: '#', className: 'w-12' },
  { label: 'Name' },
  { label: 'Leaves via' },
  { label: 'From' },
  { label: 'To' },
  { label: 'Proto' },
  { label: 'Action' },
  { label: 'Sent as' },
  { label: 'Hits', className: 'text-right' },
  { label: 'Actions', className: 'w-28', hidden: true },
] as const;

function NatActions({ r, actions }: { r: NatRule; actions: Actions }): ReactElement {
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
          actions.editNat(r);
        }}
      />
      <RowButton
        label={`Delete ${title}`}
        icon={Trash2Icon}
        disabled={actions.applying}
        onClick={() => {
          actions.confirm({ title: `Delete ${title}?`, body: 'The NAT rule is gone for good; turning it off keeps it for later.', action: 'Delete', changes: [{ op: 'delete', config: 'firewall', section: r.section }] });
        }}
      />
    </span>
  );
}

const to = (r: NatRule): string => `${r.destIp.length === 0 ? 'anywhere' : r.destIp.join(' ')}${r.destPort === undefined ? '' : `:${r.destPort}`}`;
const sentAs = (r: NatRule): string =>
  r.target === 'SNAT' ? `${r.snatIp ?? '?'}${r.snatPort === undefined ? '' : `:${r.snatPort}`}` : r.target === 'MASQUERADE' ? 'the router’s address' : 'its own address';

export function NatTable({ data, counters, actions }: { data: FirewallData; counters: Counters | undefined; actions: Actions }): ReactElement {
  const nats = data.cfg.nats;
  const number = new Map(nats.map((r, i) => [r.section, i + 1]));
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
              <tr key={r.section} className={cn('border-b last:border-b-0 hover:bg-accent/30', !r.enabled && 'text-muted-foreground [&_td:not(:last-child)]:opacity-60')}>
                <td className="px-3 py-1.5 text-xs text-muted-foreground tabular">{number.get(r.section)}</td>
                <td className="max-w-48 truncate px-3 py-1.5 font-medium">{r.name ?? r.label}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.src ?? '—'}</td>
                <td className="px-3 py-1.5">
                  {r.srcIp.length === 0 ? (
                    <span className="text-muted-foreground">anyone</span>
                  ) : (
                    <Who icon={MonitorIcon}>{r.srcIp.map((ip) => data.names.byIp.get(ip) ?? ip).join(' ')}</Who>
                  )}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{to(r)}</td>
                <td className="px-3 py-1.5 font-mono text-xs">{r.proto.includes('all') ? 'any' : r.proto.join('/')}</td>
                <td className="px-3 py-1.5">
                  <Badge variant="secondary" className="font-mono font-normal">
                    {natLabels[r.target] ?? r.target.toLowerCase()}
                  </Badge>
                </td>
                <td className="px-3 py-1.5 font-mono text-xs">{sentAs(r)}</td>
                <td className="px-3 py-1.5 text-right text-xs tabular">{hitsText(counters?.nat.get(r.label))}</td>
                <td className="px-2 py-0.5">
                  <NatActions r={r} actions={actions} />
                </td>
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
            <li key={r.section} className={cn('flex flex-col gap-1 px-4 py-3', !r.enabled && 'text-muted-foreground')}>
              <span className="flex items-center justify-between gap-2 text-sm font-medium">
                {r.name ?? r.label}
                <Badge variant="secondary" className="font-mono font-normal">
                  {natLabels[r.target] ?? r.target.toLowerCase()}
                </Badge>
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {r.srcIp.length === 0 ? 'anyone' : r.srcIp.join(' ')} → {to(r)} via {zoneTitle(r.src ?? '', data.cfg)}, sent as {sentAs(r)}
              </span>
              <NatActions r={r} actions={actions} />
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
