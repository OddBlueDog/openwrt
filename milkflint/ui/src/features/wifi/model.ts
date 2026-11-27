// The Wi-Fi settings both Wi-Fi pages edit, as one form per band: what's read
// from the wireless config (and milkflint.wifi), what each choice may be, and
// what a save writes. Networks & radios (page.tsx) edits a band's network and
// radio; the Wi-Fi driver page (features/wifi-driver) its driver settings.
// Each page writes only its own part, so one never rewrites the other's.
import { z } from 'zod';
import type { Change, Section } from '@/lib/api/uci';
import type { Country, Frequency, MuruStatus, RegRule, SpatialReuse } from '@/lib/api/wireless';
import {
  type AirtimeBandKey,
  type AirtimeBands,
  airtimeBandsErrors,
  airtimeBandValues,
  airtimeOption,
  airtimeValue,
} from './airtime';
import { formErrors } from '@/lib/form/errors';
import { blockOf } from './channels';
import { type HoldBack, holdBackValues } from './hold-back';
import { type MuruSetting, muruDriverOptions } from './muru';
import { keyError } from './security';
import { type SprSetting, sprDriverMode, sprOption, sprRadioOptions } from './spatial-reuse';
import { type TwtSetting, twtDriverOptions, twtRadioOptions, twtRestarts } from './twt';

export const noFaster = 'It’s no faster: the router’s Wi-Fi chip encrypts with every one of these ciphers in hardware.';

// LuCI's "Cipher": the part of OpenWrt's `encryption` after its first '+'
// (sae-mixed+gcmp). Auto leaves it off, which is CCMP for every mode above.
// The MT7986 takes all four AES ciphers into hardware (mt7915_set_key), so
// none costs the router CPU or mac80211's 802.3 offload. A forced cipher is
// the group cipher too (broadcasts and multicasts, to every device). WPA
// (v1) has no GCMP or 256-bit ciphers; TKIP is only offered where WPA is.
export const cipherOptions = [
  { value: 'ccmp', label: 'CCMP (AES)', modes: ['sae-mixed', 'sae', 'psk2', 'psk-mixed'], warning: undefined },
  {
    value: 'gcmp',
    label: 'GCMP',
    modes: ['sae-mixed', 'sae', 'psk2'],
    warning: 'Devices without GCMP can’t join, and many don’t have it, older ones especially.',
  },
  {
    value: 'ccmp256',
    label: 'CCMP-256',
    modes: ['sae-mixed', 'sae', 'psk2'],
    warning: 'Few devices have CCMP-256: the rest can’t join.',
  },
  {
    value: 'gcmp256',
    label: 'GCMP-256',
    modes: ['sae-mixed', 'sae', 'psk2'],
    warning: 'Few devices have GCMP-256: the rest can’t join.',
  },
  {
    value: 'tkip+ccmp',
    label: 'TKIP and CCMP (AES)',
    modes: ['psk-mixed'],
    warning:
      'Devices that join with TKIP are held to 54 Mbit/s, and broadcasts to every device use TKIP too. TKIP is long outdated: use it only while a WPA-only device needs it.',
  },
] as const;

/** Other spellings OpenWrt takes for the same ciphers (LuCI may have saved one). */
const cipherAliases: Record<string, string> = {
  aes: 'ccmp',
  'tkip+aes': 'tkip+ccmp',
  'aes+tkip': 'tkip+ccmp',
  'ccmp+tkip': 'tkip+ccmp',
};

export function cipherOption(cipher: string): (typeof cipherOptions)[number] | undefined {
  const value = cipherAliases[cipher] ?? cipher;
  return cipherOptions.find((c) => c.value === value);
}

/** Whether a security mode can have a saved cipher, under any of its spellings. */
export function cipherFits(cipher: string, security: string): boolean {
  return (cipherOption(cipher)?.modes as readonly string[] | undefined)?.includes(security) === true;
}

/**
 * The security modes in plain words, for the select on the surface; the
 * standard's own names (WPA2-PSK/WPA3-SAE) stay in its "Why?".
 */
export const SECURITY_PLAIN: Record<string, string> = {
  'sae-mixed': 'WPA2/WPA3 (recommended)',
  sae: 'WPA3 only',
  psk2: 'WPA2 only',
  'psk-mixed': 'WPA/WPA2 (very old devices)',
  none: 'None: an open network',
};

// Wi-Fi mode is the first part of OpenWrt's htmode (HE80 = 802.11ax at
// 80 MHz); NOHT is legacy 802.11a/g (no 802.11b: OpenWrt leaves its rates
// out), which has no width to choose. require is OpenWrt's require_mode,
// keeping out devices older than the mode: there's none for Wi-Fi 7.
const modes = [
  { prefix: 'EHT', name: 'BE', wifi: 'Wi-Fi 7', require: undefined, bands: ['2g', '5g', '6g'] },
  { prefix: 'HE', name: 'AX', wifi: 'Wi-Fi 6', require: 'ax', bands: ['2g', '5g', '6g'] },
  { prefix: 'VHT', name: 'AC', wifi: 'Wi-Fi 5', require: 'ac', bands: ['5g'] },
  { prefix: 'HT', name: 'N', wifi: 'Wi-Fi 4', require: 'n', bands: ['2g', '5g'] },
  { prefix: 'NOHT', name: '', wifi: '', require: undefined, bands: ['2g', '5g'] },
] as const;

const bandWidths: Record<string, string[]> = {
  '2g': ['20', '40'],
  '5g': ['20', '40', '80', '160'],
  '6g': ['20', '40', '80', '160', '320'],
};

/** Modes this radio can use on its band, each with its widths, from what the radio reports (htmodes). */
export function modesFor(band: string, htmodes: readonly string[] | undefined): { prefix: string; widths: string[] }[] {
  return modes
    .filter((m) => (m.bands as readonly string[]).includes(band))
    .map((m) => {
      const all = m.prefix === 'NOHT' ? [] : m.prefix === 'HT' ? ['20', '40'] : (bandWidths[band] ?? ['20']);
      const widths = htmodes === undefined ? all : all.filter((w) => htmodes.includes(`${m.prefix}${w}`));
      return { prefix: m.prefix, widths };
    })
    .filter((m) => m.prefix === 'NOHT' || m.widths.length > 0)
    .filter((m) => m.prefix !== 'EHT' || htmodes?.some((h) => h.startsWith('EHT')) === true);
}

export interface Standards {
  /** `${prefix}:${requireMode}`, the select's value. */
  value: string;
  prefix: string;
  requireMode: string;
  label: string;
  hint: string;
}

/**
 * The networks a radio can offer, newest first: for each of its modes, the
 * standards that may join, from that mode alone down to every older one
 * (AX only, AX / AC, AX / AC / N, AX / AC / N / A on 5 GHz).
 */
export function standardsFor(band: string, available: readonly { prefix: string }[]): Standards[] {
  const legacy = band === '2g' ? 'G' : 'A';
  const list = available.flatMap((a) => modes.filter((m) => m.prefix === a.prefix));
  const name = (m: (typeof list)[number]): string => (m.prefix === 'NOHT' ? legacy : m.name);
  return list.flatMap((top, i): Standards[] => {
    if (top.prefix === 'NOHT')
      return [
        {
          value: 'NOHT:',
          prefix: 'NOHT',
          requireMode: '',
          label: `${legacy} only (legacy)`,
          hint: 'Slow: only for devices from before 2009.',
        },
      ];
    return list.slice(i).flatMap((oldest, k): Standards[] => {
      const joins = list.slice(i, i + k + 1);
      const everyone = i + k === list.length - 1;
      // every 6 GHz device is Wi-Fi 6 or newer: nothing to keep out
      if (!everyone && (band === '6g' || oldest.require === undefined)) return [];
      const requireMode = everyone ? '' : (oldest.require ?? '');
      const wifi = joins.filter((m) => m.prefix !== 'NOHT').map((m) => m.wifi.replace('Wi-Fi ', ''));
      const older = joins.some((m) => m.prefix === 'NOHT') ? ' and older' : '';
      return [
        {
          value: `${top.prefix}:${requireMode}`,
          prefix: top.prefix,
          requireMode,
          label: `${joins.length === 1 ? `${name(top)} only` : joins.map(name).join(' / ')} (Wi-Fi ${wifi.join(', ')}${older})`,
          hint: everyone
            ? 'Every device can join, each at the newest standard it has.'
            : joins.length === 1
              ? `Only ${top.wifi} (802.11${top.name.toLowerCase()}) devices can join.`
              : `Devices older than ${oldest.wifi} (802.11${oldest.name.toLowerCase()}) can’t join.`,
        },
      ];
    });
  });
}

export interface RadioForm {
  radio: string;
  band: string;
  enabled: boolean;
  channel: string;
  modePrefix: string;
  width: string;
  /** The oldest standard a device needs to join (require_mode: n, ac or ax); '' lets every one join. */
  requireMode: string;
  txpower: string;
  /** 5 GHz: automatic channel selection may use DFS channels (OpenWrt's acs_exclude_dfs off). */
  allowDfs: boolean;
  iface: string | undefined;
  ssid: string;
  /** The security mode: OpenWrt's `encryption` up to its first '+'. */
  encryption: string;
  /** A forced cipher, the rest of `encryption` as saved (gcmp, tkip+ccmp); '' is Auto. */
  cipher: string;
  key: string;
  hidden: boolean;
  /** A new random BSSID each time the network starts (macaddr 'random'). */
  randomBssid: boolean;
  /** Beamforming aimed at one device at a time (su_beamformer, he_su_beamformer); OpenWrt's default is on. */
  beamforming: boolean;
  /**
   * MU-MIMO, beamforming to several devices at once (mu_beamformer,
   * he_mu_beamformer); OpenWrt's default is on. Off also turns off
   * mu_beamformee, which the MT7915 driver takes as MU-MIMO allowed too.
   */
  muMimo: boolean;
  /** Spatial reuse: sending while another network is heard only weakly */
  spr: SprSetting;
  /** qos_map_set as set; '' is the image's default */
  qosMap: string;
  /** Target Wake Time: whether the radio offers it, and the limits of what it agrees to */
  twt: TwtSetting;
  /** Wi-Fi 6: how long a device the router scheduled holds back before it sends on its own again (the MU EDCA timers) */
  holdBack: HoldBack;
  /** Airtime fairness: devices with a poor link get a smaller share of the air (the airtime service's policy for the band) */
  airtime: boolean;
  /** The policy's settings for the band, as typed: the rates that part the link classes and each paced class's airtime goal */
  airtimeBands: AirtimeBands;
  /** multicast_to_unicast: mac80211 sends multicast to each device on its own */
  multicastToUnicast: boolean;
  /** Per-band multi-user (MU-MIMO & OFDMA) flags, applied live to the Wi-Fi driver */
  muru: MuruSetting;
}

/** What the Networks & radios page edits of a band; the rest is the Wi-Fi driver page's. */
export const NETWORK_FIELDS = [
  'enabled',
  'channel',
  'modePrefix',
  'width',
  'requireMode',
  'txpower',
  'allowDfs',
  'ssid',
  'encryption',
  'cipher',
  'key',
  'hidden',
  'randomBssid',
  'beamforming',
  'muMimo',
] as const satisfies readonly (keyof RadioForm)[];

export const DRIVER_FIELDS = [
  'spr',
  'qosMap',
  'twt',
  'holdBack',
  'airtime',
  'airtimeBands',
  'multicastToUnicast',
  'muru',
] as const satisfies readonly (keyof RadioForm)[];

export interface RadioOptions {
  channels: Frequency[];
  txpowers: number[];
  htmodes: string[] | undefined;
  /** MHz of the channels that need radar detection. */
  dfs: number[];
  /** How long each of those channels' radar check takes, ms by MHz (the kernel's; 60 s if it doesn't say). */
  cacMs: Record<number, number>;
  /** Spatial reuse on the radio now */
  spr: SpatialReuse | undefined;
  /** The Wi-Fi driver has TWT limits (only a radio's own switch otherwise) */
  twtLimits: boolean;
  /** Multi-user (MU-MIMO / OFDMA) flags on the radio now */
  muru: MuruStatus | undefined;
}

export interface WifiData {
  forms: RadioForm[];
  milkflint: Section[];
  options: Record<string, RadioOptions>;
  /** Every radio section, used or not: the country goes on all of them. */
  radios: string[];
  /** The radios' country when they agree on a real one; '' when it isn't set (or is "00", the world rules). */
  country: string;
  /** What the page fills in while `country` is '' (see radiosCountry). */
  fill: string;
  /** Each radio's own country when they differ (see radiosCountry); empty when they don't. */
  mixed: RadioCountry[];
  countries: Country[];
}

export interface RadioCountry {
  band: string;
  /** '' for none (or "00", the world rules) */
  code: string;
}

/**
 * The country of the radios, which OpenWrt keeps on each radio although
 * the kernel has one for the whole router (the last radio to start sets
 * it). `country` is the one they all have; otherwise '' and the page fills
 * in `fill`: the country the radios that have one agree on (a radio added
 * since, or one LuCI left out), GB when none has one, nothing when they
 * differ (LuCI sets each radio's apart), as any choice could undo one made
 * on purpose. `mixed` lists each radio's country when they differ, for the
 * page to say so.
 */
export function radiosCountry(radios: readonly RadioCountry[]): { country: string; fill: string; mixed: RadioCountry[] } {
  const norm = radios.map((r) => {
    const code = r.code.toUpperCase();
    return { band: r.band, code: code === '00' ? '' : code };
  });
  const codes = [...new Set(norm.map((r) => r.code).filter((c) => c !== ''))];
  const all = codes.length === 1 && norm.every((r) => r.code === codes[0]);
  if (all) return { country: codes[0] ?? '', fill: '', mixed: [] };
  if (codes.length === 0) return { country: '', fill: 'GB', mixed: [] };
  if (codes.length === 1) return { country: '', fill: codes[0] ?? '', mixed: [] };
  // each band and country once (two radios on one band with the same one are one line)
  const seen = new Set<string>();
  const mixed = norm
    .filter((r) => {
      const k = `${r.band} ${r.code}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => bandOrder(a.band) - bandOrder(b.band));
  return { country: '', fill: '', mixed };
}

/** Radios can list channels of every band they support; keep this radio's band. */
export function inBand(mhz: number, band: string): boolean {
  if (band === '2g') return mhz < 3000;
  if (band === '5g') return mhz >= 5000 && mhz < 5925;
  if (band === '6g') return mhz >= 5925 && mhz < 7200;
  return true;
}

/** The country's rule a 20 MHz channel falls in. */
function channelRule(rules: readonly RegRule[], mhz: number): RegRule | undefined {
  return rules.find((r) => mhz - 10 >= r.start && mhz + 10 <= r.end);
}

/** The most a 20 MHz channel may transmit under the country's rules (dBm). */
export function channelLimit(rules: readonly RegRule[], mhz: number): number | undefined {
  return channelRule(rules, mhz)?.eirp;
}

/**
 * How wide a channel in this rule may be. An AUTO-BW rule spans the rules
 * it touches, as the kernel counts it: GB's 5150–5250 and 5250–5350 are
 * 80 MHz each but together allow 160 MHz on 36–64.
 */
function ruleWidth(rules: readonly RegRule[], rule: RegRule): number {
  if (!rule.auto_bw) return rule.max_bw;
  let { start, end } = rule;
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rules) {
      if (r.end === start) {
        start = r.start;
        grew = true;
      }
      if (r.start === end) {
        end = r.end;
        grew = true;
      }
    }
  }
  return end - start;
}

/**
 * Whether the radio may start a network on a channel. By the country's
 * rules once they're loaded: iwinfo's own "restricted" marks some channels
 * the kernel allows (3, 6, 44 and 56 on the Flint 2 in GB).
 */
export function usable(c: Frequency, rules: readonly RegRule[] | undefined): boolean {
  if (rules === undefined) return c.restricted !== true;
  const rule = channelRule(rules, c.mhz);
  return rule !== undefined && !rule.no_ir;
}

/**
 * Whether a channel may be `width` MHz wide in the country: every 20 MHz
 * channel of its block must be one the radio has, in a rule that allows
 * that width. Otherwise the kernel refuses it and the network doesn't start.
 */
export function widthAllowed(
  band: string,
  channel: number,
  width: number,
  all: readonly Frequency[],
  rules: readonly RegRule[],
): boolean {
  return blockOf(band, channel, width).every((ch) => {
    const c = all.find((f) => f.channel === ch);
    const rule = c === undefined ? undefined : channelRule(rules, c.mhz);
    return c !== undefined && rule !== undefined && !rule.no_ir && ruleWidth(rules, rule) >= width;
  });
}

/**
 * Seconds a radar check keeps this radio off when its network (re)starts
 * with these settings: its block's longest check if any of the block needs
 * one (with automatic channel and radar channels allowed, the longest any
 * channel needs), else 0.
 */
export function radarCheckSeconds(f: RadioForm, o: Pick<RadioOptions, 'dfs' | 'cacMs'> | undefined): number {
  if (o === undefined || f.band !== '5g' || !f.enabled || o.dfs.length === 0) return 0;
  const cac = (mhz: number): number => (o.cacMs[mhz] ?? 60_000) / 1000;
  if (f.channel === 'auto') return f.allowDfs ? Math.max(...o.dfs.map(cac)) : 0;
  const width = Number(f.width);
  const block = blockOf(f.band, Number(f.channel), width > 0 ? width : 20);
  const needs = block.map((ch) => 5000 + 5 * ch).filter((mhz) => o.dfs.includes(mhz));
  return needs.length === 0 ? 0 : Math.max(...needs.map(cac));
}

/** "about a minute", "about 10 minutes": how long a radar check keeps 5 GHz off */
export function radarWait(seconds: number): string {
  return seconds <= 60 ? 'about a minute' : `about ${String(Math.ceil(seconds / 60))} minutes`;
}

/** What the save's result says when a radar check follows (0: nothing). */
export function radarNote(seconds: number): string | undefined {
  if (seconds <= 0) return undefined;
  return `The 5 GHz network goes off for ${radarWait(seconds)} while the router listens for radar on its channels; devices on it reconnect after that.`;
}

export function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

/** Bands in the order the pages show them. */
export function bandOrder(band: string): number {
  const i = ['2g', '5g', '6g'].indexOf(band);
  return i === -1 ? 9 : i;
}

type NetworkErrors = Partial<Record<'ssid' | 'key', string>>;
type DriverErrors = Partial<Record<AirtimeBandKey, string>>;

function networkChecks(f: RadioForm): NetworkErrors {
  const errors: NetworkErrors = {};
  const bytes = new TextEncoder().encode(f.ssid).length;
  if (f.iface !== undefined && (bytes < 1 || bytes > 32)) errors.ssid = 'Use 1 to 32 characters.';
  const keyBad = f.iface === undefined ? undefined : keyError(f.encryption, f.key);
  if (keyBad !== undefined) errors.key = keyBad;
  return errors;
}

/** A band's network as the Networks & radios form holds it, with its name's and password's checks. */
const radioNetwork = z
  .custom<RadioForm>((v) => typeof v === 'object' && v !== null && 'radio' in v)
  .superRefine((f, ctx) => {
    for (const [path, message] of Object.entries(networkChecks(f))) ctx.addIssue({ code: 'custom', path: [path], message });
  });

/** Networks & radios' form: the country every radio gets, and each band's network and radio. */
export const wifiFormSchema = z.object({ country: z.string(), radios: z.array(radioNetwork) });

export type WifiForm = z.infer<typeof wifiFormSchema>;

/** A band's network's errors (its name, its password), from the schema. */
export function networkErrors(f: RadioForm): NetworkErrors {
  const found = formErrors(radioNetwork, f);
  const errors: NetworkErrors = {};
  if (found['ssid'] !== undefined) errors.ssid = found['ssid'];
  if (found['key'] !== undefined) errors.key = found['key'];
  return errors;
}

export function validateDriver(f: RadioForm): DriverErrors {
  // the policy's settings only show, and are only saved, with the policy on
  return f.airtime ? airtimeBandsErrors(f.airtimeBands) : {};
}

function pick<K extends keyof RadioForm>(f: RadioForm, keys: readonly K[]): Pick<RadioForm, K> {
  return Object.fromEntries(keys.map((k) => [k, f[k]])) as Pick<RadioForm, K>;
}

/** Whether the band's network or radio settings were changed (Networks & radios' part). */
export function networkChanged(f: RadioForm, before: RadioForm | undefined): boolean {
  return before === undefined || JSON.stringify(pick(f, NETWORK_FIELDS)) !== JSON.stringify(pick(before, NETWORK_FIELDS));
}

/** Whether the band's driver settings were changed (the Wi-Fi driver page's part). */
export function driverChanged(f: RadioForm, before: RadioForm | undefined): boolean {
  return before === undefined || JSON.stringify(pick(f, DRIVER_FIELDS)) !== JSON.stringify(pick(before, DRIVER_FIELDS));
}

/** A change's set and unset parts, from options where undefined means unset. */
function setAndUnset(config: string, section: string, options: Record<string, string | undefined>): Change[] {
  const values = Object.fromEntries(Object.entries(options).filter((e): e is [string, string] => e[1] !== undefined));
  const unset = Object.keys(options).filter((k) => options[k] === undefined);
  const changes: Change[] = [];
  if (Object.keys(values).length > 0) changes.push({ op: 'set', config, section, values });
  if (unset.length > 0) changes.push({ op: 'unset', config, section, options: unset });
  return changes;
}

/**
 * What saving a band's network and radio settings writes: its on/off,
 * channel and mode always (so the network starts as shown), the rest only
 * where it changed, so options set in LuCI stay as they are.
 */
export function networkChanges(f: RadioForm, before: RadioForm): Change[] {
  const changes: Change[] = [];
  changes.push({
    op: 'set',
    config: 'wireless',
    section: f.radio,
    values: {
      disabled: f.enabled ? '0' : '1',
      channel: f.channel,
      htmode: f.modePrefix === 'NOHT' ? 'NOHT' : `${f.modePrefix}${f.width}`,
    },
  });
  if (f.requireMode !== before.requireMode) {
    changes.push(
      f.requireMode === ''
        ? { op: 'unset', config: 'wireless', section: f.radio, options: ['require_mode'] }
        : { op: 'set', config: 'wireless', section: f.radio, values: { require_mode: f.requireMode } },
    );
  }
  if (f.allowDfs !== before.allowDfs) {
    changes.push(
      f.allowDfs
        ? { op: 'unset', config: 'wireless', section: f.radio, options: ['acs_exclude_dfs'] }
        : { op: 'set', config: 'wireless', section: f.radio, values: { acs_exclude_dfs: '1' } },
    );
  }
  if (f.txpower === '') {
    if (before.txpower !== '') changes.push({ op: 'unset', config: 'wireless', section: f.radio, options: ['txpower'] });
  } else {
    changes.push({ op: 'set', config: 'wireless', section: f.radio, values: { txpower: f.txpower } });
  }
  // only when switched: on is OpenWrt's default, so it's left unset
  if (f.beamforming !== before.beamforming) {
    changes.push(
      f.beamforming
        ? { op: 'unset', config: 'wireless', section: f.radio, options: ['su_beamformer', 'he_su_beamformer'] }
        : { op: 'set', config: 'wireless', section: f.radio, values: { su_beamformer: '0', he_su_beamformer: '0' } },
    );
  }
  if (f.muMimo !== before.muMimo) {
    changes.push(
      f.muMimo
        ? { op: 'unset', config: 'wireless', section: f.radio, options: ['mu_beamformer', 'he_mu_beamformer', 'mu_beamformee'] }
        : {
            op: 'set',
            config: 'wireless',
            section: f.radio,
            values: { mu_beamformer: '0', he_mu_beamformer: '0', mu_beamformee: '0' },
          },
    );
  }
  if (f.iface !== undefined) {
    changes.push({
      op: 'set',
      config: 'wireless',
      section: f.iface,
      values: {
        disabled: f.enabled ? '0' : '1',
        ssid: f.ssid,
        encryption: f.cipher === '' ? f.encryption : `${f.encryption}+${f.cipher}`,
        hidden: f.hidden ? '1' : '0',
        ...(f.encryption === 'none' ? {} : { key: f.key }),
      },
    });
    if (f.encryption === 'none' && before.key !== '') {
      changes.push({ op: 'unset', config: 'wireless', section: f.iface, options: ['key'] });
    }
    // only when switched: a fixed address set elsewhere stays as it is
    if (f.randomBssid !== before.randomBssid) {
      changes.push(
        f.randomBssid
          ? { op: 'set', config: 'wireless', section: f.iface, values: { macaddr: 'random' } }
          : { op: 'unset', config: 'wireless', section: f.iface, options: ['macaddr'] },
      );
    }
  }
  return changes;
}

/**
 * What saving a band's driver settings writes to the wireless config (the
 * milkflint.wifi part is driverSection's): only what changed, so periods,
 * thresholds and maps set elsewhere stay as they are.
 */
export function driverChanges(f: RadioForm, before: RadioForm): Change[] {
  const changes: Change[] = [];
  if (JSON.stringify(sprRadioOptions(f.spr)) !== JSON.stringify(sprRadioOptions(before.spr))) {
    changes.push(...setAndUnset('wireless', f.radio, sprRadioOptions(f.spr)));
  }
  // only when chosen: periods set elsewhere stay as they are
  const holdBack = f.holdBack === before.holdBack ? undefined : holdBackValues(f.holdBack);
  if (holdBack !== undefined) changes.push(...setAndUnset('wireless', f.radio, holdBack));
  if (twtRestarts(f.twt, before.twt)) {
    changes.push(
      twtRadioOptions(f.twt).he_twt_responder === undefined
        ? { op: 'unset', config: 'wireless', section: f.radio, options: ['he_twt_responder'] }
        : { op: 'set', config: 'wireless', section: f.radio, values: { he_twt_responder: '0' } },
    );
  }
  if (f.iface !== undefined) {
    if (f.multicastToUnicast !== before.multicastToUnicast) {
      changes.push(
        f.multicastToUnicast
          ? { op: 'set', config: 'wireless', section: f.iface, values: { multicast_to_unicast: '1' } }
          : { op: 'unset', config: 'wireless', section: f.iface, options: ['multicast_to_unicast'] },
      );
    }
    if (f.qosMap !== before.qosMap) {
      changes.push(
        f.qosMap === ''
          ? { op: 'unset', config: 'wireless', section: f.iface, options: ['qos_map_set'] }
          : { op: 'set', config: 'wireless', section: f.iface, values: { qos_map_set: f.qosMap } },
      );
    }
  }
  return changes;
}

/**
 * milkflint.wifi's options for every band (undefined: unset): the driver's
 * spatial reuse mode, TWT limits and the airtime policy, which the router's
 * services read for themselves, without restarting Wi-Fi.
 */
export function driverSection(forms: readonly RadioForm[]): Record<string, string | undefined> {
  return Object.fromEntries(
    forms.flatMap((f) => [
      [sprOption(f.band), sprDriverMode(f.spr)],
      ...Object.entries(twtDriverOptions(f.band, f.twt)),
      ...Object.entries(muruDriverOptions(f.band, f.muru)),
      [airtimeOption(f.band), airtimeValue(f.airtime)],
      // off, the band's settings are left as they are
      ...(f.airtime ? Object.entries(airtimeBandValues(f.band, f.airtimeBands)) : []),
    ]),
  );
}

/**
 * What a save does to the devices on a band: it turns the band off, its
 * devices have to join again (a new name or password, or new security), or
 * its radio restarts and they reconnect by themselves. radarS: how long a
 * radar check then keeps it off.
 */
export interface Impact {
  band: string;
  kind: 'off' | 'rejoin' | 'restart';
  /** For 'rejoin': what changed that devices must know */
  changed: ('name' | 'password' | 'security')[];
  radarS: number;
}

/**
 * The bands a Networks & radios save drops devices from. Every change to a
 * band's settings restarts its radio, and a new country restarts every band;
 * a band that was off has no devices to drop.
 */
export function networkImpacts(
  forms: readonly RadioForm[],
  saved: readonly RadioForm[],
  countryChanged: boolean,
  options: Readonly<Record<string, Pick<RadioOptions, 'dfs' | 'cacMs'>>>,
): Impact[] {
  return forms.flatMap((f, i): Impact[] => {
    const before = saved[i];
    if (before?.enabled !== true) return [];
    if (!f.enabled) return [{ band: f.band, kind: 'off', changed: [], radarS: 0 }];
    const changed: Impact['changed'] = [];
    if (f.iface !== undefined) {
      if (f.ssid !== before.ssid) changed.push('name');
      if (f.encryption !== 'none' && f.key !== before.key) changed.push('password');
      if (f.encryption !== before.encryption || f.cipher !== before.cipher) changed.push('security');
    }
    if (!countryChanged && !networkChanged(f, before)) return [];
    const radarS = radarCheckSeconds(f, options[f.radio]);
    return [{ band: f.band, kind: changed.length > 0 ? 'rejoin' : 'restart', changed, radarS }];
  });
}

/** The bands a Wi-Fi driver save restarts: those whose wireless config it changes. */
export function driverImpacts(
  forms: readonly RadioForm[],
  saved: readonly RadioForm[],
  options: Readonly<Record<string, Pick<RadioOptions, 'dfs' | 'cacMs'>>>,
): Impact[] {
  return forms.flatMap((f, i): Impact[] => {
    const before = saved[i];
    if (before?.enabled !== true || driverChanges(f, before).length === 0) return [];
    return [{ band: f.band, kind: 'restart', changed: [], radarS: radarCheckSeconds(f, options[f.radio]) }];
  });
}

function list(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${String(items.at(-1))}`;
}

/**
 * The warning beside Save, a line per kind of effect: which band's devices
 * lose Wi-Fi, must join again or reconnect, with the viewer's own device
 * among them if it's on that band (the page can't tell which band, if any,
 * the browser is on). `allOff`: every band is off after the save.
 */
export function impactLines(impacts: readonly Impact[], allOff = false): string[] {
  const groups = new Map<string, Impact[]>();
  for (const im of impacts) {
    const key = `${im.kind}:${im.changed.join('+')}`;
    groups.set(key, [...(groups.get(key) ?? []), im]);
  }
  const lines: string[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    if (first === undefined) continue;
    const bands = list(group.map((g) => bandLabel(g.band)));
    const one = group.length === 1;
    const thisOne = one ? 'this one too if it’s connected there' : 'this one too if it’s connected to one of them';
    // only the bands on radar channels wait for a radar check
    const waiting = group.filter((g) => g.radarS > 0);
    const radar =
      waiting.length === 0
        ? ''
        : ` ${list(waiting.map((g) => bandLabel(g.band)))} then ${waiting.length === 1 ? 'stays' : 'stay'} off for ${radarWait(Math.max(...waiting.map((g) => g.radarS)))} while the router listens for radar.`;
    switch (first.kind) {
      case 'off':
        lines.push(
          allOff
            ? 'Wi-Fi turns off on every band: devices on it lose their connection, this one too if it’s on Wi-Fi. A cable still reaches the router.'
            : `${bands} ${one ? 'turns' : 'turn'} off: ${one ? 'its' : 'their'} devices lose Wi-Fi, ${thisOne}.`,
        );
        break;
      case 'rejoin': {
        const what = first.changed.filter((c) => c !== 'security');
        lines.push(
          what.length > 0
            ? `Devices on ${bands} disconnect and must join again with the new ${what.join(' and ')}, ${thisOne}.${radar}`
            : `Devices on ${bands} disconnect and reconnect with the new security, ${thisOne}; some may have to join again.${radar}`,
        );
        break;
      }
      case 'restart':
        lines.push(
          `Saving restarts ${bands}: devices on ${one ? 'it' : 'them'} drop and reconnect by themselves, ${thisOne}.${radar}`,
        );
        break;
    }
  }
  return lines;
}
