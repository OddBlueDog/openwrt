// Hardware offloading with Wireless Ethernet Dispatch (WED): milkflint.wifi.wed
// "1" on, unset off (the router side is /usr/libexec/milkflint/wed, which
// holds the same rule whatever else changes the settings).
//
// With it on, the router's chip forwards an established connection by itself,
// Wi-Fi included, so its packets pass by everything the router does to packets
// in software. One rule everywhere: while WED is on it wins, until it's turned
// off. Turning it on
// - turns off every Smart Queue queue but the VPN's (sqm's enabled "0"): the
//   internet port's and the guest networks' speed limits, which a
//   hardware-forwarded packet never meets;
// - turns on the firewall's flow offloading, software and hardware
//   (flow_offloading, flow_offloading_hw), which it needs;
// - remembers both in a milkflint section, wed: sqm, the queues it turned off
//   (section names, space-separated), and offload / offload_hw, what the
//   firewall's two options were ("0" for unset).
// Turning it off puts those back as they were and forgets them. The Wi-Fi
// driver takes the setting when the router next starts.
// Shared by the pages whose settings it turns off or passes by.
import { bool, type Change, type Section, sectionChanges, str } from '@/lib/api/uci';

/** The VPN's queue is inside its tunnel, whose traffic is never hardware-forwarded. */
const VPN_DEVICE = 'wg_out';

export interface WedConfig {
  milkflint: readonly Section[];
  sqm: readonly Section[];
  firewall: readonly Section[];
}

function section(sections: readonly Section[], name: string): Section | undefined {
  return sections.find((s) => s['.name'] === name);
}

/** Whether the setting is on. */
export function wedOn(milkflint: readonly Section[]): boolean {
  return str(section(milkflint, 'wifi'), 'wed') === '1';
}

/** Smart Queue's queues that hardware-forwarded traffic passes by: every one but the VPN's. */
export function queuesPassedBy(sqm: readonly Section[]): Section[] {
  return sqm.filter((s) => s['.type'] === 'queue' && str(s, 'interface') !== VPN_DEVICE);
}

/** The queues turning WED on turns off: those that are on now. */
export function queuesTurnedOff(sqm: readonly Section[]): Section[] {
  return queuesPassedBy(sqm).filter((s) => bool(s, 'enabled'));
}

/** The queues WED turned off, by section name, as the wed section remembers them. */
export function queuesRemembered(milkflint: readonly Section[]): string[] {
  return (str(section(milkflint, 'wed'), 'sqm') ?? '').split(/\s+/).filter((q) => q !== '');
}

function fwDefaults(firewall: readonly Section[]): Section | undefined {
  return firewall.find((s) => s['.type'] === 'defaults');
}

/** What turning WED on changes, for saying so before it's saved. */
export interface WedEffects {
  /** the queues it turns off, with their speeds in kbit/s (0: not limited that way) */
  queues: { section: string; device: string; download: number; upload: number }[];
  /** the firewall's flow offloading it turns on */
  offload: boolean;
  offloadHw: boolean;
}

/** a queue's speed in kbit/s; 0 for none or anything that isn't a number */
function kbit(value: string | undefined): number {
  const n = Number(value ?? '0');
  return Number.isFinite(n) ? n : 0;
}

export function wedEffects(cfg: WedConfig): WedEffects {
  const fw = fwDefaults(cfg.firewall);
  return {
    queues: queuesTurnedOff(cfg.sqm).map((q) => ({
      section: q['.name'],
      device: str(q, 'interface') ?? '',
      download: kbit(str(q, 'download')),
      upload: kbit(str(q, 'upload')),
    })),
    offload: fw !== undefined && !bool(fw, 'flow_offloading'),
    offloadHw: fw !== undefined && !bool(fw, 'flow_offloading_hw'),
  };
}

/**
 * The changes that turn WED on, or with it on already bring the rest in line
 * with it. None when everything is as it should be.
 */
export function wedOnChanges(cfg: WedConfig): Change[] {
  const changes: Change[] = [];
  const off = queuesTurnedOff(cfg.sqm);
  const fw = fwDefaults(cfg.firewall);
  const had = section(cfg.milkflint, 'wed');
  const remember: Record<string, string | undefined> = {};
  if (off.length > 0) {
    const names = queuesRemembered(cfg.milkflint);
    for (const q of off) if (!names.includes(q['.name'])) names.push(q['.name']);
    remember['sqm'] = names.join(' ');
  }
  const fwValues: Record<string, string> = {};
  if (fw !== undefined && !(str(fw, 'flow_offloading') === '1' && str(fw, 'flow_offloading_hw') === '1')) {
    // what they were before WED: kept from the first time, not from a later edit
    if (str(had, 'offload') === undefined) remember['offload'] = str(fw, 'flow_offloading') ?? '0';
    if (str(had, 'offload_hw') === undefined) remember['offload_hw'] = str(fw, 'flow_offloading_hw') ?? '0';
    if (str(fw, 'flow_offloading') !== '1') fwValues['flow_offloading'] = '1';
    if (str(fw, 'flow_offloading_hw') !== '1') fwValues['flow_offloading_hw'] = '1';
  }
  changes.push(...sectionChanges('milkflint', [...cfg.milkflint], 'wifi', { wed: '1' }));
  if (Object.keys(remember).length > 0) {
    // only what's new: what the section already remembers stays
    const values = Object.fromEntries(Object.entries(remember).filter(([option, value]) => str(had, option) !== value)) as Record<string, string>;
    if (Object.keys(values).length > 0) {
      changes.push(
        had === undefined ? { op: 'add', config: 'milkflint', type: 'wed', name: 'wed', values } : { op: 'set', config: 'milkflint', section: 'wed', values },
      );
    }
  }
  for (const q of off) changes.push({ op: 'set', config: 'sqm', section: q['.name'], values: { enabled: '0' } });
  if (fw !== undefined && Object.keys(fwValues).length > 0) changes.push({ op: 'set', config: 'firewall', section: fw['.name'], values: fwValues });
  return changes;
}

/** What turning WED off puts back, for saying so. */
export interface WedRestores {
  /** the queues it turns back on */
  queues: { section: string; device: string }[];
  /** the firewall's options it puts back, and to what */
  offload: boolean | undefined;
  offloadHw: boolean | undefined;
}

/** a firewall offloading option back to what it was; undefined: as it is */
function putBack(fw: Section, option: string, was: string | undefined): string | undefined {
  if (was === undefined || str(fw, option) === was) return undefined;
  // "0" is unset or off, which the firewall reads the same: an unset one stays unset
  if (was === '0' && str(fw, option) === undefined) return undefined;
  return was;
}

export function wedRestores(cfg: WedConfig): WedRestores {
  const fw = fwDefaults(cfg.firewall);
  const had = section(cfg.milkflint, 'wed');
  const sw = fw === undefined ? undefined : putBack(fw, 'flow_offloading', str(had, 'offload'));
  const hw = fw === undefined ? undefined : putBack(fw, 'flow_offloading_hw', str(had, 'offload_hw'));
  return {
    queues: queuesRemembered(cfg.milkflint)
      .map((name) => section(cfg.sqm, name))
      .filter((q): q is Section => q?.['.type'] === 'queue' && !bool(q, 'enabled'))
      .map((q) => ({ section: q['.name'], device: str(q, 'interface') ?? '' })),
    offload: sw === undefined ? undefined : sw === '1',
    offloadHw: hw === undefined ? undefined : hw === '1',
  };
}

/**
 * The changes that turn WED off and put back what it turned off. None when
 * it's off with nothing remembered. keepFirewall: leave the firewall's
 * offloading as it is (the page saving has set it itself).
 */
export function wedOffChanges(cfg: WedConfig, { keepFirewall = false } = {}): Change[] {
  const changes: Change[] = [];
  const fw = fwDefaults(cfg.firewall);
  const had = section(cfg.milkflint, 'wed');
  changes.push(...sectionChanges('milkflint', [...cfg.milkflint], 'wifi', { wed: undefined }));
  if (had === undefined) return changes;
  for (const q of wedRestores(cfg).queues) changes.push({ op: 'set', config: 'sqm', section: q.section, values: { enabled: '1' } });
  if (fw !== undefined && !keepFirewall) {
    const values: Record<string, string> = {};
    const hw = putBack(fw, 'flow_offloading_hw', str(had, 'offload_hw'));
    const sw = putBack(fw, 'flow_offloading', str(had, 'offload'));
    if (hw !== undefined) values['flow_offloading_hw'] = hw;
    if (sw !== undefined) values['flow_offloading'] = sw;
    if (Object.keys(values).length > 0) changes.push({ op: 'set', config: 'firewall', section: fw['.name'], values });
  }
  changes.push({ op: 'delete', config: 'milkflint', section: 'wed' });
  return changes;
}

/** "600 / 60 Mbit/s", "25 Mbit/s down", from kbit/s; '' with no limit either way */
export function speedsText(download: number, upload: number): string {
  const mbit = (kbit: number): string => String(Math.round(kbit / 100) / 10);
  if (download > 0 && upload > 0) return `${mbit(download)} / ${mbit(upload)} Mbit/s`;
  if (download > 0) return `${mbit(download)} Mbit/s down`;
  if (upload > 0) return `${mbit(upload)} Mbit/s up`;
  return '';
}

/** What the router says the Wi-Fi driver is doing (milkflint.tuning status). */
export interface WedStatus {
  wanted: boolean;
  /** how the loaded driver has it; null without the driver */
  loaded: boolean | null;
  /** a radio is attached to the chip's WED */
  active: boolean;
}

/** The driver doesn't yet run as the setting asks: it does once the router restarts. */
export function wedNeedsRestart(on: boolean, status: WedStatus | undefined): boolean {
  return status !== undefined && status.loaded !== null && status.loaded !== on;
}

/** In a few words, what's in effect now. */
export function wedNow(on: boolean, status: WedStatus | undefined): string {
  if (status === undefined) return '…';
  if (status.loaded === null) return 'No Wi-Fi driver that has it';
  if (wedNeedsRestart(on, status)) return on ? 'Not yet: once the router restarts' : 'Still on until the router restarts';
  if (!on) return 'Off';
  return status.active ? 'On' : 'On in the driver, but no radio took it: see the kernel log';
}
