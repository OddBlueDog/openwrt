// The keys apk trusts: one PEM public key a file in /etc/apk/keys. A
// package list signed by one of them installs. OpenWrt's release keys and
// MilkFlint's own (public-key.pem, which signs its packages and kernel
// modules) come with the firmware and stay: without them updates stop.

export const KEY_DIR = '/etc/apk/keys';

export interface RepoKey {
  name: string;
  text: string;
}

/** apk's limit is far above any key; LuCI's page refuses more than this too. */
const MAX_LENGTH = 8192;

export function isBuiltIn(name: string): boolean {
  return /^openwrt-/i.test(name) || name === 'public-key.pem';
}

const normalised = (text: string): string => text.replace(/\s+/g, '');

/** What's wrong with a key pasted in; undefined when it can be added. */
export function checkRepoKey(text: string, existing: readonly RepoKey[]): string | undefined {
  if (/-BEGIN [A-Z ]*PRIVATE KEY-/.test(text))
    return 'That’s a private key: it stays with whoever signs the packages. Add their public key.';
  if (!/-BEGIN ([A-Z]+ )?PUBLIC KEY-/.test(text))
    return 'That isn’t a package key: apk wants a public key in PEM form, starting -----BEGIN PUBLIC KEY-----.';
  if (text.length > MAX_LENGTH) return 'That’s too long for a key: check it’s the key file itself.';
  const same = existing.find((k) => normalised(k.text) === normalised(text));
  return same === undefined ? undefined : `That key is already here, as ${same.name}.`;
}

/** The file to write a key as: the name it came with (a file's, or a link's last part), made safe, ending .pem. */
export function fileNameFor(source: string, taken: readonly string[]): string {
  const last = source.split(/[?#]/)[0]?.split('/').pop() ?? '';
  const stem = last
    .replace(/\.[^.]*$/, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+|-+$/g, '');
  const base = stem === '' ? `key-${String(Date.now())}` : stem;
  let name = `${base}.pem`;
  for (let n = 2; taken.includes(name); n++) name = `${base}-${String(n)}.pem`;
  return name;
}
