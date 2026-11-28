// Smart Queue's advanced settings, in a sheet from the page's header: what
// sqm-scripts and CAKE take for the internet port's queue, as LuCI has
// them, by direction, with what CAKE will get and the file as it will be.
// The expert choices the page used to show (multi-queue, the upload's ACK
// filter and memory limit) are here too, and the download's experimental
// sch_cake settings (./cake-extras.ts), with what sch_cake has now. It saves
// on its own, and only what changed (./advanced.ts).
import { Link } from '@tanstack/react-router';
import { pageLink } from '@/lib/router';
import { ArrowDownIcon, ArrowUpIcon, CableIcon, ListIcon, type LucideIcon } from 'lucide-react';
import { evaluate, useSelector } from '@tanstack/react-form';
import { type ReactElement, type ReactNode, useId, useMemo, useState } from 'react';
import { formErrors } from '@/lib/form/errors';
import { useFormValues, useSettingsForm } from '@/lib/form/use-settings-form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { TabPanel, Tabs } from '@/components/ui/tabs';
import type { Change } from '@/lib/api/uci';
import { formatBitrate } from '@/lib/format';
import { useLive } from '@/lib/query/use-live';
import { cn } from '@/lib/utils';
import { tuningQueries } from '../tuning/queries';
import { Opt, UciPreview } from '../firewall/sheet-parts';
import {
  type AdvancedData,
  type AdvancedErrors,
  type AdvancedForm,
  advancedChanges,
  cakeCommand,
  cakeEffect,
  type Direction,
  type DirectionForm,
  downloadMq,
  RTT_PRESETS,
  scriptTins,
  advancedFieldNames,
  advancedFormSchema,
} from './advanced';
import {
  type CakeExtrasLive,
  cakeParamMissing,
  dropOneSegmentIdle,
  dropOneSegmentNow,
  fraglistNow,
  oneSegmentDropsNow,
  sparseAheadChoices,
  sparseAheadLabel,
  sparseAheadNow,
} from './cake-extras';
import { cakeTargetMs, NO_SPLIT_GSO_KBIT, takesWhole } from './gso';
import { linkPresets, lowMemlimit, presetOverhead } from './model';
import { multiQueueThresholdKbit, usesMultiQueue } from './multi-queue';

export type TabId = Direction | 'line' | 'queue';
const tabs: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'down', label: 'Download', icon: ArrowDownIcon },
  { id: 'up', label: 'Upload', icon: ArrowUpIcon },
  { id: 'line', label: 'Line', icon: CableIcon },
  { id: 'queue', label: 'Queue', icon: ListIcon },
];

const tins: Record<string, string> = {
  besteffort: 'One tin',
  diffserv3: '3 tins: bulk, best effort, voice',
  diffserv4: '4 tins: bulk, best effort, video, voice',
  diffserv8: '8 tins by DSCP',
  precedence: '8 tins by IP precedence',
};
const tinsShort: Record<string, string> = {
  besteffort: 'One tin',
  diffserv3: '3 tins',
  diffserv4: '4 tins',
  diffserv8: '8 tins',
  precedence: '8 tins (precedence)',
};
const isolation: Record<string, string> = {
  'triple-isolate': 'Fair by host both ways, then by flow',
  'dual-dsthost': 'Fair per device receiving, then by flow',
  'dual-srchost': 'Fair per device sending, then by flow',
  hosts: 'Fair per pair of hosts',
  srchost: 'Fair per sending host only',
  dsthost: 'Fair per receiving host only',
  flows: 'Fair per flow only',
  flowblind: 'No flow isolation',
};
const isolationShort: Record<string, string> = {
  'triple-isolate': 'Fair by host and flow',
  'dual-dsthost': 'Fair per device',
  'dual-srchost': 'Fair per device',
  hosts: 'Fair per host pair',
  srchost: 'Fair per sender',
  dsthost: 'Fair per receiver',
  flows: 'Fair per flow',
  flowblind: 'No flow isolation',
};
const rttLabels: Record<string, string> = {
  datacentre: '100 µs',
  lan: '1 ms',
  metro: '10 ms',
  regional: '30 ms',
  internet: '100 ms',
  oceanic: '300 ms',
  satellite: '1 s',
  interplanetary: '1 hour',
};
const verbosities = [
  { value: '0', label: 'Silent (0)' },
  { value: '1', label: 'Errors (1)' },
  { value: '2', label: 'Warnings (2)' },
  { value: '5', label: 'Information (5)' },
  { value: '8', label: 'Debug (8)' },
  { value: '10', label: 'Trace (10)' },
];

// Radix's Select can't hold '' as a value
const DEFAULT = '__default';
const enc = (v: string): string => (v === '' ? DEFAULT : v);
const dec = (v: string): string => (v === DEFAULT ? '' : v);

interface Option<T extends string> {
  value: T;
  label: string;
}

function Pick<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled = false,
}: {
  id: string;
  value: T;
  options: readonly Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}): ReactElement {
  // a value set by hand that no option names is shown as it is
  const all: readonly Option<string>[] = options.some((o) => o.value === value) ? options : [...options, { value, label: value }];
  return (
    <Select
      value={enc(value)}
      disabled={disabled}
      onValueChange={(v) => {
        onChange(dec(v) as T);
      }}
    >
      <SelectTrigger id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {all.map((o) => (
          <SelectItem key={enc(o.value)} value={enc(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Changed({ on }: { on: boolean }): ReactElement | null {
  if (!on) return null;
  return (
    <span className="ml-auto flex items-center gap-1 text-xs font-medium text-primary">
      <span className="size-1.5 rounded-full bg-primary" />
      changed
    </span>
  );
}

function Row({
  id,
  label,
  opt,
  hint,
  error,
  changed,
  children,
}: {
  id: string;
  label: string;
  opt: string;
  hint?: ReactNode;
  error?: string | undefined;
  changed: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-2 text-sm font-medium">
        <label htmlFor={id}>{label}</label>
        <Opt>{opt}</Opt>
        <Changed on={changed} />
      </div>
      {children}
      {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
      {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SwitchField({
  id,
  label,
  opt,
  hint,
  checked,
  changed,
  error,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  opt: string;
  hint?: ReactNode;
  checked: boolean;
  changed: boolean;
  error?: string | undefined;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}): ReactElement {
  return (
    <div className={cn('flex items-start gap-3', disabled && 'opacity-60')}>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2 text-sm font-medium">
          <label htmlFor={id}>{label}</label>
          <Opt>{opt}</Opt>
          <Changed on={changed} />
        </div>
        {error !== undefined && <p className="text-xs text-destructive">{error}</p>}
        {hint !== undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      <Switch id={id} className="mt-0.5" checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <section className="flex flex-col gap-4 border-t pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/** The command sqm-scripts runs for a direction, and what CAKE makes of it. */
function CakePreview({ f, data, dir }: { f: AdvancedForm; data: AdvancedData; dir: Direction }): ReactElement {
  const { sqm, opts } = cakeCommand(f, data, dir);
  const e = cakeEffect([...sqm, ...opts]);
  const target = cakeTargetMs(e.rtt in rttLabels ? e.rtt : `rtt ${e.rtt}`);
  const dev = dir === 'down' ? `ifb4${data.device}`.slice(0, 15) : data.device;
  const chips = [
    tinsShort[e.diffserv] ?? e.diffserv,
    isolationShort[e.isolation] ?? e.isolation,
    e.nat === 'nat' ? 'NAT-aware' : 'No NAT lookup',
    e.wash === 'wash' ? (dir === 'down' && data.dscpRestore ? 'Devices’ own DSCP' : 'Clears DSCP') : 'Keeps DSCP',
    ...(dir === 'down' ? [e.ingress === 'ingress' ? 'Counts dropped packets' : 'Dropped packets not counted'] : []),
    ...(e.ackFilter === 'no-ack-filter' ? [] : [e.ackFilter === 'ack-filter' ? 'ACK filter' : 'Aggressive ACK filter']),
    e.gso === 'no-split-gso' ? 'Grouped packets kept whole' : 'Grouped packets split up',
    `Target ${target === null ? '?' : target < 1 ? `${String(Math.round(target * 1000))} µs` : `${String(Math.round(target * 10) / 10)} ms`}`,
  ];
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
        <span>What CAKE gets</span>
        <span className="font-mono">{dev}</span>
      </div>
      <p className="px-3 py-2 font-mono text-xs leading-5 break-words">
        <span className="text-muted-foreground">tc qdisc add dev {dev} root </span>
        <span className="text-muted-foreground">{sqm.join(' ')}</span>
        {opts.length > 0 && <span className="text-primary"> {opts.join(' ')}</span>}
      </p>
      <div className="flex flex-wrap gap-1.5 border-t px-3 py-2">
        {chips.map((c) => (
          <Badge key={c} variant="secondary" className="font-normal">
            {c}
          </Badge>
        ))}
      </div>
      <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
        Grey: from sqm-scripts and the other tabs. <span className="text-primary">Highlighted</span>: this direction’s options (
        {dir === 'down' ? 'iqdisc_opts' : 'eqdisc_opts'}). CAKE takes the last of each kind.
      </p>
    </div>
  );
}

function DirectionTab({
  id,
  dir,
  f,
  data,
  errors,
  rssNote,
  cakeLive,
  fraglist,
  setDir,
  set,
}: {
  id: string;
  dir: Direction;
  f: AdvancedForm;
  data: AdvancedData;
  errors: AdvancedErrors;
  /** why the download's queues don't spread over the CPUs now, when they don't */
  rssNote: string | undefined;
  /** what sch_cake has now, for the experimental settings; undefined until the router said */
  cakeLive: CakeExtrasLive | undefined;
  /** whether the internet port groups with fraglist GRO now; undefined while it isn't known */
  fraglist: boolean | undefined;
  setDir: <K extends keyof DirectionForm>(dir: Direction, key: K, value: DirectionForm[K]) => void;
  set: <K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]) => void;
}): ReactElement {
  const d = f[dir];
  const was = data.form[dir];
  const down = dir === 'down';
  const fid = (k: string): string => `${id}-${dir}-${k}`;
  const ch = (k: keyof DirectionForm): boolean => d[k] !== was[k];
  const rttChoice = d.rtt === '' || (RTT_PRESETS as readonly string[]).includes(d.rtt) ? d.rtt : 'custom';
  const scriptTin = scriptTins(f.script, dir, f.squashIngress);
  const mq = downloadMq(f, data);
  return (
    <>
      <CakePreview f={f} data={data} dir={dir} />
      {down && (
        <Group title="Queues">
          <Row
            id={fid('mq')}
            label="Multi-queue"
            opt="use_mq"
            changed={f.multiQueue !== data.form.multiQueue}
            hint={
              <>
                One CAKE per network-card queue, sharing the speed by what each needs, so more than one CPU can shape at once
                (cake_mq). With RSS (Performance Tuning), each receive ring feeds its own queue on its own CPU; with packet
                steering instead (a PPPoE line, or RSS off), each CPU it hands connections to has its own queue. Each queue holds
                its packets to its share of the speed, so a packet can wait a little longer than in one CAKE, and fairness between
                devices is shared out between the queues rather than exact.{' '}
                {data.pppoe
                  ? 'Your line is PPPoE: RSS can’t spread it, so every download reaches CPU 0 before packet steering hands it on to CPUs 1–3. Automatic uses multi-queue from '
                  : 'On an Ethernet line, GRO hands CAKE large packets and one CAKE keeps up with about 1 Gbit/s: Automatic uses multi-queue from '}
                {multiQueueThresholdKbit(data.pppoe) / 1000} Mbit/s. In MilkFlint’s steering layouts downloads use three of the
                four queues, on CPUs 1–3: queue 1 stays for CPU 0, which sends, and carries little. Saved as
                milkflint.cake.multi_queue too.
                {rssNote !== undefined && mq && <span className="mt-1 block text-warning">{rssNote}</span>}
              </>
            }
          >
            <Pick
              id={fid('mq')}
              value={f.multiQueue}
              options={[
                {
                  value: 'auto',
                  label: `Automatic: ${usesMultiQueue(data.downloadKbit, 'auto', data.pppoe) ? 'on' : 'off'} at ${formatBitrate(data.downloadKbit * 1000)}`,
                },
                { value: 'on', label: 'On (cake_mq)' },
                { value: 'off', label: 'Off: one CAKE' },
              ]}
              onChange={(v) => {
                set('multiQueue', v);
              }}
            />
          </Row>
        </Group>
      )}
      <Group title="Tins and fairness">
        <Row
          id={fid('diffserv')}
          label="Priority tins"
          opt="diffserv"
          changed={ch('diffserv')}
          hint="Tins sort traffic by its DSCP marks: calls and games ahead, backups behind. Each tin gets a share of the speed when it’s busy."
        >
          <Pick
            id={fid('diffserv')}
            value={d.diffserv}
            options={[
              { value: '', label: `From the mode: ${tins[scriptTin] ?? scriptTin}` },
              ...Object.entries(tins).map(([value, label]) => ({ value, label: `${label} (${value})` })),
            ]}
            onChange={(v) => {
              setDir(dir, 'diffserv', v);
            }}
          />
        </Row>
        <Row
          id={fid('isolation')}
          label="Flow isolation"
          opt="flowmode"
          changed={ch('isolation')}
          hint={`How CAKE shares the speed out. ${down ? 'dual-dsthost' : 'dual-srchost'} gives each device a fair share ${down ? 'of the download' : 'of the upload'}, as Fair share per device does.`}
        >
          <Pick
            id={fid('isolation')}
            value={d.isolation}
            options={[
              { value: '', label: 'CAKE’s default (triple-isolate)' },
              ...Object.entries(isolation).map(([value, label]) => ({ value, label: `${label} (${value})` })),
            ]}
            onChange={(v) => {
              setDir(dir, 'isolation', v);
            }}
          />
        </Row>
        <Row
          id={fid('nat')}
          label="NAT lookup"
          opt="nat"
          changed={ch('nat')}
          hint="Looks each connection up in the router’s NAT table, so fairness sees the devices behind it rather than the router’s own address."
        >
          <Pick
            id={fid('nat')}
            value={d.nat}
            options={[
              { value: '', label: 'On (sqm-scripts’ default)' },
              { value: 'nat', label: 'On (nat)' },
              { value: 'nonat', label: 'Off (nonat)' },
            ]}
            onChange={(v) => {
              setDir(dir, 'nat', v);
            }}
          />
        </Row>
      </Group>
      <Group title="DSCP marks">
        {down && (
          <>
            <SwitchField
              id={fid('squash_dscp')}
              label="Clear DSCP marks"
              opt="squash_dscp"
              checked={f.squashDscp}
              changed={f.squashDscp !== data.form.squashDscp}
              disabled={data.dscpRestore}
              hint={
                data.dscpRestore
                  ? 'Kept on for Keep devices’ priorities on downloads, which puts each connection’s own mark back where CAKE clears your provider’s. Turn that off on the page to change this.'
                  : 'After sorting downloads into tins, CAKE clears the marks they came with: your provider’s mean nothing on your network.'
              }
              onChange={(v) => {
                set('squashDscp', v);
              }}
            />
            <SwitchField
              id={fid('squash_ingress')}
              label="Sort downloads by DSCP"
              opt="squash_ingress"
              checked={!f.squashIngress}
              changed={f.squashIngress !== data.form.squashIngress}
              disabled={data.dscpRestore}
              hint={
                data.dscpRestore
                  ? 'Follows Prioritise by traffic type while Keep devices’ priorities on downloads is on: on, downloads go into tins by their connection’s own mark. Change either on the page.'
                  : 'With layer_cake, downloads get tins by the marks they arrive with; off, they share one tin (sqm-scripts’ default).'
              }
              onChange={(v) => {
                set('squashIngress', !v);
              }}
            />
          </>
        )}
        <Row
          id={fid('wash')}
          label={down ? 'Clear marks, by keyword' : 'Clear DSCP marks'}
          opt="wash · nowash"
          changed={ch('wash')}
          hint={
            !down
              ? 'Clears the marks of what goes out to your provider, after CAKE has sorted it into tins.'
              : !data.dscpRestore
                ? 'Overrides Clear DSCP marks above; usually left as it is.'
                : d.wash === 'nowash'
                  ? 'Keep devices’ priorities on downloads can’t work with this: it puts each connection’s own mark back where CAKE clears the provider’s. Choose Same as Clear DSCP marks.'
                  : 'Kept as Clear DSCP marks for Keep devices’ priorities on downloads, which puts each connection’s own mark back where CAKE clears your provider’s. Turn that off on the page to change this.'
          }
        >
          <Pick
            id={fid('wash')}
            value={d.wash}
            // the restore happens where CAKE washes: nowash would turn it off
            disabled={down && data.dscpRestore && d.wash !== 'nowash'}
            options={[
              {
                value: '',
                label: down ? `Same as Clear DSCP marks (${f.squashDscp ? 'on' : 'off'})` : 'Keep them (CAKE’s default)',
              },
              { value: 'wash', label: 'Clear them (wash)' },
              { value: 'nowash', label: 'Keep them (nowash)' },
            ]}
            onChange={(v) => {
              setDir(dir, 'wash', v);
            }}
          />
        </Row>
      </Group>
      <Group title="Packets">
        <Row
          id={fid('ack')}
          label="ACK filter"
          opt="ack-filter"
          changed={ch('ackFilter')}
          hint={
            down
              ? 'You probably don’t want this on here: look on the Upload tab for it, where downloads send their acknowledgements.'
              : 'Downloads send small acknowledgements (ACKs) back up the line. When they queue behind a busy upload, this drops the ones a newer ACK has replaced, leaving more of the upload for everything else. Aggressive drops more and can confuse some connections.'
          }
        >
          <Pick
            id={fid('ack')}
            value={d.ackFilter}
            options={[
              { value: '', label: 'Off (CAKE’s default)' },
              { value: 'ack-filter', label: 'On (ack-filter)' },
              { value: 'ack-filter-aggressive', label: 'Aggressive (ack-filter-aggressive)' },
              // the same as the default: offered only when it's what's set
              ...(d.ackFilter === 'no-ack-filter' ? [{ value: 'no-ack-filter' as const, label: 'Off (no-ack-filter)' }] : []),
            ]}
            onChange={(v) => {
              setDir(dir, 'ackFilter', v);
            }}
          />
        </Row>
        {down ? (
          <Row
            id={fid('whole')}
            label="Grouped packets"
            opt="split-gso · no-split-gso"
            changed={f.whole !== data.form.whole}
            hint={`Before Smart Queue, the router merges a download’s packets into bigger ones (GRO) to save work. Kept whole, they cost far less CPU at high speeds, which keeps delays down too; split up, each packet is scheduled on its own. Automatic keeps them whole from ${String(NO_SPLIT_GSO_KBIT / 1000)} Mbit/s. Also on Performance Tuning.`}
          >
            <Pick
              id={fid('whole')}
              value={f.whole}
              options={[
                {
                  value: 'auto',
                  label: `Automatic: ${takesWhole(data.downloadKbit, 'auto') ? 'kept whole' : 'split up'} at ${formatBitrate(data.downloadKbit * 1000)}`,
                },
                { value: 'on', label: 'Always keep whole (no-split-gso)' },
                { value: 'off', label: 'Always split up (split-gso)' },
              ]}
              onChange={(v) => {
                set('whole', v);
              }}
            />
          </Row>
        ) : (
          <Row
            id={fid('gso')}
            label="Grouped packets"
            opt="split-gso · no-split-gso"
            changed={ch('gso')}
            hint="Big packets the router sends, or forwards as they arrived. Split up, a ping or a call’s packet can slip in between them; kept whole, they take less CPU."
          >
            <Pick
              id={fid('gso')}
              value={d.gso}
              options={[
                { value: '', label: 'Split up (CAKE’s default)' },
                { value: 'no-split-gso', label: 'Keep whole (no-split-gso)' },
                // the same as the default: offered only when it's what's set
                ...(d.gso === 'split-gso' ? [{ value: 'split-gso' as const, label: 'Split up (split-gso)' }] : []),
              ]}
              onChange={(v) => {
                setDir(dir, 'gso', v);
              }}
            />
          </Row>
        )}
        {down && (
          <>
            <SwitchField
              id={fid('ingress')}
              label="Count dropped packets (ingress mode)"
              opt="ingress"
              checked={d.ingress === 'ingress'}
              changed={ch('ingress')}
              hint="Packets CAKE drops here have already used your line, so this counts them toward the speed as well, keeping downloads under it when CAKE drops a lot. Fair share per device turns it on."
              onChange={(v) => {
                setDir(dir, 'ingress', v ? 'ingress' : '');
              }}
            />
            <SwitchField
              id={fid('autorate')}
              label="Adapt to the line’s speed"
              opt="autorate-ingress"
              checked={d.autorate}
              changed={ch('autorate')}
              error={errors['down.autorate']}
              // multi-queue CAKE can't: one set in LuCI can still be turned off
              disabled={mq && !d.autorate}
              hint={`CAKE measures how fast downloads arrive and shapes to that instead of the speed you set. For lines whose speed changes, such as 4G or 5G; leave it off on a fixed line.${mq ? ' Not with multi-queue CAKE, which the download uses (Multi-queue, above).' : ''}`}
              onChange={(v) => {
                setDir(dir, 'autorate', v);
              }}
            />
          </>
        )}
      </Group>
      <Group title="Timing and memory">
        <Row
          id={fid('rtt')}
          label="Round trip (rtt)"
          opt="rtt"
          changed={ch('rtt')}
          error={errors[`${dir}.rtt`]}
          hint="The round trip CAKE tunes for: each queue aims for a twentieth of it. Shorter keeps queues shorter, for a little speed."
        >
          <div className="flex gap-2">
            <Pick
              id={fid('rtt')}
              value={rttChoice}
              options={[
                { value: '', label: '100 ms (CAKE’s default)' },
                ...RTT_PRESETS.map((p) => ({ value: p, label: `${rttLabels[p] ?? p} (${p})` })),
                { value: 'custom', label: 'Custom' },
              ]}
              onChange={(v) => {
                setDir(dir, 'rtt', v === 'custom' ? (rttChoice === 'custom' ? d.rtt : '50ms') : v);
              }}
            />
            {rttChoice === 'custom' && (
              <Input
                aria-label="Round trip"
                className="w-28 shrink-0 tabular"
                value={d.rtt}
                aria-invalid={errors[`${dir}.rtt`] !== undefined}
                onChange={(e) => {
                  setDir(dir, 'rtt', e.target.value.trim());
                }}
              />
            )}
          </div>
        </Row>
        <Row
          id={fid('memlimit')}
          label="Memory limit"
          opt="memlimit"
          changed={ch('memlimit')}
          error={errors[`${dir}.memlimit`]}
          hint={
            down
              ? 'How much the queue may hold before CAKE drops from its biggest flow. Empty: CAKE’s own, four round trips at the speed and at least 4 MiB.'
              : 'How much the queue may hold before CAKE drops from its biggest flow. Empty: CAKE’s own, four round trips at the speed and at least 4 MiB. Low allows one 100 ms round trip (at least 1 MiB), so a device starting a fast upload fills less of it, and the page keeps it in step with the upload speed.'
          }
        >
          <div className="flex gap-2">
            <Input
              id={fid('memlimit')}
              className="tabular"
              placeholder="Automatic"
              value={d.memlimit}
              aria-invalid={errors[`${dir}.memlimit`] !== undefined}
              onChange={(e) => {
                setDir(dir, 'memlimit', e.target.value.trim());
              }}
            />
            {!down && (
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                disabled={d.memlimit === String(lowMemlimit(data.uploadKbit))}
                onClick={() => {
                  setDir(dir, 'memlimit', String(lowMemlimit(data.uploadKbit)));
                }}
              >
                Low
              </Button>
            )}
          </div>
        </Row>
      </Group>
      <Group title="More">
        <Row
          id={fid('fwmark')}
          label="Tin from firewall mark"
          opt="fwmark"
          changed={ch('fwmark')}
          error={errors[`${dir}.fwmark`]}
          hint="A mask: the part of a packet’s firewall mark it covers picks the tin (1 is the first), ahead of DSCP. Empty: off."
        >
          <Input
            id={fid('fwmark')}
            className="font-mono"
            placeholder="Off"
            value={d.fwmark}
            aria-invalid={errors[`${dir}.fwmark`] !== undefined}
            onChange={(e) => {
              setDir(dir, 'fwmark', e.target.value.trim());
            }}
          />
        </Row>
        <Row
          id={fid('extra')}
          label="Other options"
          opt={down ? 'iqdisc_opts' : 'eqdisc_opts'}
          changed={ch('extra')}
          error={errors[`${dir}.extra`]}
          hint="Any other CAKE keywords, as tc takes them: conservative, raw, mpu 64, overhead 18 …"
        >
          <Input
            id={fid('extra')}
            className="font-mono"
            placeholder="None"
            value={d.extra}
            aria-invalid={errors[`${dir}.extra`] !== undefined}
            onChange={(e) => {
              setDir(dir, 'extra', e.target.value);
            }}
          />
        </Row>
      </Group>
      {down && <ExperimentalGroup id={id} f={f} data={data} live={cakeLive} fraglist={fraglist} set={set} />}
    </>
  );
}

const NOT_YET = 'This image doesn’t have it yet.';

/** A line under an experimental setting: why it can't be switched, or what sch_cake has now when that isn't what's saved. */
function Note({ children }: { children: ReactNode }): ReactElement {
  return <span className="mt-1 block font-medium text-foreground">{children}</span>;
}

/** The download's experimental sch_cake settings, which CAKE takes at once, without a restart. */
function ExperimentalGroup({
  id,
  f,
  data,
  live,
  fraglist,
  set,
}: {
  id: string;
  f: AdvancedForm;
  data: AdvancedData;
  live: CakeExtrasLive | undefined;
  fraglist: boolean | undefined;
  set: <K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]) => void;
}): ReactElement {
  const was = data.form;
  const dropMissing = cakeParamMissing(live?.dropOneSegment, live);
  const aheadMissing = cakeParamMissing(live?.sparseAhead, live);
  const whole = takesWhole(data.downloadKbit, f.whole);
  const dropNow = dropOneSegmentNow(was.dropOneSegment, live);
  const dropIdle = dropOneSegmentIdle(whole, fraglist);
  const dropped = oneSegmentDropsNow(live?.dropOneSegment === true || was.dropOneSegment, live);
  const aheadNow = sparseAheadNow(was.sparseAhead, live);
  return (
    <Group title="Experimental">
      <p className="-mt-2 text-xs text-muted-foreground">
        Off by default, for trying out. CAKE takes them at once, without a restart.
        {live !== undefined && !live.loaded && ' Smart Queue hasn’t run since the router started: CAKE takes them when it does.'}
      </p>
      <SwitchField
        id={`${id}-down-dropOne`}
        label="Drop one packet of a group, not the whole group"
        opt="drop_one_segment"
        checked={f.dropOneSegment}
        changed={f.dropOneSegment !== was.dropOneSegment}
        // one already on can still be turned off
        disabled={dropMissing && !f.dropOneSegment}
        hint={
          <>
            When CAKE drops from a download whose grouped packets it keeps whole, it drops one packet of the group rather than the
            whole group, so the download loses less at once. It needs both: CAKE keeping grouped packets whole (Grouped packets,
            above), and the internet port grouping with fraglist (Receive grouping on Performance Tuning), as a plain GRO packet
            has no separate packets to drop one of. Automatic picks plain GRO whenever CAKE keeps them whole. sch_cake’s
            drop_one_segment.
            {dropMissing && <Note>{NOT_YET}</Note>}
            {dropIdle.map((line) => (
              <Note key={line}>{line}</Note>
            ))}
            {dropNow !== undefined && <Note>{dropNow}</Note>}
            {dropped !== undefined && <Note>{dropped}</Note>}
          </>
        }
        onChange={(v) => {
          set('dropOneSegment', v);
        }}
      />
      <Row
        id={`${id}-down-sparseAhead`}
        label="Let a new flow’s first packets go ahead of the shaper"
        opt="sparse_ahead"
        changed={f.sparseAhead !== was.sparseAhead}
        hint={
          <>
            A download’s packets have already crossed your line, so holding them back for the shaper delays only them. With this,
            while the shaper holds packets back, a packet of a connection CAKE counts as new or light (a ping, a DNS answer, a
            game’s update) goes at once if the shaper would let the next one go within this long. It’s charged to the shaper, so
            the speed holds and the others wait that much longer; busy downloads and uploads wait as before. sch_cake’s
            sparse_ahead_us.
            {aheadMissing && <Note>{NOT_YET}</Note>}
            {aheadNow !== undefined && <Note>{aheadNow}</Note>}
          </>
        }
      >
        <Pick
          id={`${id}-down-sparseAhead`}
          value={f.sparseAhead}
          disabled={aheadMissing && f.sparseAhead === ''}
          // one set by hand stays a choice, by its figure, until it's changed
          options={[...new Set([...sparseAheadChoices, was.sparseAhead, f.sparseAhead])].map((v) => ({
            value: v,
            label: sparseAheadLabel(v),
          }))}
          onChange={(v) => {
            set('sparseAhead', v);
          }}
        />
      </Row>
    </Group>
  );
}

function LineTab({
  id,
  f,
  data,
  errors,
  set,
  setF,
}: {
  id: string;
  f: AdvancedForm;
  data: AdvancedData;
  errors: AdvancedErrors;
  set: <K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]) => void;
  setF: (update: (f: AdvancedForm) => AdvancedForm) => void;
}): ReactElement {
  const was = data.form;
  const ptm = f.down.ptm && f.up.ptm;
  const stab = f.llam === 'tc_stab';
  return (
    <>
      <Group title="Fill in for">
        <div className="flex flex-wrap gap-1.5">
          {Object.values(linkPresets).map((p) => (
            <button
              key={p.label}
              type="button"
              className="rounded-md border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={() => {
                setF((x) => ({
                  ...x,
                  linklayer: p.linklayer,
                  overhead: presetOverhead(p, data.device),
                  mpu: 'mpu' in p ? p.mpu : '',
                  // the presets are CAKE's own compensation
                  llam: ['', 'default', 'cake'].includes(x.llam) ? x.llam : '',
                  down: { ...x.down, ptm: 'ptm' in p },
                  up: { ...x.up, ptm: 'ptm' in p },
                }));
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          How much each packet grows on your line, so CAKE shapes what it really carries. These fill in the fields below; nothing
          is saved until you save.
        </p>
      </Group>
      <Group title="Link layer">
        <Row id={`${id}-linklayer`} label="Link layer" opt="linklayer" changed={f.linklayer !== was.linklayer}>
          <Pick
            id={`${id}-linklayer`}
            value={f.linklayer}
            options={[
              { value: 'none', label: 'None: no compensation' },
              { value: 'ethernet', label: 'Ethernet, fibre, cable, VDSL2' },
              { value: 'atm', label: 'ATM (ADSL): 53-byte cells' },
            ]}
            onChange={(v) => {
              set('linklayer', v);
            }}
          />
        </Row>
        <div className="grid gap-4 sm:grid-cols-2">
          <Row
            id={`${id}-overhead`}
            label="Overhead"
            opt="overhead"
            changed={f.overhead !== was.overhead}
            error={errors['overhead']}
            hint="Bytes each packet gains on the line."
          >
            <Input
              id={`${id}-overhead`}
              inputMode="numeric"
              className="tabular"
              value={f.overhead}
              aria-invalid={errors['overhead'] !== undefined}
              onChange={(e) => {
                set('overhead', e.target.value.trim());
              }}
            />
          </Row>
          <Row
            id={`${id}-mpu`}
            label="Smallest packet"
            opt="tcMPU"
            changed={f.mpu !== was.mpu}
            error={errors['mpu']}
            hint="Bytes the line sends at least, however small the packet."
          >
            <Input
              id={`${id}-mpu`}
              inputMode="numeric"
              className="tabular"
              placeholder="0"
              value={f.mpu}
              aria-invalid={errors['mpu'] !== undefined}
              onChange={(e) => {
                set('mpu', e.target.value.trim());
              }}
            />
          </Row>
        </div>
        <SwitchField
          id={`${id}-ptm`}
          label="PTM encoding"
          opt="ptm"
          checked={ptm}
          changed={f.down.ptm !== was.down.ptm || f.up.ptm !== was.up.ptm}
          hint="VDSL2’s 64/65 encoding, which costs about 1.5% of the line: in both directions’ options."
          onChange={(v) => {
            setF((x) => ({ ...x, down: { ...x.down, ptm: v }, up: { ...x.up, ptm: v } }));
          }}
        />
      </Group>
      <Group title="How it’s applied">
        <Row
          id={`${id}-llam`}
          label="Adaptation"
          opt="linklayer_adaptation_mechanism"
          changed={f.llam !== was.llam}
          hint="CAKE’s own compensation is exact per packet; tc’s size table is for other queues and rounds to its cells."
        >
          <Pick
            id={`${id}-llam`}
            value={f.llam}
            options={[
              { value: '', label: 'CAKE’s own (default)' },
              { value: 'default', label: 'CAKE’s own (default)' },
              { value: 'cake', label: 'CAKE’s own (cake)' },
              { value: 'tc_stab', label: 'tc’s size table (tc_stab)' },
            ].filter((o) => o.value !== 'default' || f.llam === 'default')}
            onChange={(v) => {
              set('llam', v);
            }}
          />
        </Row>
        {stab && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Row id={`${id}-mtu`} label="Largest packet" opt="tcMTU" changed={f.mtu !== was.mtu} error={errors['mtu']}>
              <Input
                id={`${id}-mtu`}
                inputMode="numeric"
                className="tabular"
                placeholder="2047"
                value={f.mtu}
                aria-invalid={errors['mtu'] !== undefined}
                onChange={(e) => {
                  set('mtu', e.target.value.trim());
                }}
              />
            </Row>
            <Row id={`${id}-tsize`} label="Table size" opt="tcTSIZE" changed={f.tsize !== was.tsize} error={errors['tsize']}>
              <Input
                id={`${id}-tsize`}
                inputMode="numeric"
                className="tabular"
                placeholder="512"
                value={f.tsize}
                aria-invalid={errors['tsize'] !== undefined}
                onChange={(e) => {
                  set('tsize', e.target.value.trim());
                }}
              />
            </Row>
          </div>
        )}
      </Group>
    </>
  );
}

function QueueTab({
  id,
  f,
  data,
  set,
}: {
  id: string;
  f: AdvancedForm;
  data: AdvancedData;
  set: <K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]) => void;
}): ReactElement {
  const was = data.form;
  return (
    <>
      <Group title="sqm-scripts">
        <Row
          id={`${id}-script`}
          label="Script"
          opt="script"
          changed={f.script !== was.script}
          hint="Both run CAKE. layer_cake gives the upload three tins by DSCP; the download too with Sort downloads by DSCP."
        >
          <Pick
            id={`${id}-script`}
            value={f.script}
            options={[
              { value: 'piece_of_cake.qos', label: 'One fair queue (piece_of_cake.qos)' },
              { value: 'layer_cake.qos', label: 'Prioritise by traffic type (layer_cake.qos)' },
            ]}
            onChange={(v) => {
              set('script', v);
            }}
          />
        </Row>
        <Row
          id={`${id}-mq`}
          label="Upload multi-queue"
          opt="use_mq_egress"
          changed={f.mqEgress !== was.mqEgress}
          hint="The Flint 2’s Ethernet sends everything on one queue, so multi-queue CAKE on the upload only adds idle queues. Downloads: Multi-queue on the Download tab."
        >
          <Pick
            id={`${id}-mq`}
            value={f.mqEgress}
            options={[
              { value: '', label: `Like downloads: ${downloadMq(f, data) ? 'on' : 'off'} (use_mq)` },
              { value: '1', label: 'On' },
              { value: '0', label: 'Off' },
            ]}
            onChange={(v) => {
              set('mqEgress', v);
            }}
          />
        </Row>
      </Group>
      <Group title="Logging">
        <SwitchField
          id={`${id}-debug`}
          label="Debug log"
          opt="debug_logging"
          checked={f.debug}
          changed={f.debug !== was.debug}
          hint="sqm-scripts writes every command it runs to /var/run/sqm/, for troubleshooting."
          onChange={(v) => {
            set('debug', v);
          }}
        />
        <Row id={`${id}-verbosity`} label="Log detail" opt="verbosity" changed={f.verbosity !== was.verbosity}>
          <Pick
            id={`${id}-verbosity`}
            value={f.verbosity}
            options={[{ value: '', label: 'Information (sqm-scripts’ default)' }, ...verbosities]}
            onChange={(v) => {
              set('verbosity', v);
            }}
          />
        </Row>
      </Group>
      <Group title="Elsewhere">
        <p className="text-sm text-muted-foreground">
          CAKE’s ECN fallback and L4S marking are kernel settings, on{' '}
          <Link {...pageLink('tuning')} className="font-medium text-foreground underline underline-offset-2">
            Performance Tuning
          </Link>
          . The limits, targets and ECN options LuCI shows are for fq_codel’s scripts, not CAKE.
        </p>
      </Group>
    </>
  );
}

const tabOf = (key: string): TabId => (key.startsWith('down.') ? 'down' : key.startsWith('up.') ? 'up' : 'line');

export function AdvancedSheet({
  data,
  tab: firstTab = 'down',
  rssNote,
  onClose,
  onSubmit,
}: {
  data: AdvancedData;
  /** the tab it opens on */
  tab?: TabId;
  /** why the download's queues don't spread over the CPUs now, when they don't */
  rssNote?: string | undefined;
  onClose: () => void;
  /** applies the changes; the failure's message when that didn't go through */
  onSubmit: (changes: Change[]) => Promise<string | undefined>;
}): ReactElement {
  const id = useId();
  // what sch_cake has now, for the experimental settings: read only while the sheet is open
  const status = useLive(tuningQueries.status());
  const knobs = status.data?.knobs;
  const cakeLive: CakeExtrasLive | undefined =
    knobs === undefined
      ? undefined
      : {
          dropOneSegment: knobs.cake_drop_one_segment,
          sparseAhead: knobs.cake_sparse_ahead,
          oneSegmentDrops: knobs.cake_one_segment_drops,
          loaded: knobs.cake_loaded,
        };
  const fraglist = fraglistNow(status.data?.gro);
  const schema = useMemo(() => advancedFormSchema(data), [data]);
  const [failed, setFailed] = useState<string>();
  const settings = useSettingsForm({
    schema,
    saved: data.form,
    onSave: async (values) => {
      setFailed(await onSubmit(advancedChanges(values, data)));
    },
  });
  const { form } = settings;
  const f = useFormValues(form);
  const submitting = useSelector(form.store, (s) => s.isSubmitting);
  const [tab, setTab] = useState<TabId>(firstTab);
  // the sheet's controls change the form through these, a field at a time
  const setF = (update: (x: AdvancedForm) => AdvancedForm): void => {
    const current = form.store.state.values;
    const next = update(current);
    for (const key of advancedFieldNames) {
      if (!evaluate(current[key], next[key])) form.setFieldValue(key, next[key]);
    }
  };
  const set = <K extends keyof AdvancedForm>(key: K, value: AdvancedForm[K]): void => {
    setF((x) => ({ ...x, [key]: value }));
  };
  const setDir = <K extends keyof DirectionForm>(dir: Direction, key: K, value: DirectionForm[K]): void => {
    setF((x) => ({ ...x, [dir]: { ...x[dir], [key]: value } }));
  };
  // the checks as they stand, shown as they're typed, as before
  const errors = formErrors(schema, f);
  const wrong = new Set(Object.keys(errors).map(tabOf));
  const changes = advancedChanges(f, data);
  const options = changes.reduce(
    (n, c) => n + (c.op === 'set' || c.op === 'add' ? Object.keys(c.values).length : c.op === 'unset' ? c.options.length : 1),
    0,
  );
  const invalid = Object.keys(errors).length > 0;
  // what a save writes in /etc/config/milkflint, which the preview (sqm's queue) doesn't show
  const milkflint = [
    ...(f.whole === data.form.whole ? [] : ['milkflint.gro.whole (the GRO choice, shared with Performance Tuning)']),
    ...(f.multiQueue === data.form.multiQueue ? [] : ['milkflint.cake.multi_queue (Multi-queue)']),
    ...(f.dropOneSegment === data.form.dropOneSegment ? [] : ['milkflint.cake.drop_one_segment']),
    ...(f.sparseAhead === data.form.sparseAhead ? [] : ['milkflint.cake.sparse_ahead']),
  ];
  // only sqm's own options restart Smart Queue; the experimental settings go to sch_cake as they are
  const restarts = changes.some((c) => c.config === 'sqm');
  const prefix = `${id}-sqm`;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent aria-describedby={`${id}-desc`} className="sm:max-w-2xl">
        <div className="px-6 pt-4">
          <SheetTitle className="pr-8">Advanced Smart Queue settings</SheetTitle>
          <SheetDescription id={`${id}-desc`} className="mt-0.5">
            Everything sqm-scripts and CAKE take for {data.device}, as in LuCI. Only what you change is saved.
          </SheetDescription>
        </div>
        <Tabs
          label="Settings"
          prefix={prefix}
          className="mt-3 px-6"
          value={tab}
          onChange={setTab}
          items={tabs.map((t) => ({
            id: t.id,
            label: (
              <span className="flex items-center gap-1.5">
                <t.icon className="size-3.5" aria-hidden />
                {t.label}
                {wrong.has(t.id) && (
                  <span className="size-1.5 rounded-full bg-destructive" role="img" aria-label="has a problem" />
                )}
              </span>
            ),
          }))}
        />
        <div className="flex-1 overflow-y-auto">
          {(['down', 'up'] as const).map((dir) => (
            <TabPanel key={dir} prefix={prefix} id={dir} value={tab} className="flex flex-col gap-5 px-6 py-5">
              <DirectionTab
                id={id}
                dir={dir}
                f={f}
                data={data}
                errors={errors}
                rssNote={rssNote}
                cakeLive={cakeLive}
                fraglist={fraglist}
                setDir={setDir}
                set={set}
              />
            </TabPanel>
          ))}
          <TabPanel prefix={prefix} id="line" value={tab} className="flex flex-col gap-5 px-6 py-5">
            <LineTab id={id} f={f} data={data} errors={errors} set={set} setF={setF} />
          </TabPanel>
          <TabPanel prefix={prefix} id="queue" value={tab} className="flex flex-col gap-5 px-6 py-5">
            <QueueTab id={id} f={f} data={data} set={set} />
          </TabPanel>
          <div className="flex flex-col gap-2 border-t px-6 py-5">
            <UciPreview config="sqm" type="queue" original={data.queue} changes={changes} />
            {milkflint.length > 0 && (
              <p className="text-xs text-muted-foreground">
                And in <span className="font-mono">/etc/config/milkflint</span>: {milkflint.join('; ')}.
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t px-6 py-3">
          {failed !== undefined && <p className="text-xs font-medium text-destructive">{failed}</p>}
          <p className="text-xs text-muted-foreground" hidden={failed !== undefined}>
            {invalid
              ? 'Fix what’s marked to save.'
              : options === 0
                ? 'No changes yet.'
                : `${String(options)} option${options === 1 ? '' : 's'} to change.${restarts ? ' Smart Queue restarts for a moment.' : ''}`}
          </p>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={invalid || submitting || changes.length === 0} onClick={settings.save}>
              Save &amp; apply
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
