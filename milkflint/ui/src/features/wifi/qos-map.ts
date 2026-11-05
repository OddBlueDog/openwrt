// What each DSCP mark gets on Wi-Fi: hostapd's qos_map_set, which mac80211 goes
// by for what the router sends and devices are told for what they send.
// Unset is the image's default, RFC 8325 for Wi-Fi at the network's edge
// (wifi-scripts): each mark in use as an exception over UP 0, nothing
// at UP 7. OpenWrt's own map has every value from 48 up on the voice queue.

export type QosMapChoice = 'edge' | 'openwrt' | 'custom';

export const OPENWRT_QOS_MAP = '0,0,2,16,1,1,255,255,18,22,24,38,40,40,44,46,48,56';

export function qosMapChoice(value: string): QosMapChoice {
  return value === '' ? 'edge' : value === OPENWRT_QOS_MAP ? 'openwrt' : 'custom';
}

/** qos_map_set for a choice; undefined: unset, the image's default */
export function qosMapValue(choice: Exclude<QosMapChoice, 'custom'>): string | undefined {
  return choice === 'edge' ? undefined : OPENWRT_QOS_MAP;
}

export function qosMapHint(choice: QosMapChoice): string {
  switch (choice) {
    case 'edge':
      return 'Follows RFC 8325: calls first, then video, background transfers last. Traffic marked as network control is ordinary traffic here, so nothing can take the voice queue by marking itself so.';
    case 'openwrt':
      return 'OpenWrt’s own map. Anything marked as network control, or with a mark above it, takes the voice queue, ahead of everything else.';
    case 'custom':
      return 'Set some other way (qos_map_set), and left as it is.';
  }
}
