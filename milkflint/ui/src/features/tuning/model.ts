// Performance tuning's model: the form, what it reads from the router's
// configuration, what a save writes, and the labels the page and its
// summary share.
import { z } from 'zod';
import { bool, type Change, type Section, sectionChanges, str } from '@/lib/api/uci';
import type { NetworkLive } from '@/hooks/use-network-live';
import { formatNumber } from '@/lib/format';
import { cpuText } from '@/lib/network-text';
import { cakeTargetMs, GSO, takesWhole, type Whole, wholeOf, wholeValue, withOpts, words } from '../sqm/gso';
import { multiQueueValue, usesMultiQueue } from '../sqm/multi-queue';
import { isVpnShaper } from '../vpn-client/sections';
import { isGuestShaper } from '../wifi-guest/guest';
import type { GroPort } from './api';
import {
  AQL_OWN_TOTAL,
  type AqlTotal,
  aqlAutoTotal,
  aqlTotalError,
  aqlTotalOf,
  aqlTotalValue,
  knobDefaults,
  knobFields,
  knobOptions,
  knobSectionsChanged,
  readKnobs,
} from './knobs';
import { type WedConfig, wedOffChanges, wedOn, wedOnChanges } from './wed';

// The settings (router side: features/tuning/init puts them into effect):
// - milkflint.wifi.aql_be: the Wi-Fi queue's best-effort limits, "<low>
//   <high>" in µs or "off" (mac80211's own); unset is 2500/5000;
// - milkflint.wifi.aql_threshold: the radio's total that holds devices to
//   their low limit; unset follows the high limit (knobs.ts);
// - milkflint.steering.layout: "openwrt" for OpenWrt's packet steering
//   instead of MilkFlint's; milkflint.steering.rss "0" for MilkFlint's RPS
//   layout, "1" for RSS whatever the line, unset Automatic: RSS, but the
//   RPS layout when an interface is PPPoE, which RSS can't spread
//   (packet-steering.sh); network.globals.packet_steering "0" turns
//   steering off (LuCI's Packet Steering option);
// - milkflint.gro.mode ("fraglist", "plain", "off"), .udp_fwd ("1", "0"),
//   .max_size (bytes): the internet port's GRO, read by
//   /usr/libexec/milkflint/gro; unset is its automatic choice;
// - milkflint.gro.whole ("1", "0"): whether Smart Queue's download CAKE takes
//   GRO packets whole; unset goes with the speed (../sqm/gso.ts). The page
//   writes sqm's iqdisc_opts to match, as the Smart Queue page does.
//   Automatic is plain GRO up to 16 KB when the download CAKE takes GRO
//   packets whole, fraglist GRO otherwise;
// - the latency settings in ./knobs.ts: milkflint.steering.wifi_all,
//   .rings_rt and .rx_delay, the experimental .lan_rps, .pdma_stag, .dsa_gro
//   (these two packet-steering.sh applies), .rx_dim_per_ring and
//   .qdma_tx_dim, milkflint.cake.ecn_drop and .l4s, milkflint.wifi.retries;
// - firewall's defaults flow_offloading: software flow offloading, as the
//   Firewall page sets it ("1" in the image). Turning it off turns hardware
//   offloading (flow_offloading_hw) off too, as that needs it;
// - milkflint.wifi.wed "1": hardware offloading with Wireless Ethernet
//   Dispatch (./wed.ts). Turning it on turns Smart Queue off and the
//   firewall's flow offloading on, software and hardware, remembering what
//   they were in milkflint.wed, and turning it off puts them back. The page
//   says what a save will change before it's made, and the Wi-Fi driver takes
//   the setting when the router restarts, which the save offers.
// Unset everywhere is what the image does: Restore defaults unsets them.
// A change of layout can also switch Smart Queue's multi-queue CAKE (sqm's
// use_mq), which only spreads over CPUs where each CPU feeds its own
// sub-queue: with RSS, and in the RPS layout too (sqm-scripts gives the ifb
// of pppoe-wan, and of a port RPS spreads, a sub-queue per CPU: its patches
// 109 and 110). To such a layout it goes back to following the download
// speed (milkflint.cake.multi_queue unset, ../sqm/multi-queue.ts, whose
// threshold goes with the line: PPPoE or not), away from it off ("0").

export type Aql = 'default' | 'off' | 'custom';
export type Steering = 'auto' | 'rss' | 'rps' | 'openwrt' | 'off';
/** A layout as it runs: Automatic resolves to one of these */
export type SteeringInUse = Exclude<Steering, 'auto'>;
export type Gro = 'auto' | 'fraglist' | 'plain' | 'off';
export type UdpFwd = 'auto' | 'on' | 'off';

const tuningFields = knobFields.extend({
  aql: z.custom<Aql>(),
  /** the custom AQL limits, µs */
  aqlLow: z.string(),
  aqlHigh: z.string(),
  /** the radio's total that holds devices to their low limit, and the custom one in µs */
  aqlTotal: z.custom<AqlTotal>(),
  aqlTotalCustom: z.string(),
  steering: z.custom<Steering>(),
  /** switch Smart Queue's multi-queue CAKE with the steering */
  followQueue: z.boolean(),
  gro: z.custom<Gro>(),
  udpFwd: z.custom<UdpFwd>(),
  /** the largest plain GRO packet in bytes, "" for the kernel's 64 KB */
  groMax: z.string(),
  whole: z.custom<Whole>(),
  /** software flow offloading */
  offload: z.boolean(),
  /** hardware offloading with Wireless Ethernet Dispatch */
  wed: z.boolean(),
});

export type TuningForm = z.infer<typeof tuningFields>;

/** Every field of the form, by name. */
export const tuningFieldNames = tuningFields.keyof().options;

export interface TuningData {
  form: TuningForm;
  milkflint: Section[];
  /** network's globals section, and its packet_steering */
  globals: string | undefined;
  packetSteering: string | undefined;
  /** the firewall's defaults section, and whether hardware flow offloading is on */
  firewall: { section: string; hardware: boolean } | undefined;
  /** Smart Queue's WAN queue section: multi-queue, download speed (kbit/s), CAKE's download options, the delay it aims for */
  sqm:
    | { section: string; multiQueue: boolean; download: number; iqdiscOpts: string | undefined; targetMs: number | null }
    | undefined;
  /** what hardware offloading with WED reads and changes: every milkflint, sqm and firewall section */
  wed: WedConfig;
  /** the router is an access point (the Operating Mode page), which forwards nothing WED could take over */
  accessPoint: boolean;
  /** an interface is PPPoE: Automatic steering is then the RPS layout */
  pppoe: boolean;
}

export const defaults: TuningForm = {
  ...knobDefaults,
  aql: 'default',
  aqlLow: '2500',
  aqlHigh: '5000',
  aqlTotal: 'auto',
  aqlTotalCustom: '',
  steering: 'auto',
  followQueue: true,
  gro: 'auto',
  udpFwd: 'auto',
  groMax: '',
  whole: 'auto',
  offload: true,
  wed: false,
};

export const groLabels: Record<Gro, string> = {
  auto: 'Automatic',
  fraglist: 'Fraglist GRO (OpenWrt’s)',
  plain: 'Plain GRO',
  off: 'Off',
};
// the largest plain GRO packet: automatic, the kernel's 64 KB and three smaller ones
export const groSizes = ['', '65536', '32768', '16384', '8192'];

export function sizeLabel(bytes: string | number): string {
  const n = Number(bytes === '' ? 65536 : bytes);
  return n % 1024 === 0 ? `${String(n / 1024)} KB` : `${formatNumber(n)} bytes`;
}

export const steeringIds = ['auto', 'rss', 'rps', 'openwrt', 'off'] as const;
export const steeringOptions: Record<Steering, { label: string; description: string }> = {
  auto: {
    label: 'Automatic',
    description:
      'RSS, or RPS when the internet connection is PPPoE: the Ethernet hardware can’t spread PPPoE, so with RSS it would all stay on one ring and one CPU.',
  },
  rss: {
    label: 'RSS: hardware receive rings',
    description:
      'The Ethernet hardware spreads flows over three receive rings, each with its own CPU (1–3), and nothing is handed between CPUs in software. With multi-queue Smart Queue, each ring feeds its own CAKE queue on the same CPU. The lightest on the CPUs. It can’t spread PPPoE, which all arrives on ring 0.',
  },
  rps: {
    label: 'RPS: software steering',
    description:
      'Everything arrives on one ring on CPU 0, which hands each flow on to CPUs 1–3. Uses more CPU than RSS for the handing on. Spreads PPPoE, which RSS can’t.',
  },
  openwrt: {
    label: 'OpenWrt’s layout',
    description:
      'OpenWrt’s packet-steering.uc. On the Flint 2 it can leave everything the ports receive on one CPU, which may limit speed and add latency under heavy load. LuCI’s Packet Steering options apply to it.',
  },
  off: {
    label: 'Off',
    description: 'No steering: packets are handled on the CPU that received them, and the drivers’ threads run on any CPU.',
  },
};

/** The choice from its settings: network.globals.packet_steering, milkflint.steering.layout and .rss */
export function readSteering(packetSteering: string | undefined, layout: string | undefined, rss: string | undefined): Steering {
  if (packetSteering === '0') return 'off';
  if (layout === 'openwrt') return 'openwrt';
  return rss === '0' ? 'rps' : rss === '1' ? 'rss' : 'auto';
}

/** milkflint.steering's layout and rss for a choice (off is network.globals.packet_steering) */
export function steeringValues(s: Steering): { layout: string | undefined; rss: string | undefined } {
  return { layout: s === 'openwrt' ? 'openwrt' : undefined, rss: s === 'rps' ? '0' : s === 'rss' ? '1' : undefined };
}

/** An interface is PPPoE, as packet-steering.sh counts it: proto pppoe, with a device */
export function hasPppoe(network: Section[]): boolean {
  return network.some((s) => s['.type'] === 'interface' && str(s, 'proto') === 'pppoe' && (str(s, 'device') ?? '') !== '');
}

/** The layout a choice runs: Automatic is RSS, but RPS on a PPPoE line; RSS without the rings is RPS too */
export function steeringInUse(s: Steering, line: { pppoe: boolean; rssMissing: boolean }): SteeringInUse {
  if (s === 'auto') return line.pppoe || line.rssMissing ? 'rps' : 'rss';
  return s === 'rss' && line.rssMissing ? 'rps' : s;
}

/**
 * Whether multi-queue CAKE's download spreads over the CPUs in a layout: each
 * CPU feeding its own sub-queue. RSS's rings do it; in the RPS layout, the
 * per-CPU queues sqm-scripts gives the ifb of a PPP device or an RPS-spread
 * port. OpenWrt's layout may steer to one CPU; off moves the threads around.
 */
function multiQueueSpreads(s: SteeringInUse): boolean {
  return s === 'rss' || s === 'rps';
}

/** The page's settings, from milkflint, network, sqm and the firewall as uci has them. */
export function tuningData({
  milkflint,
  network,
  sqm,
  firewall,
}: {
  milkflint: Section[];
  network: Section[];
  sqm: Section[];
  firewall: Section[];
}): TuningData {
  const fwDefaults = firewall.find((s) => s['.type'] === 'defaults');
  const section = (name: string): Section | undefined => milkflint.find((s) => s['.name'] === name);
  const aqlBe = str(section('wifi'), 'aql_be');
  // as /usr/libexec/milkflint/wifi-aql reads it: anything else is the default
  const custom = /^(\d{1,6}) (\d{1,6})$/.exec(aqlBe ?? '');
  const globals = network.find((s) => s['.type'] === 'globals');
  const packetSteering = str(globals, 'packet_steering');
  const steering = section('steering');
  const gro = section('gro');
  const groMode = str(gro, 'mode');
  const udpFwd = str(gro, 'udp_fwd');
  const groMax = str(gro, 'max_size') ?? '';
  // the internet port's queue: Guest Wi-Fi's speed limit is one too
  const queue = sqm.find(
    (s) => s['.type'] === 'queue' && !isGuestShaper(str(s, 'interface')) && !isVpnShaper(str(s, 'interface')),
  );
  return {
    form: {
      aql: aqlBe === 'off' ? 'off' : custom === null ? 'default' : 'custom',
      aqlLow: custom?.[1] ?? defaults.aqlLow,
      aqlHigh: custom?.[2] ?? defaults.aqlHigh,
      ...aqlTotalOf(str(section('wifi'), 'aql_threshold')),
      steering: readSteering(packetSteering, str(steering, 'layout'), str(steering, 'rss')),
      followQueue: true,
      gro: groMode === 'fraglist' || groMode === 'plain' || groMode === 'off' ? groMode : 'auto',
      udpFwd: udpFwd === '1' ? 'on' : udpFwd === '0' ? 'off' : 'auto',
      groMax: /^\d{4,5}$/.test(groMax) ? groMax : '',
      // what the queue does, when LuCI changed it (../sqm/gso.ts)
      whole: wholeOf(
        str(gro, 'whole'),
        queue === undefined ? null : str(queue, 'iqdisc_opts'),
        Number(str(queue, 'download') ?? '0'),
      ),
      offload: bool(fwDefaults, 'flow_offloading'),
      wed: wedOn(milkflint),
      ...readKnobs((name, option) => str(section(name), option)),
    },
    milkflint,
    globals: globals?.['.name'],
    packetSteering,
    wed: { milkflint, sqm, firewall },
    accessPoint: str(section('mode'), 'mode') === 'ap',
    pppoe: hasPppoe(network),
    firewall:
      fwDefaults === undefined ? undefined : { section: fwDefaults['.name'], hardware: bool(fwDefaults, 'flow_offloading_hw') },
    sqm:
      queue === undefined
        ? undefined
        : {
            section: queue['.name'],
            multiQueue: bool(queue, 'use_mq'),
            download: Number(str(queue, 'download') ?? '0'),
            iqdiscOpts: str(queue, 'iqdisc_opts'),
            // a single figure only if both directions aim for the same
            targetMs:
              cakeTargetMs(str(queue, 'iqdisc_opts')) === cakeTargetMs(str(queue, 'eqdisc_opts'))
                ? cakeTargetMs(str(queue, 'iqdisc_opts'))
                : null,
          },
  };
}

/** Any GRO setting other than automatic */
export function groChanged(f: TuningForm): boolean {
  return f.gro !== defaults.gro || f.udpFwd !== defaults.udpFwd || f.groMax !== defaults.groMax || f.whole !== defaults.whole;
}

/** milkflint.wifi.aql_be for the form; undefined: unset, the default */
export function aqlValue(f: TuningForm): string | undefined {
  switch (f.aql) {
    case 'default':
      return undefined;
    case 'off':
      return 'off';
    case 'custom':
      return `${Number(f.aqlLow)} ${Number(f.aqlHigh)}`;
  }
}

/**
 * Smart Queue's multi-queue setting the new steering asks for, when it should
 * change: on where the layout gives each CPU its own sub-queue and the
 * download speed asks for it (../sqm/multi-queue.ts), off where it doesn't.
 */
export function queueSwitch(f: TuningForm, data: TuningData): boolean | undefined {
  if (data.sqm === undefined || f.steering === data.form.steering) return undefined;
  const spreads = multiQueueSpreads(steeringInUse(f.steering, { pppoe: data.pppoe, rssMissing: false }));
  const want = spreads && (data.sqm.multiQueue || usesMultiQueue(data.sqm.download, 'auto', data.pppoe));
  return want === data.sqm.multiQueue ? undefined : want;
}

/** What the form asks the router to do: forms that mean the same compare equal. */
export function meaning(f: TuningForm, data: TuningData | undefined): string {
  const queue = data === undefined ? undefined : queueSwitch(f, data);
  return JSON.stringify([
    f.aql === 'custom' ? `${f.aqlLow} ${f.aqlHigh}` : f.aql,
    f.aqlTotal === 'custom' ? f.aqlTotalCustom : f.aqlTotal,
    f.steering,
    queue === undefined ? null : f.followQueue,
    f.gro,
    f.udpFwd,
    f.groMax,
    f.whole,
    data?.firewall === undefined ? null : f.offload,
    f.wed,
    f.wifiAll,
    f.ringsRt,
    f.lanRps,
    f.pdmaStag,
    f.dsaGro,
    f.rxDimPerRing,
    f.qdmaTxDim,
    f.rxDelay,
    f.ecnDrop,
    f.l4s,
    f.retries,
    f.voAggr,
  ]);
}

export type Errors = Partial<Record<'aqlLow' | 'aqlHigh' | 'aqlTotal', string>>;

/** The high limit the form asks for, µs: NaN while a custom one is being typed */
export function aqlHighOf(f: TuningForm): number {
  return f.aql === 'off' ? 12_000 : f.aql === 'custom' ? Number(f.aqlHigh) : Number(defaults.aqlHigh);
}

/** The form and its checks: the AQL limits and the total. */
export const tuningFormSchema: z.ZodType<TuningForm, TuningForm> = tuningFields.superRefine((f, ctx) => {
  const e: Errors = {};
  const totalError = aqlTotalError(f.aqlTotal, f.aqlTotalCustom, aqlHighOf(f));
  if (totalError !== undefined) e.aqlTotal = totalError;
  if (f.aql === 'custom') {
    const ok = (v: string): boolean => /^\d{1,6}$/.test(v) && Number(v) >= 500 && Number(v) <= 50_000;
    if (!ok(f.aqlLow)) e.aqlLow = 'Whole microseconds, 500 to 50,000.';
    if (!ok(f.aqlHigh)) e.aqlHigh = 'Whole microseconds, 500 to 50,000.';
    else if (e.aqlLow === undefined && Number(f.aqlHigh) < Number(f.aqlLow)) e.aqlHigh = 'At least the low limit.';
  }
  for (const [path, message] of Object.entries(e)) ctx.addIssue({ code: 'custom', path: [path], message });
});

// Only what changed is written, so Restore defaults leaves alone what's
// already the default (a LuCI Packet Steering "Enabled" stays as it is).
export function toChanges(f: TuningForm, data: TuningData): Change[] {
  const was = data.form;
  const changes: Change[] = [];
  const knobs = knobOptions(f);
  const knobsChanged = knobSectionsChanged(f, was);
  const total = aqlTotalValue(f.aqlTotal, f.aqlTotalCustom);
  if (aqlValue(f) !== aqlValue(was) || total !== aqlTotalValue(was.aqlTotal, was.aqlTotalCustom) || knobsChanged.has('wifi')) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'wifi', { aql_be: aqlValue(f), aql_threshold: total, ...knobs.wifi }),
    );
  }
  if (f.steering !== was.steering || knobsChanged.has('steering')) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'steering', { ...steeringValues(f.steering), ...knobs.steering }),
    );
  }
  // Smart Queue's multi-queue CAKE goes with the steering: back to following
  // the speed with RSS, off without it (the Smart Queue page's setting)
  const queue = queueSwitch(f, data);
  const follow = queue !== undefined && f.followQueue && data.sqm !== undefined;
  if (knobsChanged.has('cake') || follow) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'cake', {
        ...(knobsChanged.has('cake') ? knobs.cake : {}),
        ...(follow ? { multi_queue: multiQueueValue(queue ? 'auto' : 'off') } : {}),
      }),
    );
  }
  if (f.steering !== was.steering) {
    // on or off is OpenWrt's own option: "0" is off, unset (its default) on
    if (f.steering === 'off') {
      changes.push(
        data.globals === undefined
          ? { op: 'add', config: 'network', type: 'globals', name: 'globals', values: { packet_steering: '0' } }
          : { op: 'set', config: 'network', section: data.globals, values: { packet_steering: '0' } },
      );
    } else if (data.packetSteering === '0' && data.globals !== undefined) {
      changes.push({ op: 'unset', config: 'network', section: data.globals, options: ['packet_steering'] });
    }
    if (follow && data.sqm !== undefined) {
      changes.push({ op: 'set', config: 'sqm', section: data.sqm.section, values: { use_mq: queue ? '1' : '0' } });
    }
  }
  if (f.gro !== was.gro || f.udpFwd !== was.udpFwd || f.groMax !== was.groMax || f.whole !== was.whole) {
    changes.push(
      ...sectionChanges('milkflint', data.milkflint, 'gro', {
        mode: f.gro === 'auto' ? undefined : f.gro,
        udp_fwd: f.udpFwd === 'auto' ? undefined : f.udpFwd === 'on' ? '1' : '0',
        max_size: f.groMax === '' ? undefined : f.groMax,
        whole: wholeValue(f.whole),
      }),
    );
  }
  // WED first: a change of software offloading made with it comes after and stands
  if (f.wed !== was.wed) changes.push(...(f.wed ? wedOnChanges(data.wed) : wedOffChanges(data.wed)));
  // turning WED off puts the firewall's offloading back as it was before it; software offloading is this
  // page's own switch, which WED had on, so it ends as the switch shows
  if (!f.wed && was.wed && f.offload && data.firewall !== undefined) {
    changes.push({ op: 'set', config: 'firewall', section: data.firewall.section, values: { flow_offloading: '1' } });
  }
  if (f.offload !== was.offload && data.firewall !== undefined) {
    const values: Record<string, string> = { flow_offloading: f.offload ? '1' : '0' };
    if (!f.offload && data.firewall.hardware) values['flow_offloading_hw'] = '0';
    changes.push({ op: 'set', config: 'firewall', section: data.firewall.section, values });
  }
  // CAKE's own option, as the Smart Queue page writes it: when the setting
  // changed and CAKE doesn't already do what it asks
  const q = data.sqm;
  const whole = q !== undefined && takesWhole(q.download, f.whole);
  if (q !== undefined && f.whole !== was.whole && whole !== words(q.iqdiscOpts).includes('no-split-gso')) {
    const opts = withOpts(q.iqdiscOpts, GSO, whole ? ['no-split-gso'] : []);
    if (opts !== '') {
      // LuCI shows the option only in its advanced mode
      const values = { iqdisc_opts: opts, qdisc_advanced: '1', qdisc_really_really_advanced: '1' };
      changes.push({ op: 'set', config: 'sqm', section: q.section, values });
    } else if (q.iqdiscOpts !== undefined) {
      changes.push({ op: 'unset', config: 'sqm', section: q.section, options: ['iqdisc_opts'] });
    }
  }
  return changes;
}

export function aqlLabel(f: TuningForm): string {
  switch (f.aql) {
    case 'default':
      return '2,500 / 5,000 µs';
    case 'off':
      return '5,000 / 12,000 µs (mac80211’s own)';
    case 'custom':
      return `${formatNumber(Number(f.aqlLow))} / ${formatNumber(Number(f.aqlHigh))} µs`;
  }
}

/** The radio's total for the form: "Automatic: 6,000 µs" */
export function aqlTotalLabel(f: TuningForm): string {
  switch (f.aqlTotal) {
    case 'auto': {
      const high = aqlHighOf(f);
      return Number.isNaN(high)
        ? 'Automatic: 1.2 times the high limit'
        : `Automatic: ${formatNumber(aqlAutoTotal(high, f.aql === 'off'))} µs`;
    }
    case 'own':
      return `${formatNumber(AQL_OWN_TOTAL)} µs (mac80211’s own)`;
    case 'custom':
      return `${formatNumber(Number(f.aqlTotalCustom))} µs`;
  }
}

/** "0.66 ms": how long a 64 KB GRO packet holds a queue shaped to kbit/s */
export function holdMs(bytes: number, kbit: number): string {
  const ms = (bytes * 8) / kbit;
  return `${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`;
}

export function groReason(port: GroPort): string {
  return port.whole ? 'Smart Queue keeps grouped packets whole' : 'Smart Queue splits grouped packets up';
}

export function groNow(port: GroPort): string {
  const { gro, list, udp, max } = port.now;
  if (gro === false) return 'GRO off';
  const kind = list === null ? 'GRO' : list ? 'Fraglist GRO' : 'Plain GRO';
  const parts = [kind];
  if (udp !== null) parts.push(`UDP forwarding ${udp ? 'on' : 'off'}`);
  if (list === false && max !== null) parts.push(`up to ${sizeLabel(max)}`);
  return parts.join(', ');
}

/** Where a setting sits on the page: the essentials, or the expert options. */
export type Tier = 'essentials' | 'expert';

/**
 * The settings that differ from what MilkFlint ships with, in the page's
 * order, each with its tier: for the summary at the top and the folded
 * expert options, so nothing changed hides behind the fold.
 */
export function changedSettings(f: TuningForm, data: Pick<TuningData, 'firewall'>): { tier: Tier; label: string }[] {
  const all: [Tier, string, boolean][] = [
    ['essentials', 'Packet steering', f.steering !== defaults.steering],
    ['essentials', 'Software flow offloading', data.firewall !== undefined && f.offload !== defaults.offload],
    ['essentials', 'Hardware offloading (WED)', f.wed !== defaults.wed],
    ['expert', 'Wi-Fi threads on every CPU', f.wifiAll !== defaults.wifiAll],
    ['expert', 'Internet receive threads first', f.ringsRt !== defaults.ringsRt],
    ['expert', 'Spread what the LAN ports receive', f.lanRps !== defaults.lanRps],
    ['expert', 'Let RSS spread what the LAN ports receive', f.pdmaStag !== defaults.pdmaStag],
    ['expert', 'Group what the LAN ports receive in one pass', f.dsaGro !== defaults.dsaGro],
    ['expert', 'Receive interrupt delay', f.rxDelay !== defaults.rxDelay],
    ['expert', 'Each receive ring picks its own interrupt delay', f.rxDimPerRing !== defaults.rxDimPerRing],
    ['expert', 'Send-complete interrupts follow sending’s own moderation', f.qdmaTxDim !== defaults.qdmaTxDim],
    ['expert', 'GRO', f.gro !== defaults.gro],
    ['expert', 'UDP GRO forwarding', f.udpFwd !== defaults.udpFwd],
    ['expert', 'Smart Queue keeps grouped packets whole', f.whole !== defaults.whole],
    ['expert', 'Largest GRO packet', f.groMax !== defaults.groMax],
    ['expert', 'ECN drops', f.ecnDrop !== defaults.ecnDrop],
    ['expert', 'L4S marking', f.l4s !== defaults.l4s],
    ['expert', 'Wi-Fi queue limit', aqlValue(f) !== undefined],
    ['expert', 'Wi-Fi radio’s total', aqlTotalValue(f.aqlTotal, f.aqlTotalCustom) !== undefined],
    ['expert', 'Sends per frame', f.retries !== defaults.retries],
    ['expert', 'Voice queue aggregation', f.voAggr !== defaults.voAggr],
  ];
  return all.filter(([, , changed]) => changed).map(([tier, label]) => ({ tier, label }));
}

/** A radio's AQL limits as they are now, with the total on an image that says */
export function aqlInUse(r: { low: number; high: number; threshold: number | null }): string {
  return `${formatNumber(r.low)} / ${formatNumber(r.high)} µs${r.threshold === null ? '' : `, ${formatNumber(r.threshold)} µs in all`}`;
}

/** A short name for how received packets are spread right now. */
export function spreadBadge(live: NetworkLive): { text: string; variant: 'success' | 'secondary' } {
  if (live.rss?.spreading === true) {
    const rings = live.rings.filter((r) => r.share > 0).map((r) => r.ring);
    return { text: `RSS · ring${rings.length === 1 ? '' : 's'} ${rings.join(', ')}`, variant: 'success' };
  }
  if (live.rps.length > 0) return { text: `RPS · ${cpuText(live.rps)}`, variant: 'secondary' };
  return { text: 'Not spread', variant: 'secondary' };
}
