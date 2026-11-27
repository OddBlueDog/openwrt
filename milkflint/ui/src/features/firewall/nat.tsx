// NAT rules (fw4 nat sections): which address traffic leaves with, as a
// table, and the dialog that edits one. Zones that share the router's
// address (masquerading) need none; these are the exceptions.
import { MonitorIcon, PlusIcon, SquarePenIcon, Trash2Icon } from 'lucide-react';
import { type ReactElement, useMemo } from 'react';
import { type Column, DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Change } from '@/lib/api/uci';
import { formErrors } from '@/lib/form/errors';
import { useSheetForm } from '@/lib/form/use-sheet-form';
import { cn } from '@/lib/utils';
import type { Counters, FirewallData } from './api';
import { type Actions, hitsText, rowClick } from './forms';
import { natChanges, type NatForm, natFormOf, natFormSchema, natProto, type NatTarget } from './nat-form';
import { enabledChange, type Family, type NatRule, zoneTitle } from './model';
import { DialogField, Segmented } from './parts';
import { UciPreview } from './sheet-parts';
import { GroupHeader, HeaderButton, OffBadge, OnSwitch, RowButton, Who } from './table-parts';
import { EditorSheet } from '@/components/editor-sheet';

export function NatSheet({
  nat,
  data,
  onClose,
  onSubmit,
  onDelete,
}: {
  nat: NatRule | undefined;
  data: FirewallData;
  onClose: () => void;
  /** applies the changes; the failure's message when that didn't go through */
  onSubmit: (c: Change[]) => Promise<string | undefined>;
  /** asks first, then deletes the rule (an existing one only) */
  onDelete?: (() => void) | undefined;
}): ReactElement {
  const section = nat === undefined ? undefined : data.sections.find((s) => s['.name'] === nat.section);
  const saved = useMemo(() => natFormOf(nat, data.cfg), [nat, data.cfg]);
  const {
    settings,
    values: f,
    failed,
    submitting,
  } = useSheetForm({ schema: natFormSchema, saved, submit: (v) => onSubmit(natChanges(v, section)) });
  const { form } = settings;
  const ports = f.proto !== 'all';
  const e: Partial<Record<keyof NatForm, string>> = formErrors(natFormSchema, f);
  const changes = natChanges(f, section);

  return (
    <EditorSheet
      title={nat === undefined ? 'New NAT rule' : (nat.name ?? 'Edit NAT rule')}
      description="Which address traffic leaves with. Rarely needed: zones that share the router’s address already do it for everything."
      onClose={onClose}
      status={
        <>
          {nat !== undefined && onDelete !== undefined && (
            <Button variant="ghost" className="-ml-2 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2Icon /> Delete
            </Button>
          )}
          {failed !== undefined && <p className="text-xs font-medium text-destructive">{failed}</p>}
        </>
      }
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={Object.keys(e).length > 0 || changes.length === 0 || submitting} onClick={settings.save}>
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
              form.setFieldValue('name', ev.target.value);
            }}
          />
        </DialogField>
        <div className="grid gap-1.5">
          <span className="text-sm font-medium">Action</span>
          <Segmented<NatTarget>
            label="Action"
            value={f.target}
            onChange={(v) => {
              form.setFieldValue('target', v);
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
                form.setFieldValue('src', v);
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
                form.setFieldValue('proto', natProto(v.split(' ')));
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
                form.setFieldValue('srcIp', ev.target.value);
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
                form.setFieldValue('destIp', ev.target.value);
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
                  form.setFieldValue('destPort', ev.target.value.trim());
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
                  form.setFieldValue('snatIp', ev.target.value.trim());
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
                    form.setFieldValue('snatPort', ev.target.value.trim());
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
              form.setFieldValue('family', v);
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

function natColumns(data: FirewallData, counters: Counters | undefined, actions: Actions): Column<NatRule>[] {
  return [
    {
      label: 'Name',
      className: 'max-w-48',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span className={cn('truncate font-medium', r.enabled && 'text-foreground')}>{r.name ?? r.label}</span>
          {!r.enabled && <OffBadge />}
        </span>
      ),
    },
    { label: 'Leaves via', cell: (r) => <span className="font-mono text-xs">{r.src ?? '—'}</span> },
    {
      label: 'From',
      cell: (r) =>
        r.srcIp.length === 0 ? (
          <span className="text-muted-foreground">anyone</span>
        ) : (
          <Who icon={MonitorIcon} mono={r.srcIp.some((ip) => !data.names.byIp.has(ip))}>
            {r.srcIp.map((ip) => data.names.byIp.get(ip) ?? ip).join(' ')}
          </Who>
        ),
    },
    { label: 'To', className: 'text-xs', cell: (r) => <To r={r} /> },
    { label: 'Proto', className: 'text-xs', cell: (r) => (r.proto.includes('all') ? 'any' : r.proto.join('/')) },
    { label: 'Action', cell: (r) => <Verdict r={r} /> },
    { label: 'Sent as', className: 'text-xs', cell: (r) => <SentAs r={r} /> },
    { label: 'Hits', className: 'text-right text-xs tabular', cell: (r) => hitsText(counters?.nat.get(r.label)) },
    { label: 'On', className: 'w-14', cell: (r) => <Toggle r={r} actions={actions} /> },
    { label: 'Edit', className: 'w-12 py-1 text-right', hidden: true, cell: (r) => <Edit r={r} actions={actions} /> },
  ];
}

function Verdict({ r }: { r: NatRule }): ReactElement {
  return (
    <Badge variant="secondary" className="font-normal">
      {natLabels[r.target] ?? r.target.toLowerCase()}
    </Badge>
  );
}

function Toggle({ r, actions }: { r: NatRule; actions: Actions }): ReactElement {
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

function Edit({ r, actions }: { r: NatRule; actions: Actions }): ReactElement {
  return (
    <RowButton
      label={`Edit ${r.name ?? r.label}`}
      icon={SquarePenIcon}
      onClick={() => {
        actions.editNat(r);
      }}
    />
  );
}

/** A NAT rule's card on a phone or in a narrow window. */
function NatCard({ r, data, actions }: { r: NatRule; data: FirewallData; actions: Actions }): ReactElement {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3">
      <span className="flex items-center justify-between gap-2 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium">{r.name ?? r.label}</span>
          {!r.enabled && <OffBadge />}
        </span>
        <Verdict r={r} />
      </span>
      <span className="text-xs break-words text-muted-foreground">
        {r.srcIp.length === 0 ? 'anyone' : <span className="font-mono">{r.srcIp.join(' ')}</span>} → <To r={r} /> via{' '}
        {zoneTitle(r.src ?? '', data.cfg)}, sent as <SentAs r={r} />
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Toggle r={r} actions={actions} />
          {r.enabled ? 'On' : 'Off'}
        </span>
        <Edit r={r} actions={actions} />
      </span>
    </div>
  );
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
  const columns = useMemo(() => natColumns(data, counters, actions), [data, counters, actions]);
  const nats = data.cfg.nats;
  const masq = data.cfg.zones.filter((z) => z.masq).map((z) => z.name);
  const empty = `None: ${masq.length === 0 ? 'no zone shares the router’s address' : `${masq.join(', ')} share${masq.length === 1 ? 's' : ''} the router’s address (masquerading)`}, which covers ordinary use.`;
  // one group, for its heading's Add NAT rule, there even with no rules
  const header = (
    <GroupHeader
      title={<span className="font-medium">NAT rules</span>}
      count={nats.length}
      noun={['rule', 'rules']}
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
  return (
    <DataTable
      label="NAT rules"
      columns={columns}
      groups={[{ key: 'all', header, rows: nats, empty }]}
      rowKey={(r) => r.section}
      empty={empty}
      wide="lg"
      card={(r) => <NatCard r={r} data={data} actions={actions} />}
      rowProps={(r) => ({
        onClick: rowClick(() => {
          actions.editNat(r);
        }),
        className: cn('cursor-pointer', !r.enabled && 'text-muted-foreground'),
      })}
    />
  );
}
