// The security modes the Wi-Fi pages offer: the stock firmware's choices
// (OpenWrt's `encryption` values, before any '+cipher').
export const securityOptions = [
  { value: 'sae-mixed', label: 'WPA2-PSK/WPA3-SAE', hint: 'WPA3 where devices support it, WPA2 for the rest. Recommended.' },
  { value: 'sae', label: 'WPA3-SAE', hint: 'Most secure. Some older devices can’t join.' },
  { value: 'psk2', label: 'WPA2-PSK', hint: 'For devices that don’t have WPA3.' },
  { value: 'psk-mixed', label: 'WPA/WPA2-PSK', hint: 'Only for very old devices: WPA (TKIP) is long outdated.' },
  { value: 'none', label: 'Open', hint: 'No password: anyone nearby can join.' },
] as const;

// The `encryption` values that use WPA3-SAE, the ones set in LuCI included:
// wifi-scripts' iface.uc makes them auth_type sae, psk-sae or psk-sae-compat.
const saeModes: readonly string[] = ['sae', 'psk3', 'sae-mixed', 'psk3-mixed', 'sae-compat'];

/**
 * What's wrong with a Wi-Fi password for a security mode, if anything. A
 * 64-digit hex key is a raw WPA2 key, and OpenWrt hands hostapd any
 * 64-character key as one even for WPA3, where SAE can't use it: hostapd
 * starts the network anyway and every WPA3 join fails.
 */
export function keyError(encryption: string, key: string): string | undefined {
  if (encryption === 'none' || (key.length >= 8 && key.length <= 63)) return undefined;
  if (!/^[0-9a-fA-F]{64}$/.test(key)) return 'Use 8 to 63 characters.';
  if (saeModes.includes(encryption)) return 'WPA3 needs 8 to 63 characters: a 64-digit hex key only works with WPA2.';
  return undefined;
}
