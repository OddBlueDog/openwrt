// Host names typed into a list (Test Bench's own sites, the VPN page's sites
// that go direct): what a pasted address brings with it is cleaned off (its
// scheme, path, port, upper case, dots at either end), and what's left is
// either a host name or set aside as typed. Nothing with a `/` gets through:
// dnsmasq's --nftset=/a/b/… would read it as two names.

const HOST = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A host name: two labels or more, lower case, the last of them not a number (so no addresses). */
export function validHost(s: string): boolean {
  return s.length <= 253 && HOST.test(s);
}

/** One entry as typed, as a host name would be: `https://www.BBC.co.uk/iplayer` is www.bbc.co.uk, `.bbc.co.uk` and `*.bbc.co.uk` are bbc.co.uk. */
function clean(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/[/?#].*$/, '')
    .replace(/:\d*$/, '')
    .replace(/^\*?\.+/, '')
    .replace(/\.+$/, '');
}

/**
 * Host names typed into a list (commas, spaces or new lines between them):
 * the good ones once each, the first `max` of them (`over` when there were
 * more), and the rest as typed. Names in `known` are left out without a word
 * (Test Bench's fixed list).
 */
export function parseSites(
  text: string,
  max: number,
  known: readonly string[] = [],
): { sites: string[]; bad: string[]; over: boolean } {
  const sites: string[] = [];
  const bad: string[] = [];
  let over = false;
  for (const raw of text.split(/[\s,]+/)) {
    const name = clean(raw);
    if (name === '') continue;
    if (!validHost(name)) bad.push(raw.trim());
    else if (!sites.includes(name) && !known.includes(name)) {
      if (sites.length < max) sites.push(name);
      else over = true;
    }
  }
  return { sites, bad, over };
}
