// The Smart Queue page's settings, read from sqm's queue for the internet
// port, and the UCI changes a save makes. Only what changed is written: a
// setting left as it was keeps what the router has, set in LuCI or not.
import { bool, type Change, type Section, sectionChanges, str } from '@/lib/api/uci';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';
import { ACK_FILTER, type AckFilter, ackFilterOf } from './ack-filter';
import { type SqmDscpOption, sqmDscpOptions } from './dscp';
import { GSO, optValue, takesWhole, type Whole, wholeOf, withOpts, words } from './gso';
import { type MultiQueue, multiQueueOf, multiQueueValue, usesMultiQueue } from './multi-queue';

// Link-layer presets: how much each packet grows on the wire, so CAKE's
// shaping matches what the line really carries. mpu (sqm's tcMPU) is the
// smallest frame the line sends, as in CAKE's own ethernet and docsis
// keywords; ATM's cells already set ADSL's. VDSL2 adds CAKE's ptm keyword
// (sqm has no option for it) for its 64/65 encoding.
export interface LinkPresetDef {
  label: string;
  linklayer: string;
  overhead: string;
  mpu?: string;
  ptm?: boolean;
}
export const linkPresets = {
  none: { label: 'No compensation', linklayer: 'none', overhead: '0' },
  ethernet: { label: 'Fibre / Ethernet', linklayer: 'ethernet', overhead: '44', mpu: '84' },
  docsis: { label: 'Cable (DOCSIS)', linklayer: 'ethernet', overhead: '18', mpu: '64' },
  vdsl: { label: 'VDSL2 (PTM)', linklayer: 'ethernet', overhead: '34', mpu: '68', ptm: true },
  adsl: { label: 'ADSL (ATM)', linklayer: 'atm', overhead: '44' },
} satisfies Record<string, LinkPresetDef>;
export type LinkPreset = keyof typeof linkPresets;

// CAKE's rtt, the round trip it tunes for: its queues aim for a twentieth
// of it, and it marks or drops sooner when it's shorter. Senders that slow
// down for that keep shorter queues, for some speed; small flows go first
// either way. Other values (LuCI) show as Custom. Set in both directions'
// opts.
export const latencyTargets = {
  standard: { label: 'Standard (100 ms)', rtt: undefined },
  low: { label: 'Low (50 ms)', rtt: '50ms' },
} as const;
export type LatencyTarget = keyof typeof latencyTargets;
// rtt, and CAKE's named rtt presets
const RTT = ['rtt', 'datacentre', 'lan', 'metro', 'regional', 'internet', 'oceanic', 'satellite', 'interplanetary'];

/** a direction's rtt setting: "50ms" for rtt 50ms, a preset's name, or undefined for CAKE's default */
function rttOf(opts: string | undefined): string | undefined {
  return optValue(opts, 'rtt') ?? words(opts).find((w) => RTT.includes(w));
}

// The upload queue's memory limit (CAKE's memlimit in eqdisc_opts). CAKE's
// own is four round trips at the upload rate, at least 4 MiB: a fast
// device starting an upload can fill that before CAKE drops anything.
// Low allows one 100 ms round trip of the rate, at least 1 MiB, so the
// burst is cut sooner; the drops land on the flow that overshot.
export type UploadMemory = 'auto' | 'low';
const LOW_MEMLIMIT_FLOOR = 1 << 20;

/** Low's memlimit in bytes for an upload speed in kbit/s */
export function lowMemlimit(uploadKbit: number): number {
  return Math.max(Math.round((uploadKbit * 1000) / 8 / 10), LOW_MEMLIMIT_FLOOR);
}

// CAKE keywords this page manages in SQM's extra options for each direction
// (iqdisc_opts, eqdisc_opts); any others, set in LuCI, are kept.
const FAIR_INGRESS = ['nat', 'dual-dsthost', 'ingress'];
const FAIR_EGRESS = ['nat', 'dual-srchost'];
// Whether CAKE takes GRO packets whole (no-split-gso) goes with the speed,
// unless Performance Tuning sets it (milkflint.gro.whole): ./gso.ts.

export interface SqmForm {
  section: string | undefined;
  enabled: boolean;
  device: string;
  downloadMbit: string;
  uploadMbit: string;
  prioritise: boolean;
  link: LinkPreset | 'custom';
  latency: LatencyTarget | 'custom';
  uploadMemory: UploadMemory | 'custom';
  ackFilter: AckFilter;
  perDevice: boolean;
  /** multi-queue CAKE for the download: with the speed, or always, or never (./multi-queue.ts) */
  multiQueue: MultiQueue;
  /** Downloads get back the DSCP their connection sends with (milkflint.cake.dscp_restore) */
  restoreDscp: boolean;
  offloadOff: boolean;
}

export interface SqmData {
  form: SqmForm;
  devices: string[];
  wanDevice: string | undefined;
  offloading: { section: string; software: boolean; hardware: boolean } | undefined;
  installed: boolean;
  /** the internet port's queue as uci has it: the advanced sheet's */
  queue: Section | undefined;
  /** the queue has an interface (the form shows the WAN port when it hasn't) */
  interfaceSet: boolean;
  iqdiscOpts: string | undefined;
  eqdiscOpts: string | undefined;
  milkflint: Section[];
  /** sqm's options for DSCP on the download, as set */
  squash: Record<SqmDscpOption, string | undefined>;
  /** sqm's tcMPU, unset when a preset doesn't use one */
  mpu: string | undefined;
  /** whether CAKE takes GRO packets whole: Performance Tuning's choice, or what the queue does when LuCI changed it (./gso.ts) */
  whole: Whole;
}

function presetOf(queue: Section | undefined): LinkPreset | 'custom' {
  const linklayer = str(queue, 'linklayer') ?? 'none';
  const overhead = str(queue, 'overhead') ?? '0';
  const mpu = str(queue, 'tcMPU');
  const iq = words(str(queue, 'iqdisc_opts'));
  const eq = words(str(queue, 'eqdisc_opts'));
  const ptm = iq.includes('ptm') && eq.includes('ptm');
  if (ptm !== (iq.includes('ptm') || eq.includes('ptm'))) return 'custom';
  for (const [key, p] of Object.entries(linkPresets) as [LinkPreset, LinkPresetDef][]) {
    if (p.linklayer !== linklayer) continue;
    if (p.linklayer === 'none') return ptm ? 'custom' : key;
    if (p.overhead !== overhead) continue;
    // the presets used to set only these two: a section without mpu and
    // ptm still counts as its preset (choosing a preset writes them)
    if (mpu === undefined && !ptm) return key;
    if ((mpu ?? '0') === (p.mpu ?? '0') && ptm === (p.ptm === true)) return key;
  }
  return 'custom';
}

function latencyOf(iqdiscOpts: string | undefined, eqdiscOpts: string | undefined): LatencyTarget | 'custom' {
  const rtt = rttOf(iqdiscOpts);
  if (rtt !== rttOf(eqdiscOpts)) return 'custom';
  const found = Object.entries(latencyTargets).find(([, t]) => t.rtt === rtt);
  return found === undefined ? 'custom' : (found[0] as LatencyTarget);
}

function uploadMemoryOf(eqdiscOpts: string | undefined, uploadKbit: number): UploadMemory | 'custom' {
  const limit = optValue(eqdiscOpts, 'memlimit');
  if (limit === undefined) return 'auto';
  return limit === String(lowMemlimit(uploadKbit)) ? 'low' : 'custom';
}

export interface SqmSources {
  /** undefined: sqm-scripts isn't installed */
  sqm: Section[] | undefined;
  firewall: Section[];
  milkflint: Section[] | undefined;
  wanDevice: string | undefined;
  devices: string[];
}

/** The page's data from the router's configs. */
export function sqmData({ sqm, firewall, milkflint, wanDevice, devices }: SqmSources): SqmData {
  // the internet port's queue: Guest Wi-Fi's speed limit is one too
  const queue = sqm?.find((s) => s['.type'] === 'queue' && !isGuestShaper(str(s, 'interface')) && !isVpnShaper(str(s, 'interface')));
  const defaults = firewall.find((s) => s['.type'] === 'defaults');
  const cake = milkflint?.find((s) => s['.name'] === 'cake');

  const form: SqmForm = {
    section: queue?.['.name'],
    enabled: bool(queue, 'enabled'),
    device: str(queue, 'interface') ?? wanDevice ?? 'eth1',
    downloadMbit: String(Number(str(queue, 'download') ?? '0') / 1000),
    uploadMbit: String(Number(str(queue, 'upload') ?? '0') / 1000),
    prioritise: str(queue, 'script') === 'layer_cake.qos',
    link: presetOf(queue),
    latency: latencyOf(str(queue, 'iqdisc_opts'), str(queue, 'eqdisc_opts')),
    uploadMemory: uploadMemoryOf(str(queue, 'eqdisc_opts'), Number(str(queue, 'upload') ?? '0')),
    ackFilter: ackFilterOf(words(str(queue, 'eqdisc_opts'))),
    perDevice: words(str(queue, 'iqdisc_opts')).includes('dual-dsthost') && words(str(queue, 'eqdisc_opts')).includes('dual-srchost'),
    multiQueue: multiQueueOf(
      str(cake, 'multi_queue'),
      queue === undefined ? undefined : bool(queue, 'use_mq'),
      Number(str(queue, 'download') ?? '0'),
    ),
    restoreDscp: str(cake, 'dscp_restore') === '1',
    offloadOff: false,
  };
  return {
    form,
    devices: devices.filter((d) => d !== 'lo' && !d.startsWith('ifb') && !d.startsWith('br-') && !d.startsWith('phy')),
    wanDevice,
    offloading:
      defaults === undefined
        ? undefined
        : {
            section: defaults['.name'],
            software: bool(defaults, 'flow_offloading'),
            hardware: bool(defaults, 'flow_offloading_hw'),
          },
    installed: sqm !== undefined,
    queue,
    interfaceSet: str(queue, 'interface') !== undefined,
    iqdiscOpts: str(queue, 'iqdisc_opts'),
    eqdiscOpts: str(queue, 'eqdisc_opts'),
    mpu: str(queue, 'tcMPU'),
    whole: wholeOf(
      str(milkflint?.find((s) => s['.name'] === 'gro'), 'whole'),
      queue === undefined ? null : str(queue, 'iqdisc_opts'),
      Number(str(queue, 'download') ?? '0'),
    ),
    milkflint: milkflint ?? [],
    squash: { squash_dscp: str(queue, 'squash_dscp'), squash_ingress: str(queue, 'squash_ingress') },
  };
}

export function validate(f: SqmForm): Partial<Record<'downloadMbit' | 'uploadMbit', string>> {
  const e: Partial<Record<'downloadMbit' | 'uploadMbit', string>> = {};
  if (!f.enabled) return e;
  for (const key of ['downloadMbit', 'uploadMbit'] as const) {
    const v = Number(f[key]);
    if (!Number.isFinite(v) || v <= 0) e[key] = 'Enter your line speed in Mbit/s, e.g. 450.';
    else if (v > 10_000) e[key] = 'That’s more than 10 Gbit/s.';
  }
  return e;
}

const kbit = (mbit: string): number => Math.round(Number(mbit) * 1000);

/** CAKE keywords a save replaces in one direction's opts, and what it puts in their place */
interface OptsEdit {
  managed: string[];
  wanted: string[];
}

/**
 * The changes that save the form. Only what changed is written, so keywords,
 * options and choices set in LuCI stay as they are unless their own setting
 * changed. The automatic choices that go with the download speed (multi-queue,
 * CAKE taking GRO packets whole) and Low upload memory, which goes with the
 * upload speed, are written when the speed change changes what they give.
 * A new queue gets everything.
 */
export function toChanges(f: SqmForm, data: SqmData): Change[] {
  const was = data.form;
  const isNew = f.section === undefined;
  const changed = (key: keyof SqmForm): boolean => isNew || f[key] !== was[key];
  const download = kbit(f.downloadMbit);
  const upload = kbit(f.uploadMbit);
  const wasDownload = kbit(was.downloadMbit);
  const wasUpload = kbit(was.uploadMbit);
  const values: Record<string, string> = {};
  const unset: string[] = [];

  if (changed('enabled')) values['enabled'] = f.enabled ? '1' : '0';
  if (changed('device') || !data.interfaceSet) values['interface'] = f.device;
  if (isNew || download !== wasDownload) values['download'] = String(download);
  if (isNew || upload !== wasUpload) values['upload'] = String(upload);
  if (changed('prioritise')) {
    values['qdisc'] = 'cake';
    values['script'] = f.prioritise ? 'layer_cake.qos' : 'piece_of_cake.qos';
  }
  const multiQueue = usesMultiQueue(download, f.multiQueue);
  if (changed('multiQueue') || multiQueue !== usesMultiQueue(wasDownload, f.multiQueue)) values['use_mq'] = multiQueue ? '1' : '0';

  const iq: OptsEdit = { managed: [], wanted: [] };
  const eq: OptsEdit = { managed: [], wanted: [] };
  // the keywords set in both directions' opts
  const both = (managed: string[], wanted: string[]): void => {
    for (const o of [iq, eq]) {
      o.managed.push(...managed);
      o.wanted.push(...wanted);
    }
  };
  const preset: LinkPresetDef | undefined = f.link === 'custom' ? undefined : linkPresets[f.link];
  if (changed('link') && preset !== undefined) {
    values['linklayer'] = preset.linklayer;
    values['overhead'] = preset.overhead;
    // LuCI keeps tcMPU only in its advanced link-layer mode
    if (preset.mpu !== undefined) Object.assign(values, { tcMPU: preset.mpu, linklayer_advanced: '1' });
    // a preset without an mpu: sqm's default (none)
    else if (data.mpu !== undefined) unset.push('tcMPU');
    both(['ptm'], preset.ptm === true ? ['ptm'] : []);
  }
  if (changed('latency') && f.latency !== 'custom') {
    const rtt = latencyTargets[f.latency].rtt;
    both(RTT, rtt === undefined ? [] : ['rtt', rtt]);
  }
  if (changed('perDevice')) {
    iq.managed.push(...FAIR_INGRESS);
    eq.managed.push(...FAIR_EGRESS);
    if (f.perDevice) {
      iq.wanted.push(...FAIR_INGRESS);
      eq.wanted.push(...FAIR_EGRESS);
    }
  }
  // CAKE taking GRO packets whole: when the speed change changes what the
  // choice gives, and the download's opts don't already say so
  const whole = takesWhole(download, data.whole);
  if ((isNew || whole !== takesWhole(wasDownload, data.whole)) && whole !== words(data.iqdiscOpts).includes('no-split-gso')) {
    iq.managed.push(...GSO);
    if (whole) iq.wanted.push('no-split-gso');
  }
  // Low's limit goes with the upload speed
  if (f.uploadMemory !== 'custom' && (changed('uploadMemory') || (f.uploadMemory === 'low' && upload !== wasUpload))) {
    eq.managed.push('memlimit');
    if (f.uploadMemory === 'low') eq.wanted.push('memlimit', String(lowMemlimit(upload)));
  }
  if (changed('ackFilter') && f.ackFilter !== 'custom') {
    eq.managed.push(...ACK_FILTER);
    if (f.ackFilter === 'on') eq.wanted.push('ack-filter');
  }

  for (const [key, edit, current] of [
    ['iqdisc_opts', iq, data.iqdiscOpts],
    ['eqdisc_opts', eq, data.eqdiscOpts],
  ] as const) {
    if (edit.managed.length === 0) continue;
    const opts = withOpts(current, edit.managed, edit.wanted);
    if (opts === words(current).join(' ')) continue;
    if (opts !== '') {
      values[key] = opts;
      // LuCI shows these options only in its advanced mode
      for (const mode of ['qdisc_advanced', 'qdisc_really_really_advanced']) if (str(data.queue, mode) !== '1') values[mode] = '1';
    } else if (current !== undefined) {
      unset.push(key);
    }
  }

  if (changed('restoreDscp') || (f.restoreDscp && changed('prioritise'))) {
    const dscp = sqmDscpOptions(f.restoreDscp, f.prioritise, was.restoreDscp);
    Object.assign(values, dscp.set);
    unset.push(...dscp.unset.filter((key) => data.squash[key] !== undefined));
  }

  const changes: Change[] = [];
  if (isNew) changes.push({ op: 'add', config: 'sqm', type: 'queue', name: 'wan', values });
  else if (f.section !== undefined) {
    if (Object.keys(values).length > 0) changes.push({ op: 'set', config: 'sqm', section: f.section, values });
    if (unset.length > 0) changes.push({ op: 'unset', config: 'sqm', section: f.section, options: unset });
  }
  if (changed('restoreDscp') || changed('multiQueue')) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'cake', {
        ...(changed('restoreDscp') ? { dscp_restore: f.restoreDscp ? '1' : undefined } : {}),
        ...(changed('multiQueue') ? { multi_queue: multiQueueValue(f.multiQueue) } : {}),
      }),
    );
  }
  // hardware offloading only: CAKE still shapes software-offloaded packets
  if (f.offloadOff && data.offloading !== undefined) {
    changes.push({
      op: 'set',
      config: 'firewall',
      section: data.offloading.section,
      values: { flow_offloading_hw: '0' },
    });
  }
  return changes;
}
