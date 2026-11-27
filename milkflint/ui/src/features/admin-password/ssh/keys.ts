// SSH keys that may sign in as root: /etc/dropbear/authorized_keys, one key
// a line as OpenSSH writes it ([options] type base64 [name]). Each key read
// from its base64 (its type, RSA's size), with the fingerprint ssh-keygen -l
// prints, and how well it suits signing in here: a suggestion, never a
// reason to refuse it, so the keys people already have keep working. Edits
// change only the lines they add or remove: comments and lines this page
// doesn't know stay as they are (LuCI's page drops them).
import { sha256 } from '@/lib/sha256';

export type KeyKind = 'ed25519' | 'ed25519-sk' | 'rsa' | 'ecdsa' | 'ecdsa-sk' | 'dsa' | 'mldsa';

export interface SshKey {
  /** The line as the file has it, trimmed. */
  line: string;
  kind: KeyKind;
  /** RSA's size; the others' is fixed by their type. */
  bits: number | undefined;
  /** The name after the key, often user@computer. */
  comment: string;
  /** What comes before the key: from="…", command="…", restrictions Dropbear applies. */
  options: string | undefined;
  /** As ssh-keygen -l and ssh-add -l print it. */
  fingerprint: string;
  fit: Fit;
  /** Why a key is weak or can't sign in yet. */
  note: string | undefined;
}

/**
 * How well a key suits signing in to the router (Dropbear 2026.94): the one
 * to make, one that works, one that signs in but is short enough to break,
 * or one Dropbear can't use (yet).
 */
export type Fit = 'recommended' | 'works' | 'weak' | 'unsupported';

const TYPES: Readonly<Record<string, KeyKind>> = {
  'ssh-ed25519': 'ed25519',
  'sk-ssh-ed25519@openssh.com': 'ed25519-sk',
  'ssh-rsa': 'rsa',
  'ecdsa-sha2-nistp256': 'ecdsa',
  'ecdsa-sha2-nistp384': 'ecdsa',
  'ecdsa-sha2-nistp521': 'ecdsa',
  'sk-ecdsa-sha2-nistp256@openssh.com': 'ecdsa-sk',
  'ssh-dss': 'dsa',
  // OpenSSH 10.6's post-quantum hybrid, and 10.4's experimental name for it
  'ssh-mldsa44-ed25519': 'mldsa',
  'ssh-mldsa44-ed25519@openssh.com': 'mldsa',
};

export const kindLabel: Readonly<Record<KeyKind, string>> = {
  ed25519: 'Ed25519',
  'ed25519-sk': 'Ed25519 on a security key',
  rsa: 'RSA',
  ecdsa: 'ECDSA',
  'ecdsa-sk': 'ECDSA on a security key',
  dsa: 'DSA',
  mldsa: 'ML-DSA + Ed25519 (post-quantum)',
};

/** RSA keys shorter than this can be broken with enough computing. */
const MIN_RSA_BITS = 2048;

const FIT: Readonly<Record<KeyKind, Fit>> = {
  ed25519: 'recommended',
  'ed25519-sk': 'recommended',
  rsa: 'works',
  ecdsa: 'works',
  'ecdsa-sk': 'works',
  dsa: 'unsupported',
  mldsa: 'unsupported',
};

function fitOf(kind: KeyKind, bits: number | undefined): { fit: Fit; note: string | undefined } {
  if (kind === 'rsa' && bits !== undefined && bits < MIN_RSA_BITS)
    return {
      fit: 'weak',
      note: `A ${String(bits)}-bit RSA key still signs in, but it’s short enough to break: make an Ed25519 key when you can.`,
    };
  if (kind === 'dsa')
    return {
      fit: 'unsupported',
      note: 'DSA keys can’t sign in: Dropbear and OpenSSH dropped them as unsafe. Make an Ed25519 key.',
    };
  if (kind === 'mldsa')
    return {
      fit: 'unsupported',
      note: 'A post-quantum key: no Dropbear release takes these yet, so it can’t sign in. It stays here for when one does; an Ed25519 key signs in meanwhile.',
    };
  return { fit: FIT[kind], note: undefined };
}

function decodeBase64(s: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return undefined;
  try {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  } catch {
    return undefined;
  }
}

/** The length-prefixed fields of a key in SSH's wire format; undefined when they don't add up. */
function wireFields(blob: Uint8Array): Uint8Array[] | undefined {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const out: Uint8Array[] = [];
  for (let at = 0; at < blob.length;) {
    if (at + 4 > blob.length) return undefined;
    const n = view.getUint32(at);
    at += 4;
    if (at + n > blob.length) return undefined;
    out.push(blob.subarray(at, at + n));
    at += n;
  }
  return out;
}

/** A big number's size in bits (an mpint: big-endian, maybe a leading zero byte). */
function bitLength(mpint: Uint8Array): number {
  const start = mpint.findIndex((b) => b !== 0);
  if (start === -1) return 0;
  return (mpint.length - start - 1) * 8 + Math.floor(Math.log2(mpint[start] ?? 1)) + 1;
}

function fingerprint(blob: Uint8Array): string {
  return `SHA256:${btoa(String.fromCharCode(...sha256(blob))).replace(/=+$/, '')}`;
}

/** Where the options before a key end: the first space outside quotes. */
function optionsEnd(line: string): number {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted && c === '\\') i++;
    else if (c === '"') quoted = !quoted;
    else if (!quoted && (c === ' ' || c === '\t')) return i;
  }
  return line.length;
}

/** One line of authorized_keys; undefined for a comment, a blank or anything that isn't a key. */
export function parseKey(raw: string): SshKey | undefined {
  const line = raw.trim();
  if (line === '' || line.startsWith('#')) return undefined;
  const first = line.split(/\s+/, 1)[0] ?? '';
  const end = first in TYPES ? 0 : optionsEnd(line);
  const options = end === 0 ? undefined : line.slice(0, end);
  const [type = '', base64 = '', ...name] = line.slice(end).trim().split(/\s+/);
  const kind = TYPES[type];
  const blob = decodeBase64(base64);
  const fields = blob === undefined ? undefined : wireFields(blob);
  if (kind === undefined || blob === undefined || fields === undefined) return undefined;
  // the type inside the key has to be the one in front of it
  if (new TextDecoder().decode(fields[0]) !== type) return undefined;
  // ssh-rsa: e, then n
  const bits = kind === 'rsa' && fields[2] !== undefined ? bitLength(fields[2]) : undefined;
  return {
    line,
    kind,
    bits,
    comment: name.join(' '),
    options,
    fingerprint: fingerprint(blob),
    ...fitOf(kind, bits),
  };
}

const lines = (text: string): string[] => text.split(/\r?\n/);

/** The keys in the file, in its order. */
export function keysOf(text: string): SshKey[] {
  return lines(text).flatMap((l) => parseKey(l) ?? []);
}

/** The file without that key's line; every other line as it was. */
export function removeKey(text: string, line: string): string {
  return lines(text)
    .filter((l) => l.trim() !== line)
    .join('\n');
}

export type AddResult =
  | { text: string; added: number; notes: string[]; error?: undefined }
  | { error: string; text?: undefined; added?: undefined; notes?: undefined };

/**
 * The file with the keys pasted (one a line) added at its end: any public
 * key, with a note for one that's weak or can't sign in yet. Refused, all of
 * them, only for what isn't a public key or is one already there.
 */
export function addKeys(text: string, input: string): AddResult {
  if (input.includes('PRIVATE KEY-----'))
    return { error: 'That’s a private key: keep it on your computer. Paste the public key, the line in the .pub file.' };
  const known = new Map(keysOf(text).map((k) => [k.fingerprint, k]));
  const added: SshKey[] = [];
  for (const raw of lines(input)) {
    const l = raw.trim();
    if (l === '' || l.startsWith('#')) continue;
    const key = parseKey(l);
    if (key === undefined)
      return {
        error:
          'That isn’t an SSH public key. Paste the line from your key’s .pub file: it starts with ssh-ed25519, ssh-rsa or ecdsa-sha2.',
      };
    const same = known.get(key.fingerprint);
    if (same !== undefined) return { error: `That key is already added${same.comment === '' ? '' : ` (as “${same.comment}”)`}.` };
    known.set(key.fingerprint, key);
    added.push(key);
  }
  const notes = added.flatMap((k) => (k.note === undefined ? [] : [k.note]));
  if (added.length === 0) return { text, added: 0, notes };
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return { text: `${base}${added.map((k) => k.line).join('\n')}\n`, added: added.length, notes };
}

/** Whether a key can sign in here: any but those Dropbear can't use. */
export const signsIn = (k: SshKey): boolean => k.fit !== 'unsupported';
