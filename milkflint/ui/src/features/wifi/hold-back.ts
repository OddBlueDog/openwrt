// A band's hold-back period (Wi-Fi 6): after the router has scheduled a
// device's turn to send, the device may not try to send on its own again for
// this long. It is the MU EDCA timer the access point announces, one per kind
// of traffic: hostapd's he_mu_edca_ac_{be,bk,vi,vo}_timer on the radio, in
// steps of 8 ms. OpenWrt's own is the longest there is, about 2 seconds, and
// with the router keeping the air busy a device's sending can then be stuck
// for a moment at a time. MilkFlint sets the shortest on first boot
// (uci-defaults.sh); the band's card (page.tsx) offers the two.

/**
 * What a band has: the shortest period, OpenWrt's own (the options unset, or
 * set to its value), or something else set outside this page, which the page
 * shows and leaves alone.
 */
export type HoldBack = 'short' | 'openwrt' | 'custom';

/** The radio's options, one per kind of traffic: best effort, background, video, voice */
export const HOLD_BACK_OPTIONS = ['he_mu_edca_ac_be_timer', 'he_mu_edca_ac_bk_timer', 'he_mu_edca_ac_vi_timer', 'he_mu_edca_ac_vo_timer'] as const;

/** In steps of 8 ms: the shortest that is still a period at all, and OpenWrt's */
export const HOLD_BACK_SHORT = '1';
export const HOLD_BACK_OPENWRT = '255';

/** The choice a radio's four options amount to, in HOLD_BACK_OPTIONS' order (undefined: unset) */
export function holdBackOf(values: readonly (string | undefined)[]): HoldBack {
  if (values.length > 0 && values.every((v) => v === HOLD_BACK_SHORT)) return 'short';
  if (values.every((v) => v === undefined || v === HOLD_BACK_OPENWRT)) return 'openwrt';
  return 'custom';
}

/**
 * What a choice writes: every option's value, undefined to unset it (OpenWrt's
 * own is left to OpenWrt). undefined for 'custom': nothing is written.
 */
export function holdBackValues(choice: HoldBack): Record<string, string | undefined> | undefined {
  if (choice === 'custom') return undefined;
  return Object.fromEntries(HOLD_BACK_OPTIONS.map((o) => [o, choice === 'short' ? HOLD_BACK_SHORT : undefined]));
}

export const HOLD_BACK_LABELS: Record<HoldBack, string> = {
  short: 'Shortest (8 ms)',
  openwrt: 'OpenWrt’s default (2 seconds)',
  custom: 'Custom (set elsewhere)',
};

/** The choices offered: the two, and what's set now if it is neither */
export function holdBackChoices(now: HoldBack): HoldBack[] {
  return now === 'custom' ? ['short', 'openwrt', 'custom'] : ['short', 'openwrt'];
}

export function holdBackHint(choice: HoldBack): string {
  const what =
    'After the router has scheduled a Wi-Fi 6 device’s turn to send, the device may not try to send on its own again for this long.';
  const restart = 'Changing it restarts this band’s network.';
  switch (choice) {
    case 'short':
      return `${what} The shortest keeps a device’s sending from getting stuck while the router is busy. ${restart}`;
    case 'openwrt':
      return `${what} With this long a period, a busy router can leave a device’s sending stuck for a moment at a time. ${restart}`;
    case 'custom':
      return `${what} The periods set on this radio aren’t one of the two choices; they are kept until you pick one. ${restart}`;
  }
}
