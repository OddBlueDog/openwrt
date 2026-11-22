// Multi-user scheduling (MU-MIMO & OFDMA), per band. The four flags go live
// to the Wi-Fi driver (milkflint.wifi.muru_<band>_*, features/wifi/bin/wifi-muru)
// without restarting Wi-Fi. Downlink defaults on; uplink defaults off because
// scheduled uplink has been found to cause periodic Wi-Fi pauses and latency
// spikes.
import type { MuruStatus } from '@/lib/api/wireless';

export type MuruFlag = 'ofdma_dl' | 'ofdma_ul' | 'mimo_dl' | 'mimo_ul';

export interface MuruSetting {
  /** Downlink MU-MIMO (driver default: on) */
  mimoDl: boolean;
  /** Downlink OFDMA (driver default: on) */
  ofdmaDl: boolean;
  /** Uplink MU-MIMO (driver default: off) */
  mimoUl: boolean;
  /** Uplink OFDMA (driver default: off) */
  ofdmaUl: boolean;
}

/** Safe defaults: both download features on, both upload features off. */
export const MURU_DEFAULTS: MuruSetting = {
  mimoDl: true,
  ofdmaDl: true,
  mimoUl: false,
  ofdmaUl: false,
};

export const MURU_ALL_OFF: MuruSetting = {
  mimoDl: false,
  ofdmaDl: false,
  mimoUl: false,
  ofdmaUl: false,
};

/** Whether the band's master multi-user switch is on (any flag enabled). */
export function muruEnabled(s: MuruSetting): boolean {
  return s.mimoDl || s.ofdmaDl || s.mimoUl || s.ofdmaUl;
}

/** Turning the master switch on restores the safe defaults (download on, upload off); off clears all four. */
export function muruWithMaster(on: boolean): MuruSetting {
  return on ? { ...MURU_DEFAULTS } : { ...MURU_ALL_OFF };
}

/** milkflint.wifi's option for one of a band's multi-user flags. */
export function muruOption(band: string, name: MuruFlag): string {
  return `muru_${band}_${name}`;
}

/** The setting, from milkflint.wifi's muru_<band>_* options. */
export function muruOf(get: (name: MuruFlag) => string | undefined): MuruSetting {
  return {
    mimoDl: get('mimo_dl') !== '0',
    ofdmaDl: get('ofdma_dl') !== '0',
    mimoUl: get('mimo_ul') === '1',
    ofdmaUl: get('ofdma_ul') === '1',
  };
}

/** milkflint.wifi's options for a band; undefined: unset (the driver's default). */
export function muruDriverOptions(band: string, s: MuruSetting): Record<string, string | undefined> {
  return {
    [muruOption(band, 'mimo_dl')]: s.mimoDl ? undefined : '0',
    [muruOption(band, 'ofdma_dl')]: s.ofdmaDl ? undefined : '0',
    [muruOption(band, 'mimo_ul')]: s.mimoUl ? '1' : undefined,
    [muruOption(band, 'ofdma_ul')]: s.ofdmaUl ? '1' : undefined,
  };
}

/** What a band can use of the driver's flags. */
export interface MuruBand {
  /** Wi-Fi 6 or newer: OFDMA and uplink MU-MIMO exist only there */
  wifi6: boolean;
  /** beamforming and MU-MIMO on in Networks & radios: without, the driver sends no downlink MU-MIMO */
  muMimo: boolean;
}

/**
 * What the radio runs with now, as the router reports it: '' while off or unsupported.
 * The driver reports the band's flags as set, so a flag the band can't use isn't listed.
 */
export function muruNow(now: MuruStatus | undefined, band: MuruBand): string {
  if (now?.running !== true || !now.supported) return '';
  const active: string[] = [];
  if (now.mimo_dl === true && band.muMimo) active.push('download MU-MIMO');
  if (now.ofdma_dl === true && band.wifi6) active.push('download OFDMA');
  if (now.mimo_ul === true && band.wifi6) active.push('upload MU-MIMO');
  if (now.ofdma_ul === true && band.wifi6) active.push('upload OFDMA');
  return active.length === 0 ? 'In use now: all off.' : `In use now: ${active.join(', ')}.`;
}
