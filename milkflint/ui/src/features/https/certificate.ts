// What the HTTPS page shows of the router's certificate, read from its DER
// bytes (X.509, RFC 5280): who it names, the names it's for and how long it
// is valid. Only the fields shown; anything that isn't a certificate of the
// expected shape gives undefined.

export interface Certificate {
  /** The subject's common name (CN), e.g. "MilkFlint". */
  commonName: string | undefined;
  /** The names it's valid for (subjectAltName): host names, then addresses. */
  altNames: string[];
  notBefore: Date;
  notAfter: Date;
  /** Issued by itself, as the router's own is: browsers ask before trusting it. */
  selfSigned: boolean;
}

interface Tlv {
  tag: number;
  /** The content, [start, end). */
  start: number;
  end: number;
}

class DerError extends Error {}

function tlv(b: Uint8Array, at: number, limit: number): Tlv {
  if (at + 2 > limit) throw new DerError('truncated');
  const tag = b[at] ?? 0;
  let len = b[at + 1] ?? 0;
  let p = at + 2;
  if ((len & 0x80) !== 0) {
    const n = len & 0x7f;
    if (n === 0 || n > 3 || p + n > limit) throw new DerError('bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + (b[p++] ?? 0);
  }
  if (p + len > limit) throw new DerError('truncated');
  return { tag, start: p, end: p + len };
}

/** The elements inside a constructed one, in order. */
function children(b: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = [];
  for (let at = parent.start; at < parent.end; ) {
    const t = tlv(b, at, parent.end);
    out.push(t);
    at = t.end;
  }
  return out;
}

function expect(t: Tlv | undefined, tag: number): Tlv {
  if (t?.tag !== tag) throw new DerError(`expected tag ${tag.toString(16)}`);
  return t;
}

const SEQUENCE = 0x30;
const OID = 0x06;
const OCTET_STRING = 0x04;
const UTC_TIME = 0x17;
const GENERALIZED_TIME = 0x18;
// 2.5.4.3 (commonName) and 2.5.29.17 (subjectAltName), as DER encodes them
const CN = '550403';
const SAN = '551d11';

const hex = (b: Uint8Array, t: Tlv): string => Array.from(b.subarray(t.start, t.end), (x) => x.toString(16).padStart(2, '0')).join('');
const ascii = (b: Uint8Array, t: Tlv): string => String.fromCharCode(...b.subarray(t.start, t.end));

function text(b: Uint8Array, t: Tlv): string {
  const bytes = b.subarray(t.start, t.end);
  // BMPString: UTF-16, big-endian
  if (t.tag === 0x1e) {
    let s = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
    return s;
  }
  return new TextDecoder().decode(bytes);
}

function time(b: Uint8Array, t: Tlv): Date {
  const s = ascii(b, t);
  // UTCTime YYMMDDHHMMSSZ (years 1950-2049), GeneralizedTime YYYYMMDDHHMMSSZ
  const m = t.tag === UTC_TIME ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : t.tag === GENERALIZED_TIME ? /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s) : null;
  if (m === null) throw new DerError(`bad time ${s}`);
  const [, y = '', mo = '', d = '', h = '', mi = '', sec = ''] = m;
  const year = t.tag === UTC_TIME ? (Number(y) >= 50 ? 1900 : 2000) + Number(y) : Number(y);
  return new Date(Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)));
}

function commonName(b: Uint8Array, name: Tlv): string | undefined {
  // Name: SEQUENCE OF SET OF SEQUENCE { type OID, value }
  for (const rdn of children(b, name)) {
    for (const atv of children(b, rdn)) {
      const [type, value] = children(b, atv);
      if (type?.tag === OID && hex(b, type) === CN && value !== undefined) return text(b, value);
    }
  }
  return undefined;
}

function ipAddress(bytes: Uint8Array): string {
  if (bytes.length === 4) return Array.from(bytes).join('.');
  const groups: number[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) groups.push(((bytes[i] ?? 0) << 8) | (bytes[i + 1] ?? 0));
  // the longest run of two or more zero groups becomes "::" (RFC 5952)
  let best = { at: -1, len: 1 };
  for (let i = 0; i < groups.length; ) {
    let j = i;
    while (groups[j] === 0) j++;
    if (j - i > best.len) best = { at: i, len: j - i };
    i = j === i ? i + 1 : j;
  }
  const part = (g: number[]): string => g.map((x) => x.toString(16)).join(':');
  if (best.at < 0) return part(groups);
  return `${part(groups.slice(0, best.at))}::${part(groups.slice(best.at + best.len))}`;
}

function altNames(b: Uint8Array, extensions: Tlv): string[] {
  const dns: string[] = [];
  const ips: string[] = [];
  for (const ext of children(b, expect(children(b, extensions)[0], SEQUENCE))) {
    const parts = children(b, ext);
    const id = parts[0];
    const value = parts[parts.length - 1];
    if (id?.tag !== OID || hex(b, id) !== SAN || value?.tag !== OCTET_STRING) continue;
    const names = tlv(b, value.start, value.end);
    for (const n of children(b, expect(names, SEQUENCE))) {
      // GeneralName: [2] dNSName, [7] iPAddress
      if (n.tag === 0x82) dns.push(ascii(b, n));
      else if (n.tag === 0x87) ips.push(ipAddress(b.subarray(n.start, n.end)));
    }
  }
  return [...dns, ...ips];
}

/** The certificate in these DER bytes; undefined when they aren't one. */
export function parseCertificate(der: Uint8Array): Certificate | undefined {
  try {
    const cert = expect(tlv(der, 0, der.length), SEQUENCE);
    const tbs = children(der, expect(children(der, cert)[0], SEQUENCE));
    // version is [0], and optional
    const fields = tbs[0]?.tag === 0xa0 ? tbs.slice(1) : tbs;
    const [, , issuer, validity, subject] = fields;
    const [notBefore, notAfter] = children(der, expect(validity, SEQUENCE));
    if (notBefore === undefined || notAfter === undefined) return undefined;
    const extensions = fields.find((f) => f.tag === 0xa3);
    const i = expect(issuer, SEQUENCE);
    const s = expect(subject, SEQUENCE);
    return {
      commonName: commonName(der, s),
      altNames: extensions === undefined ? [] : altNames(der, extensions),
      notBefore: time(der, notBefore),
      notAfter: time(der, notAfter),
      selfSigned: hex(der, i) === hex(der, s),
    };
  } catch (err) {
    if (err instanceof DerError) return undefined;
    throw err;
  }
}

/** Base64 (as the router sends the certificate) to bytes. */
export function fromBase64(b64: string): Uint8Array {
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** A SHA-256 fingerprint as browsers show it: upper-case byte pairs with colons. */
export function formatFingerprint(sha256: string): string {
  return (sha256.toUpperCase().match(/../g) ?? []).join(':');
}
