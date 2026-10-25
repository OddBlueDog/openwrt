// The security modes the Wi-Fi pages offer: the stock firmware's choices
// (OpenWrt's `encryption` values, before any '+cipher').
export const securityOptions = [
  { value: 'sae-mixed', label: 'WPA2-PSK/WPA3-SAE', hint: 'WPA3 where devices support it, WPA2 for the rest. Recommended.' },
  { value: 'sae', label: 'WPA3-SAE', hint: 'Most secure. Some older devices can’t join.' },
  { value: 'psk2', label: 'WPA2-PSK', hint: 'For devices that don’t have WPA3.' },
  { value: 'psk-mixed', label: 'WPA/WPA2-PSK', hint: 'Only for very old devices: WPA (TKIP) is long outdated.' },
  { value: 'none', label: 'Open', hint: 'No password: anyone nearby can join.' },
] as const;
