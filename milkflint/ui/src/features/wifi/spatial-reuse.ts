// Spatial reuse (802.11ax OBSS PD): sending while another network is heard only
// weakly, rather than waiting for it. The radio's own part is the Wi-Fi
// driver's mode (milkflint.wifi.spr_<band>, features/wifi/bin/wifi-spr); what
// its devices may do is hostapd's, in the network's beacons (wireless'
// he_spr_sr_control and he_spr_non_srg_obss_pd_max_offset). Automatic leaves
// all of them unset: OpenWrt's default, the firmware deciding for the radio and
// beacons telling devices not to.

export type SprMode = 'auto' | 'devices' | 'fixed' | 'off';

export interface SprSetting {
  /** custom: hostapd's options set some other way (LuCI, by hand), left as they are */
  mode: SprMode | 'custom';
  /** dBm: a neighbour heard below this doesn't hold a sender back */
  threshold: number;
}

/** A sender always waits for what it hears above this; the offset in the beacons is from here. */
const PD_MIN_DBM = -82;
export const SPR_THRESHOLDS = [-77, -72, -67, -62] as const;
export const SPR_DEFAULT_THRESHOLD = -72;

export const SPR_MODE_LABELS: Record<SprMode, string> = {
  auto: 'Automatic',
  devices: 'Automatic, devices too',
  fixed: 'Fixed threshold, devices too',
  off: 'Off',
};

/** The modes to offer: only a driver with the setting can have a fixed threshold, or none. */
export function sprModes(driverHasModes: boolean): SprMode[] {
  return driverHasModes ? ['auto', 'devices', 'fixed', 'off'] : ['auto', 'devices'];
}

export function sprHint(mode: SprMode | 'custom'): string {
  switch (mode) {
    case 'auto':
      return 'The radio’s firmware decides for itself; devices are told not to.';
    case 'devices':
      return 'The radio’s firmware decides for itself; Wi-Fi 6 devices that can may do it too, up to the threshold.';
    case 'fixed':
      return 'The radio uses the threshold instead of deciding for itself, and Wi-Fi 6 devices that can may too.';
    case 'off':
      return 'Neither the radio nor its devices do it.';
    case 'custom':
      return 'Set some other way (he_spr_sr_control), and left as it is.';
  }
}

/** milkflint.wifi's option for a band's driver mode */
export function sprOption(band: string): string {
  return `spr_${band}`;
}

function thresholdOf(offset: string | undefined): number {
  const n = Number(offset);
  return offset !== undefined && /^\d+$/.test(offset) && n <= 20 ? PD_MIN_DBM + n : SPR_DEFAULT_THRESHOLD;
}

/** The setting, from the radio's two options and the driver mode as wifi-spr reads it */
export function sprOf(control: string | undefined, offset: string | undefined, driver: string | undefined): SprSetting {
  const threshold = thresholdOf(offset);
  const allowed = control === '0' && offset !== undefined;
  if (driver === 'off' && control === undefined && offset === undefined) return { mode: 'off', threshold };
  if (driver === 'fixed' && allowed) return { mode: 'fixed', threshold };
  if (control === undefined && offset === undefined) return { mode: 'auto', threshold };
  return { mode: allowed ? 'devices' : 'custom', threshold };
}

/** The radio's options for a setting: undefined unset. Custom keeps what's there. */
export function sprRadioOptions(s: SprSetting): Record<string, string | undefined> {
  switch (s.mode) {
    case 'auto':
    case 'off':
      return { he_spr_sr_control: undefined, he_spr_non_srg_obss_pd_max_offset: undefined };
    case 'devices':
    case 'fixed':
      return { he_spr_sr_control: '0', he_spr_non_srg_obss_pd_max_offset: String(s.threshold - PD_MIN_DBM) };
    case 'custom':
      return {};
  }
}

/** milkflint.wifi.spr_<band> for a setting; undefined: unset, the driver's auto */
export function sprDriverMode(s: SprSetting): string | undefined {
  return s.mode === 'fixed' || s.mode === 'off' ? s.mode : undefined;
}

/** What the radio does now, as the router reports it: '' while its network is off */
export function sprNow(now: { running: boolean; mode: string | null; control: number | null; offset: number | null } | undefined): string {
  if (now?.running !== true) return '';
  const radio = now.mode === 'fixed' ? 'a fixed threshold' : now.mode === 'off' ? 'off' : 'the firmware’s choice';
  // he_spr_sr_control bit 1: reuse by threshold not allowed; with no element in the beacons at all, it's up to them
  const devices =
    now.control === null
      ? 'free to choose'
      : (now.control & 2) !== 0
        ? 'not allowed'
        : now.offset === null
          ? 'allowed'
          : `allowed up to ${String(PD_MIN_DBM + now.offset)} dBm`;
  return `In use now: radio ${radio}, devices ${devices}.`;
}

/** "-72 dBm", with what each end of the choices means */
export function sprThresholdLabel(dbm: number): string {
  const note = dbm === SPR_THRESHOLDS[0] ? ' (cautious)' : dbm === SPR_THRESHOLDS[SPR_THRESHOLDS.length - 1] ? ' (most reuse)' : '';
  return `${String(dbm)} dBm${note}`;
}
