import { EyeIcon, EyeOffIcon, TriangleAlertIcon, WifiIcon, WifiOffIcon } from 'lucide-react';
import { type ReactElement, useCallback, useMemo, useState } from 'react';
import { ApplyStatus } from '@/components/apply-status';
import { Field } from '@/components/field';
import { PageHeader } from '@/components/layout/page-header';
import { FormSkeleton, LoadError } from '@/components/page-states';
import { SaveBar } from '@/components/save-bar';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { ROLLBACK_SECONDS, useApply } from '@/hooks/use-apply';
import { useLoad } from '@/hooks/use-load';
import { usePoll } from '@/hooks/use-poll';
import { bool, type Change, getConfig, str } from '@/lib/api/uci';
import { isGuestIface } from '../wifi-guest/guest';
import { BeamformingCard } from './beamforming';
import { blockOf, describeBlock } from './channels';
import { CountryField } from './country';
import { WifiLive } from './live';
import { RadarCard } from './radar';
import { securityOptions } from './security';
import {
  type Country,
  type Frequency,
  getCountries,
  getDfsFrequencies,
  getFrequencies,
  getRadar,
  getRegulatedCountries,
  getRegulatory,
  getTxPowers,
  getWirelessStatus,
  type RegRule,
} from '@/lib/api/wireless';

const noFaster = 'It’s no faster: the router’s Wi-Fi chip encrypts with every one of these ciphers in hardware.';

// LuCI's "Cipher": the part of OpenWrt's `encryption` after its first '+'
// (sae-mixed+gcmp). Auto leaves it off, which is CCMP for every mode above.
// The MT7986 takes all four AES ciphers into hardware (mt7915_set_key), so
// none costs the router CPU or mac80211's 802.3 offload. A forced cipher is
// the group cipher too (broadcasts and multicasts, to every device). WPA
// (v1) has no GCMP or 256-bit ciphers; TKIP is only offered where WPA is.
const cipherOptions = [
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
const cipherAliases: Record<string, string> = { aes: 'ccmp', 'tkip+aes': 'tkip+ccmp', 'aes+tkip': 'tkip+ccmp', 'ccmp+tkip': 'tkip+ccmp' };

function cipherOption(cipher: string): (typeof cipherOptions)[number] | undefined {
  const value = cipherAliases[cipher] ?? cipher;
  return cipherOptions.find((c) => c.value === value);
}

/** Whether a security mode can have a saved cipher, under any of its spellings. */
function cipherFits(cipher: string, security: string): boolean {
  return (cipherOption(cipher)?.modes as readonly string[] | undefined)?.includes(security) === true;
}

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

const bandWidths: Record<string, string[]> = { '2g': ['20', '40'], '5g': ['20', '40', '80', '160'], '6g': ['20', '40', '80', '160', '320'] };

/** Modes this radio can use on its band, each with its widths, from what the radio reports (htmodes). */
function modesFor(band: string, htmodes: readonly string[] | undefined): { prefix: string; widths: string[] }[] {
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

interface Standards {
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
function standardsFor(band: string, available: readonly { prefix: string }[]): Standards[] {
  const legacy = band === '2g' ? 'G' : 'A';
  const list = available.flatMap((a) => modes.filter((m) => m.prefix === a.prefix));
  const name = (m: (typeof list)[number]): string => (m.prefix === 'NOHT' ? legacy : m.name);
  return list.flatMap((top, i): Standards[] => {
    if (top.prefix === 'NOHT')
      return [{ value: 'NOHT:', prefix: 'NOHT', requireMode: '', label: `${legacy} only (legacy)`, hint: 'Slow: only for devices from before 2009.' }];
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

interface RadioForm {
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
}

interface RadioOptions {
  channels: Frequency[];
  txpowers: number[];
  htmodes: string[] | undefined;
  /** MHz of the channels that need radar detection. */
  dfs: number[];
  /** How long each of those channels' radar check takes, ms by MHz (the kernel's; 60 s if it doesn't say). */
  cacMs: Record<number, number>;
}

interface WifiData {
  forms: RadioForm[];
  options: Record<string, RadioOptions>;
  /** Every radio section, used or not: the country goes on all of them. */
  radios: string[];
  /** The radios' country when they agree on a real one; '' when it isn't set (or is "00", the world rules). */
  country: string;
  countries: Country[];
}

/** If the radio can't list them: the likeliest ones. */
const fallbackCountries: Country[] = [
  { code: 'GB', name: 'United Kingdom' },
  { code: 'IE', name: 'Ireland' },
  { code: 'US', name: 'United States' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'AU', name: 'Australia' },
  { code: 'CA', name: 'Canada' },
];

/** Radios can list channels of every band they support; keep this radio's band. */
function inBand(mhz: number, band: string): boolean {
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
function channelLimit(rules: readonly RegRule[], mhz: number): number | undefined {
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
  for (let grew = true; grew; ) {
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
function usable(c: Frequency, rules: readonly RegRule[] | undefined): boolean {
  if (rules === undefined) return c.restricted !== true;
  const rule = channelRule(rules, c.mhz);
  return rule !== undefined && !rule.no_ir;
}

/**
 * Whether a channel may be `width` MHz wide in the country: every 20 MHz
 * channel of its block must be one the radio has, in a rule that allows
 * that width. Otherwise the kernel refuses it and the network doesn't start.
 */
function widthAllowed(band: string, channel: number, width: number, all: readonly Frequency[], rules: readonly RegRule[]): boolean {
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
function radarCheckSeconds(f: RadioForm, o: RadioOptions | undefined): number {
  if (o === undefined || f.band !== '5g' || !f.enabled || o.dfs.length === 0) return 0;
  const cac = (mhz: number): number => (o.cacMs[mhz] ?? 60_000) / 1000;
  if (f.channel === 'auto') return f.allowDfs ? Math.max(...o.dfs.map(cac)) : 0;
  const width = Number(f.width);
  const block = blockOf(f.band, Number(f.channel), width > 0 ? width : 20);
  const needs = block.map((ch) => 5000 + 5 * ch).filter((mhz) => o.dfs.includes(mhz));
  return needs.length === 0 ? 0 : Math.max(...needs.map(cac));
}

function bandLabel(band: string): string {
  return band === '2g' ? '2.4 GHz' : band === '5g' ? '5 GHz' : band === '6g' ? '6 GHz' : band;
}

async function loadWifi(): Promise<WifiData> {
  const [sections, status] = await Promise.all([getConfig('wireless'), getWirelessStatus()]);
  const radios = sections.filter((s) => s['.type'] === 'wifi-device');
  // the guest network's access points have a page of their own (Guest Wi-Fi)
  const ifaces = sections.filter((s) => s['.type'] === 'wifi-iface' && !isGuestIface(s));

  // Radios that are off and have no access point (unused, or lent to
  // something else) aren't Wi-Fi networks to manage here.
  const used = radios.filter(
    (r) => !bool(r, 'disabled') || ifaces.some((i) => str(i, 'device') === r['.name'] && (str(i, 'mode') ?? 'ap') === 'ap'),
  );
  const forms = used.map((r): RadioForm => {
    const name = r['.name'];
    const iface = ifaces.find((i) => str(i, 'device') === name && (str(i, 'mode') ?? 'ap') === 'ap');
    const htmode = str(r, 'htmode') ?? 'HE20';
    const m = /^(NOHT|[A-Z]+?)(\d*)$/.exec(htmode);
    const [security = 'none', ...cipher] = (str(iface, 'encryption') ?? 'none').split('+');
    return {
      radio: name,
      band: str(r, 'band') ?? '2g',
      // OpenWrt 25.12 ships the radio on and its access point off, so
      // either one being disabled means nothing is broadcasting
      enabled: !bool(r, 'disabled') && !bool(iface, 'disabled'),
      channel: str(r, 'channel') ?? 'auto',
      modePrefix: m?.[1] ?? 'HE',
      width: m?.[2] ?? '',
      requireMode: str(r, 'require_mode') ?? '',
      txpower: str(r, 'txpower') ?? '',
      allowDfs: !bool(r, 'acs_exclude_dfs'),
      iface: iface?.['.name'],
      ssid: str(iface, 'ssid') ?? '',
      encryption: security,
      cipher: cipher.join('+'),
      key: str(iface, 'key') ?? '',
      hidden: bool(iface, 'hidden'),
      randomBssid: str(iface, 'macaddr') === 'random',
      beamforming: str(r, 'su_beamformer') !== '0' && str(r, 'he_su_beamformer') !== '0',
      muMimo: str(r, 'mu_beamformer') !== '0' && str(r, 'he_mu_beamformer') !== '0',
    };
  });

  const options: Record<string, RadioOptions> = {};
  await Promise.all(
    forms.map(async (f) => {
      const htmodes = status[f.radio]?.iwinfo?.htmodes;
      // a Wi-Fi interface, or the radio's phy while its network is off (a fresh install)
      const device = status[f.radio]?.interfaces?.find((i) => i.ifname !== undefined)?.ifname ?? status[f.radio]?.iwinfo?.phy;
      if (device === undefined) {
        options[f.radio] = { channels: [], txpowers: [], htmodes, dfs: [], cacMs: {} };
        return;
      }
      const [channels, txpowers, dfs, radar] = await Promise.all([
        getFrequencies(device).catch(() => []),
        getTxPowers(device).catch(() => []),
        getDfsFrequencies(device).catch((): number[] => []),
        f.band === '5g' ? getRadar(device).catch(() => undefined) : undefined,
      ]);
      options[f.radio] = {
        // all of them: which may be used goes by the country's rules (see usable)
        channels: channels.filter((c) => inBand(c.mhz, f.band)),
        txpowers: txpowers.map((t) => t.dbm),
        htmodes,
        dfs,
        cacMs: Object.fromEntries((radar?.channels ?? []).flatMap((c) => (c.cac_ms === undefined ? [] : [[c.mhz, c.cac_ms]]))),
      };
    }),
  );
  // countries: ask any radio, by an interface or by its phy (no interface while Wi-Fi is off)
  const device =
    Object.values(status).flatMap((r) => r.interfaces ?? []).find((i) => i.ifname !== undefined)?.ifname ??
    Object.values(status).find((r) => r.iwinfo?.phy !== undefined)?.iwinfo?.phy ??
    'phy0';
  const [named, regulated] = await Promise.all([
    getCountries(device).catch((): Country[] => []),
    getRegulatedCountries().catch((): string[] => []),
  ]);
  // only countries with rules: the radio ignores any other (and keeps the rules it had)
  const countries = regulated.length === 0 ? named : named.filter((c) => regulated.includes(c.code));
  const codes = new Set(radios.map((r) => (str(r, 'country') ?? '').toUpperCase()));
  const only = codes.size === 1 ? [...codes][0] : undefined;
  return {
    forms,
    options,
    radios: radios.map((r) => r['.name']),
    country: only === undefined || only === '00' ? '' : only,
    countries: countries.length > 0 ? countries : fallbackCountries,
  };
}

function validate(f: RadioForm): Partial<Record<'ssid' | 'key', string>> {
  const errors: Partial<Record<'ssid' | 'key', string>> = {};
  const bytes = new TextEncoder().encode(f.ssid).length;
  if (f.iface !== undefined && (bytes < 1 || bytes > 32)) errors.ssid = 'Use 1 to 32 characters.';
  if (f.iface !== undefined && f.encryption !== 'none') {
    const ok = (f.key.length >= 8 && f.key.length <= 63) || /^[0-9a-fA-F]{64}$/.test(f.key);
    if (!ok) errors.key = 'Use 8 to 63 characters.';
  }
  return errors;
}

function changesFor(f: RadioForm, before: RadioForm): Change[] {
  const changes: Change[] = [];
  changes.push({
    op: 'set',
    config: 'wireless',
    section: f.radio,
    values: { disabled: f.enabled ? '0' : '1', channel: f.channel, htmode: f.modePrefix === 'NOHT' ? 'NOHT' : `${f.modePrefix}${f.width}` },
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
        : { op: 'set', config: 'wireless', section: f.radio, values: { mu_beamformer: '0', he_mu_beamformer: '0', mu_beamformee: '0' } },
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

function RadioCard({
  form,
  options,
  rules,
  onChange,
}: {
  form: RadioForm;
  options: RadioOptions | undefined;
  /** The country's rules, for each channel's power limit. */
  rules: readonly RegRule[] | undefined;
  onChange: <K extends keyof RadioForm>(key: K, value: RadioForm[K]) => void;
}): ReactElement {
  const [showKey, setShowKey] = useState(false);
  const errors = validate(form);
  const id = (field: string): string => `${form.radio}-${field}`;
  const set = onChange;
  const dfs = new Set(options?.dfs ?? []);
  const channels = (options?.channels ?? []).filter((c) => usable(c, rules) && (form.allowDfs || !dfs.has(c.mhz)));
  const hasCurrent = form.channel === 'auto' || channels.some((c) => String(c.channel) === form.channel);
  const available = modesFor(form.band, options?.htmodes);
  const standards = standardsFor(form.band, available);
  const standard = standards.find((s) => s.value === `${form.modePrefix}:${form.requireMode}`);
  // Widths the chosen channel may have in the country (on Auto: any channel
  // it may pick); the radio itself offers every width it can do.
  const widthsOn = (channel: string, widths: readonly string[]): string[] => {
    const all = options?.channels ?? [];
    if (rules === undefined || all.length === 0) return [...widths];
    const candidates = channel === 'auto' ? channels : all.filter((c) => String(c.channel) === channel);
    return widths.filter((w) => candidates.some((c) => widthAllowed(form.band, c.channel, Number(w), all, rules)));
  };
  // the 20 MHz channels the chosen channel and width take up (unknown on Auto)
  const width = form.modePrefix === 'NOHT' || form.width === '' ? 20 : Number(form.width);
  const block = form.channel === 'auto' ? undefined : blockOf(form.band, Number(form.channel), width);
  // 5 and 6 GHz blocks are fixed; 2.4 GHz pairs with the channel 4 above (1–6) or below (7–13)
  const fixedBlocks = form.band !== '2g';
  const widestOn = (channel: string, prefix: string): string =>
    widthsOn(channel, available.find((m) => m.prefix === prefix)?.widths ?? []).at(-1) ?? '';
  const modeWidths = widthsOn(form.channel, available.find((m) => m.prefix === form.modePrefix)?.widths ?? []);
  // The radio lists powers up to what the channel it's on now allows, which
  // needn't be the one chosen here; go by the chosen channel's rule (on Auto,
  // the most any channel it may pick allows: the radio holds to the one it picks).
  const limitFor = (channel: string): number | undefined => {
    if (rules === undefined) return undefined;
    const limits = channels
      .filter((c) => channel === 'auto' || String(c.channel) === channel)
      .flatMap((c) => channelLimit(rules, c.mhz) ?? []);
    return limits.length === 0 ? undefined : Math.max(...limits);
  };
  const limit = limitFor(form.channel);
  const powers = Array.from({ length: limit ?? Math.max(0, ...(options?.txpowers ?? [])) }, (_, i) => i + 1);
  const savedPower = form.txpower === '' ? undefined : Number(form.txpower);
  // none for Open or a mode set elsewhere: a cipher saved with one stays as it is
  const ciphers = cipherOptions.filter((c) => (c.modes as readonly string[]).includes(form.encryption));
  const cipher = form.cipher === '' ? undefined : cipherOption(form.cipher);
  const cipherHint =
    form.cipher === ''
      ? form.encryption === 'psk-mixed'
        ? 'OpenWrt’s choice: CCMP (AES), for WPA too. WPA-only devices with just TKIP can’t join on it.'
        : 'OpenWrt’s choice: CCMP (AES), which every WPA2 and WPA3 device has.'
      : cipher === undefined
        ? 'Set outside this page.'
        : cipher.value === 'ccmp'
          ? 'The same as Auto in this mode.'
          : undefined;
  const cipherWarning =
    cipher?.warning === undefined
      ? undefined
      : [
          cipher.warning,
          form.encryption === 'sae-mixed' ? 'WPA2/WPA3 mode is there for WPA2 devices, and most of them have only CCMP.' : '',
          cipher.value === 'tkip+ccmp' ? '' : noFaster,
        ]
          .filter((s) => s !== '')
          .join(' ');

  return (
    <Card>
      <CardHeader className="items-center">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {form.enabled ? <WifiIcon className="size-4" /> : <WifiOffIcon className="size-4" />}
        </div>
        <div className="flex flex-col gap-1">
          <CardTitle className="text-base">{bandLabel(form.band)}</CardTitle>
          <CardDescription>{form.enabled ? (form.ssid !== '' ? form.ssid : 'No network name') : 'Turned off'}</CardDescription>
        </div>
        <CardAction>
          <Switch
            checked={form.enabled}
            onCheckedChange={(v) => {
              set('enabled', v);
            }}
            aria-label={`${bandLabel(form.band)} radio on`}
          />
        </CardAction>
      </CardHeader>
      <CardContent>
        <Separator />
        {form.iface === undefined ? (
          <p className="pt-4 text-sm text-muted-foreground">This radio has no access point. Set one up in Advanced (LuCI).</p>
        ) : (
          <div className="divide-y">
            <Field id={id('ssid')} label="Network name" error={errors.ssid}>
              <Input
                id={id('ssid')}
                value={form.ssid}
                maxLength={32}
                aria-invalid={errors.ssid !== undefined}
                onChange={(e) => {
                  set('ssid', e.target.value);
                }}
              />
            </Field>
            <Field
              id={id('security')}
              label="Security (encryption)"
              hint={securityOptions.find((o) => o.value === form.encryption)?.hint}
            >
              <Select
                value={form.encryption}
                onValueChange={(v) => {
                  set('encryption', v);
                  // a cipher the new mode can't have would keep the network from starting
                  if (form.cipher !== '' && !cipherFits(form.cipher, v)) set('cipher', '');
                }}
              >
                <SelectTrigger id={id('security')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {securityOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                  {!securityOptions.some((o) => o.value === form.encryption) && (
                    <SelectItem value={form.encryption}>
                      {form.encryption}
                      {form.cipher === '' ? '' : `+${form.cipher}`} (set elsewhere)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            {ciphers.length > 0 && (
              <Field id={id('cipher')} label="Cipher" hint={cipherHint}>
                <Select
                  value={form.cipher === '' ? 'auto' : form.cipher}
                  onValueChange={(v) => {
                    set('cipher', v === 'auto' ? '' : v);
                  }}
                >
                  <SelectTrigger id={id('cipher')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (CCMP)</SelectItem>
                    {ciphers.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                    {form.cipher !== '' && !ciphers.some((c) => c.value === form.cipher) && (
                      <SelectItem value={form.cipher}>{cipher?.label ?? form.cipher} (set elsewhere)</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {cipherWarning !== undefined && (
                  <Alert variant="warning">
                    <TriangleAlertIcon />
                    <AlertDescription>{cipherWarning}</AlertDescription>
                  </Alert>
                )}
              </Field>
            )}
            {form.encryption !== 'none' && (
              <Field id={id('key')} label="Password" error={errors.key}>
                <div className="relative">
                  <Input
                    id={id('key')}
                    type={showKey ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.key}
                    className="pr-10 font-mono"
                    aria-invalid={errors.key !== undefined}
                    onChange={(e) => {
                      set('key', e.target.value);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setShowKey((v) => !v);
                    }}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    aria-label={showKey ? 'Hide password' : 'Show password'}
                  >
                    {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
              </Field>
            )}
            <Field id={id('hidden')} label="Hide network" hint="Devices must type the name to join.">
              <Switch
                id={id('hidden')}
                checked={form.hidden}
                onCheckedChange={(v) => {
                  set('hidden', v);
                }}
              />
            </Field>
            <Field
              id={id('random-bssid')}
              label="Randomized BSSID"
              hint="A new random hardware address each time Wi-Fi starts, so it can’t be used to recognise this router. Devices still find the network by name."
            >
              <Switch
                id={id('random-bssid')}
                checked={form.randomBssid}
                onCheckedChange={(v) => {
                  set('randomBssid', v);
                }}
              />
            </Field>
          </div>
        )}

        <div className="mt-2 rounded-lg bg-muted/40 px-4">
          <div className="flex flex-wrap items-center gap-2 pt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Radio
            <Badge variant="outline" className="font-mono normal-case">
              {form.modePrefix === 'NOHT' ? 'NOHT' : `${form.modePrefix}${form.width}`}
            </Badge>
            <span className="font-normal tracking-normal normal-case">
              {block === undefined
                ? 'Channels picked at start-up'
                : `${block.length === 1 ? 'Channel' : 'Channels'} ${describeBlock(form.band, block)}`}
            </span>
          </div>
          <div className="divide-y">
            <Field id={id('mode')} label="Wi-Fi mode" hint={standard?.hint ?? 'Set outside this page.'}>
              <Select
                value={`${form.modePrefix}:${form.requireMode}`}
                onValueChange={(v) => {
                  const [prefix = '', requireMode = ''] = v.split(':');
                  set('modePrefix', prefix);
                  set('requireMode', requireMode);
                  // keep the width if the new mode has it on this channel, otherwise the widest it has
                  const widths = widthsOn(form.channel, available.find((m) => m.prefix === prefix)?.widths ?? []);
                  if (!widths.includes(form.width)) set('width', widths.at(-1) ?? '');
                }}
              >
                <SelectTrigger id={id('mode')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {standards.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                  {standard === undefined && (
                    <SelectItem value={`${form.modePrefix}:${form.requireMode}`}>
                      {form.modePrefix}
                      {form.requireMode === '' ? '' : `, require_mode ${form.requireMode}`} (set elsewhere)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            {form.modePrefix !== 'NOHT' && (
              <Field
                id={id('width')}
                label="Channel width"
                hint={
                  modeWidths.includes(form.width)
                    ? 'Wider is faster, narrower reaches further and meets less interference.'
                    : `${form.channel === 'auto' ? 'No channel' : `Channel ${form.channel}`} can’t be ${form.width} MHz wide in this country, so the network won’t start. Choose a narrower width or another channel.`
                }
              >
                <Select
                  value={form.width}
                  onValueChange={(v) => {
                    set('width', v);
                  }}
                >
                  <SelectTrigger id={id('width')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {modeWidths.map((w) => (
                      <SelectItem key={w} value={w}>
                        {w} MHz
                      </SelectItem>
                    ))}
                    {!modeWidths.includes(form.width) && <SelectItem value={form.width}>{form.width} MHz (not allowed)</SelectItem>}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field
              id={id('channel')}
              label="Channel"
              hint={
                block === undefined
                  ? 'Auto picks the quietest one at start-up.'
                  : block.length === 1
                    ? undefined
                    : `At ${String(width)} MHz this takes up channels ${describeBlock(form.band, block)}${fixedBlocks ? ', whichever of them you pick' : ''}. Channel ${form.channel} is the primary: the network announces itself there, and devices that can’t use the whole width use the part it’s in.`
              }
            >
              <Select
                value={form.channel}
                onValueChange={(v) => {
                  set('channel', v);
                  // a width the new channel can't have would stop the network starting
                  if (form.modePrefix !== 'NOHT' && !widthsOn(v, [form.width]).includes(form.width)) set('width', widestOn(v, form.modePrefix));
                  // a power above the new channel's limit would only be cut back to it
                  const next = limitFor(v);
                  if (savedPower !== undefined && next !== undefined && savedPower > next) set('txpower', '');
                }}
              >
                <SelectTrigger id={id('channel')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  {channels.map((c) => (
                    <SelectItem key={c.mhz} value={String(c.channel)}>
                      {c.channel} ({(c.mhz / 1000).toFixed(3)} GHz){dfs.has(c.mhz) ? ' · DFS' : ''}
                    </SelectItem>
                  ))}
                  {!hasCurrent && <SelectItem value={form.channel}>{form.channel}</SelectItem>}
                </SelectContent>
              </Select>
            </Field>
            {form.band === '5g' && (options?.dfs.length ?? 0) > 0 && (
              <Field
                id={id('dfs')}
                label="Allow DFS channels"
                hint="More channels, often quieter. On one, the router first listens for radar for a minute or more, and moves away if radar appears."
              >
                <Switch
                  id={id('dfs')}
                  checked={form.allowDfs}
                  onCheckedChange={(v) => {
                    set('allowDfs', v);
                    // a DFS channel picked by hand can't stay when they're not allowed
                    const current = (options?.channels ?? []).find((c) => String(c.channel) === form.channel);
                    if (!v && current !== undefined && dfs.has(current.mhz)) set('channel', 'auto');
                  }}
                />
              </Field>
            )}
            <Field
              id={id('txpower')}
              label="Transmit power"
              hint={
                limit === undefined
                  ? undefined
                  : form.channel === 'auto'
                    ? `Up to ${String(limit)} dBm, depending on the channel Auto picks.`
                    : `Up to ${String(limit)} dBm on channel ${form.channel}.`
              }
            >
              <Select
                value={form.txpower === '' ? 'max' : form.txpower}
                onValueChange={(v) => {
                  set('txpower', v === 'max' ? '' : v);
                }}
              >
                <SelectTrigger id={id('txpower')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="max">Maximum allowed</SelectItem>
                  {powers.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} dBm ({Math.round(10 ** (d / 10))} mW)
                    </SelectItem>
                  ))}
                  {savedPower !== undefined && !powers.includes(savedPower) && (
                    <SelectItem value={form.txpower}>
                      {form.txpower} dBm{limit !== undefined && savedPower > limit ? ` (over the limit: ${String(limit)} dBm is used)` : ''}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </Field>
            {['VHT', 'HE', 'EHT'].includes(form.modePrefix) && (
              <>
                <Field
                  id={id('beamforming')}
                  label="Beamforming"
                  hint="Aims the signal at each device instead of spreading it evenly, for more speed and range. Devices need Wi-Fi 5 or newer to use it."
                >
                  <Switch
                    id={id('beamforming')}
                    checked={form.beamforming}
                    onCheckedChange={(v) => {
                      set('beamforming', v);
                      // MU-MIMO is beamforming to several devices: it can't stay on without it
                      if (!v) set('muMimo', false);
                    }}
                  />
                </Field>
                <Field
                  id={id('mumimo')}
                  label="MU-MIMO"
                  hint={
                    form.beamforming
                      ? 'Beamforming to several devices at once. Some Wi-Fi cards handle it badly: turn it off if one keeps dropping out.'
                      : 'Needs beamforming.'
                  }
                >
                  <Switch
                    id={id('mumimo')}
                    checked={form.muMimo}
                    disabled={!form.beamforming}
                    onCheckedChange={(v) => {
                      set('muMimo', v);
                    }}
                  />
                </Field>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function WifiPage(): ReactElement {
  const { data, error, loading, reload } = useLoad(loadWifi);
  const [edits, setEdits] = useState<Record<string, RadioForm>>({});
  // not set yet: GB is filled in, so saving sets it (Discard leaves it unset)
  const [countryEdit, setCountryEdit] = useState<string>();
  const onApplied = useCallback(() => {
    setEdits({});
    setCountryEdit(undefined);
    reload();
  }, [reload]);
  const { state, apply } = useApply(onApplied);

  const forms = useMemo(() => (data?.forms ?? []).map((f) => edits[f.radio] ?? f), [data, edits]);
  const country = countryEdit ?? (data === undefined ? '' : data.country === '' ? 'GB' : data.country);
  const countryDirty = data !== undefined && country !== data.country;
  const rules = usePoll(() => getRegulatory(country), 3_600_000, country).data?.rules;
  const dirty = countryDirty || forms.some((f, i) => JSON.stringify(f) !== JSON.stringify(data?.forms[i]));
  const invalid = forms.some((f) => Object.keys(validate(f)).length > 0);

  const save = (): void => {
    if (data === undefined) return;
    const changes = forms.flatMap((f, i) => {
      const before = data.forms[i];
      return before === undefined || JSON.stringify(f) === JSON.stringify(before) ? [] : changesFor(f, before);
    });
    if (countryDirty && country !== '') {
      for (const radio of data.radios) changes.push({ op: 'set', config: 'wireless', section: radio, values: { country } });
    }
    // A radio that restarts on radar channels stays off for its radar check:
    // a browser on it can't confirm until it's back, so wait that much longer.
    const radarS = Math.max(
      0,
      ...forms.map((f, i) => (countryDirty || JSON.stringify(f) !== JSON.stringify(data.forms[i]) ? radarCheckSeconds(f, data.options[f.radio]) : 0)),
    );
    void apply(
      changes,
      radarS === 0
        ? undefined
        : {
            timeoutSeconds: ROLLBACK_SECONDS + radarS,
            note: `The 5 GHz network goes off for ${radarS <= 60 ? 'about a minute' : `about ${String(Math.ceil(radarS / 60))} minutes`} while the router listens for radar on its channels; devices on it reconnect after that.`,
          },
    );
  };

  return (
    <>
      <PageHeader title="Radios & SSIDs" description="Networks, passwords and radio settings for each band." />
      <div className="flex flex-col gap-4">
        <WifiLive />
        <ApplyStatus state={state} />
        {error !== undefined && data === undefined ? (
          <LoadError error={error} retry={reload} />
        ) : loading && data === undefined ? (
          <FormSkeleton />
        ) : (
          <div className="grid gap-4 2xl:grid-cols-2">
            <Card className="2xl:col-span-2">
              <CardContent>
                <CountryField
                  countries={data?.countries ?? []}
                  value={country}
                  saved={data?.country ?? ''}
                  bandsHere={[...new Set(forms.map((f) => f.band))]}
                  onChange={setCountryEdit}
                />
              </CardContent>
            </Card>
            {forms.map((f) => (
              <RadioCard
                key={f.radio}
                form={f}
                options={data?.options[f.radio]}
                rules={rules}
                onChange={(key, value) => {
                  setEdits((e) => ({ ...e, [f.radio]: { ...(e[f.radio] ?? f), [key]: value } }));
                }}
              />
            ))}
            <RadarCard className="2xl:col-span-2" />
            <BeamformingCard className="2xl:col-span-2" />
          </div>
        )}
      </div>
      <SaveBar
        visible={dirty}
        busy={state.phase === 'applying'}
        invalid={invalid}
        onSave={save}
        onRevert={() => {
          setEdits({});
          setCountryEdit(data?.country);
        }}
      />
    </>
  );
}
