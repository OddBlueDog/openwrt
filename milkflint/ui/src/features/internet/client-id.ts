// DHCP option 61, the client identifier the router sends when it asks the
// provider for an address. OpenWrt 25.12's dhcp protocol only takes the
// `clientid` option as hex (anything else is logged and ignored, and it
// sends its own generated ID instead), but providers such as Sky give it out
// as text (username@skydsl|password), so the page takes either.

export type ClientIdMode = 'text' | 'hex';

// the same check as OpenWrt's hexdump_2hex: pairs of hex digits, optionally
// separated by spaces, colons or dashes
const HEX = /^\s*[0-9a-f]{2}((\s+|[:-]?)[0-9a-f]{2})*\s*$/i;

/** A DHCP option holds at most 255 bytes. */
const MAX_BYTES = 255;

function hexBytes(hex: string): number[] {
  return (hex.replace(/[\s:-]/g, '').match(/../g) ?? []).map((b) => Number.parseInt(b, 16));
}

export function textToHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The value as text, when it's valid hex and every byte is printable ASCII. */
export function hexToText(hex: string): string | undefined {
  if (!HEX.test(hex)) return undefined;
  const bytes = hexBytes(hex);
  return bytes.every((b) => b >= 0x20 && b <= 0x7e) ? String.fromCharCode(...bytes) : undefined;
}

/** How a stored `clientid` shows in the form: as text when it reads as text. */
export function fromStored(raw: string): { mode: ClientIdMode; value: string } {
  const text = hexToText(raw);
  if (text !== undefined) return { mode: 'text', value: text };
  // not hex at all: OpenWrt ignores it; show what's there, it's rewritten as hex only if edited
  return { mode: HEX.test(raw) ? 'hex' : 'text', value: raw };
}

/** What to store: plain lowercase hex ('' for none), or undefined if the input can't be sent. */
export function toStored(mode: ClientIdMode, value: string): string | undefined {
  if (value === '') return '';
  let hex: string;
  if (mode === 'text') hex = textToHex(value);
  else if (HEX.test(value)) hex = value.replace(/[\s:-]/g, '').toLowerCase();
  else return undefined;
  return hex.length / 2 > MAX_BYTES ? undefined : hex;
}
