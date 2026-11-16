// Reads the Wi-Fi settings for both Wi-Fi pages. Each asks the radios only
// for what it shows: Networks & radios their channels, powers and countries,
// the Wi-Fi driver page spatial reuse and TWT now (queries to the Wi-Fi
// firmware); both what a radar check would take, for the warning beside Save.
import { bool, getConfig, type Section, str } from '@/lib/api/uci';
import {
  type Country,
  getCountries,
  getDfsFrequencies,
  getFrequencies,
  getRadar,
  getRegulatedCountries,
  getSpatialReuse,
  getTwt,
  getTxPowers,
  getWirelessStatus,
} from '@/lib/api/wireless';
import { isGuestIface } from '../wifi-guest/guest';
import { airtimeBandsOf, airtimeOf, airtimeOption } from './airtime';
import { HOLD_BACK_OPTIONS, holdBackOf } from './hold-back';
import { inBand, type RadioForm, type RadioOptions, type WifiData } from './model';
import { sprOf, sprOption } from './spatial-reuse';
import { twtOf, twtOption } from './twt';

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

/** The page asking: 'networks' (Networks & radios) or 'driver' (Wi-Fi driver). */
export type WifiPart = 'networks' | 'driver';

export async function loadWifi(part: WifiPart): Promise<WifiData> {
  const [sections, status, milkflint] = await Promise.all([
    getConfig('wireless'),
    getWirelessStatus(),
    getConfig('milkflint').catch((): Section[] => []),
  ]);
  const wifiSection = milkflint.find((s) => s['.name'] === 'wifi');
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
    const band = str(r, 'band') ?? '2g';
    const iface = ifaces.find((i) => str(i, 'device') === name && (str(i, 'mode') ?? 'ap') === 'ap');
    const htmode = str(r, 'htmode') ?? 'HE20';
    const m = /^(NOHT|[A-Z]+?)(\d*)$/.exec(htmode);
    const [security = 'none', ...cipher] = (str(iface, 'encryption') ?? 'none').split('+');
    return {
      radio: name,
      band,
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
      spr: sprOf(str(r, 'he_spr_sr_control'), str(r, 'he_spr_non_srg_obss_pd_max_offset'), str(wifiSection, sprOption(band))),
      qosMap: str(iface, 'qos_map_set') ?? '',
      twt: twtOf(str(r, 'he_twt_responder'), (n) => str(wifiSection, twtOption(band, n))),
      holdBack: holdBackOf(HOLD_BACK_OPTIONS.map((o) => str(r, o))),
      airtime: airtimeOf(str(wifiSection, airtimeOption(band))),
      airtimeBands: airtimeBandsOf((o) => str(wifiSection, o), band),
      multicastToUnicast: bool(iface, 'multicast_to_unicast'),
    };
  });

  const networks = part === 'networks';
  const options: Record<string, RadioOptions> = {};
  await Promise.all(
    forms.map(async (f) => {
      const htmodes = status[f.radio]?.iwinfo?.htmodes;
      // a Wi-Fi interface, or the radio's phy while its network is off (a fresh install)
      const device = status[f.radio]?.interfaces?.find((i) => i.ifname !== undefined)?.ifname ?? status[f.radio]?.iwinfo?.phy;
      if (device === undefined) {
        options[f.radio] = { channels: [], txpowers: [], htmodes, dfs: [], cacMs: {}, spr: undefined, twtLimits: false };
        return;
      }
      const [channels, txpowers, dfs, radar, spr, twt] = await Promise.all([
        networks ? getFrequencies(device).catch(() => []) : [],
        networks ? getTxPowers(device).catch(() => []) : [],
        getDfsFrequencies(device).catch((): number[] => []),
        f.band === '5g' ? getRadar(device).catch(() => undefined) : undefined,
        networks ? undefined : getSpatialReuse(device).catch(() => undefined),
        networks ? undefined : getTwt(device).catch(() => undefined),
      ]);
      options[f.radio] = {
        // all of them: which may be used goes by the country's rules (see usable)
        channels: channels.filter((c) => inBand(c.mhz, f.band)),
        txpowers: txpowers.map((t) => t.dbm),
        htmodes,
        dfs,
        cacMs: Object.fromEntries((radar?.channels ?? []).flatMap((c) => (c.cac_ms === undefined ? [] : [[c.mhz, c.cac_ms]]))),
        spr,
        twtLimits: twt?.supported === true,
      };
    }),
  );
  const codes = new Set(radios.map((r) => (str(r, 'country') ?? '').toUpperCase()));
  const only = codes.size === 1 ? [...codes][0] : undefined;
  const country = only === undefined || only === '00' ? '' : only;
  if (!networks) return { forms, milkflint, options, radios: radios.map((r) => r['.name']), country, countries: [] };

  // countries: ask any radio, by an interface or by its phy (no interface while Wi-Fi is off)
  const device =
    Object.values(status)
      .flatMap((r) => r.interfaces ?? [])
      .find((i) => i.ifname !== undefined)?.ifname ??
    Object.values(status).find((r) => r.iwinfo?.phy !== undefined)?.iwinfo?.phy ??
    'phy0';
  const [named, regulated] = await Promise.all([
    getCountries(device).catch((): Country[] => []),
    getRegulatedCountries().catch((): string[] => []),
  ]);
  // only countries with rules: the radio ignores any other (and keeps the rules it had)
  const countries = regulated.length === 0 ? named : named.filter((c) => regulated.includes(c.code));
  return {
    forms,
    milkflint,
    options,
    radios: radios.map((r) => r['.name']),
    country,
    countries: countries.length > 0 ? countries : fallbackCountries,
  };
}
