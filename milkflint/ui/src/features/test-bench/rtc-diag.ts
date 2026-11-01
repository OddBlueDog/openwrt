// What a device-to-device connection saw, in words a report can show: the
// candidates each side offered (by kind, never their addresses, so a
// report holds no public IPs), how far ICE and DTLS got, and, when no
// direct path formed, the likely reasons. Pure, so it's tested without a
// browser; rtc.ts takes the snapshots.
import { z } from 'zod';

/** What an ICE candidate's address is, without the address. */
export type AddressKind = 'mdns' | 'lan' | 'link-local' | 'ula' | 'cgnat' | 'loopback' | 'public' | 'global' | 'hidden';

export function addressKind(address: string | null | undefined): AddressKind {
  const a = (address ?? '').trim().toLowerCase();
  if (a === '') return 'hidden';
  if (a.endsWith('.local')) return 'mdns';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(a);
  if (v4 !== null) {
    const x = Number(v4[1]);
    const y = Number(v4[2]);
    if (x === 10 || (x === 172 && y >= 16 && y < 32) || (x === 192 && y === 168)) return 'lan';
    if (x === 169 && y === 254) return 'link-local';
    // the shared address space: carrier NAT, and VPNs such as Tailscale
    if (x === 100 && y >= 64 && y < 128) return 'cgnat';
    if (x === 127) return 'loopback';
    return 'public';
  }
  if (a.includes(':')) {
    if (a === '::1') return 'loopback';
    if (/^fe[89ab]/.test(a)) return 'link-local';
    if (/^f[cd]/.test(a)) return 'ula';
    return 'global';
  }
  return 'hidden';
}

export interface Candidate {
  /** host, srflx, prflx, relay */
  type: string;
  protocol: 'udp' | 'tcp';
  kind: AddressKind;
}

/** The candidates in an SDP's a=candidate lines (component 1 only), without their addresses. */
export function sdpCandidates(sdp: string | null | undefined): Candidate[] {
  const out: Candidate[] = [];
  for (const line of (sdp ?? '').split(/\r?\n/)) {
    // a=candidate:<foundation> <component> <protocol> <priority> <address> <port> typ <type> ...
    const m = /^a=candidate:\S+ (\d+) (\S+) \d+ (\S+) \d+ typ (\S+)/i.exec(line.trim());
    if (m?.[1] !== '1') continue;
    const protocol = (m[2] ?? '').toLowerCase();
    if (protocol !== 'udp' && protocol !== 'tcp') continue;
    out.push({ type: (m[4] ?? '').toLowerCase(), protocol, kind: addressKind(m[3]) });
  }
  return out;
}

/** "host/udp/mdns" */
export const candidateKey = (c: Candidate): string => `${c.type}/${c.protocol}/${c.kind}`;

/** Candidates counted by candidateKey. */
export function countCandidates(cs: readonly Candidate[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of cs) {
    const k = candidateKey(c);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

const counts = z.record(z.string().max(40), z.number().int().min(0)).refine((r) => Object.keys(r).length <= 32);
const state = z.string().max(24);

/** One side's view of one connection (the probe one, or the bulk one), as recorded. */
export const linkDiagSchema = z.object({
  /** this side made the offer */
  offerer: z.boolean(),
  /** its offer or answer went to the router; the other side's arrived */
  sent: z.boolean(),
  got: z.boolean(),
  /** the connection's states when it was looked at */
  pc: state,
  ice: state,
  gathering: state,
  dtls: state.nullable(),
  /** its candidates and the other side's (from the SDP, plus peer-reflexive ones ICE learned), by candidateKey */
  local: counts,
  remote: counts,
  /** ICE's candidate pairs by state, and its connectivity checks */
  pairs: counts,
  requestsSent: z.number().min(0),
  requestsReceived: z.number().min(0),
  responsesReceived: z.number().min(0),
  /** the path in use: each end's candidateKey, ICE's own RTT (ms) */
  path: z.object({ local: z.string().max(40), remote: z.string().max(40), rtt: z.number().nullable() }).nullable(),
  error: z.string().max(200).nullable(),
  /** ms since this attempt began */
  ms: z.number(),
});
export type LinkDiag = z.output<typeof linkDiagSchema>;

const total = (r: Record<string, number>): number => Object.values(r).reduce((a, b) => a + b, 0);
const only = (r: Record<string, number>, test: (key: string) => boolean): boolean => total(r) > 0 && Object.keys(r).every(test);
const kindOf = (key: string): string => key.split('/')[2] ?? '';
const protocolOf = (key: string): string => key.split('/')[1] ?? '';

const where: Record<string, string> = {
  mdns: 'mDNS name',
  lan: 'LAN',
  'link-local': 'link-local',
  ula: 'IPv6 ULA',
  cgnat: '100.64/10, a VPN?',
  loopback: 'loopback',
  public: 'public address',
  global: 'global IPv6',
};
const typeName: Record<string, string> = { host: 'host', srflx: 'server-reflexive', prflx: 'peer-reflexive', relay: 'relay' };

/** "host (LAN)": a candidate's type, with its kind of address where the browser shows it. */
function endText(key: string): string {
  const [type = '', , kind = ''] = key.split('/');
  const name = typeName[type] ?? type;
  const w = where[kind];
  return w === undefined ? name : `${name} (${w})`;
}

/** "UDP host (mDNS name)": a candidateKey in words. */
export const candidateText = (key: string): string => `${protocolOf(key).toUpperCase()} ${endText(key)}`;

/** "UDP, host (LAN) to peer-reflexive": a path in ICE's terms. */
export function pathText(path: LinkDiag['path']): string {
  if (path === null) return '';
  return `${protocolOf(path.local).toUpperCase()}, ${endText(path.local)} to ${endText(path.remote)}`;
}

/** Whether a path keeps to the home network (no VPN, no public address). */
export function pathIsLocal(path: LinkDiag['path']): boolean {
  if (path === null) return false;
  const ok = new Set(['mdns', 'lan', 'link-local', 'ula', 'hidden']);
  return ok.has(kindOf(path.local)) && ok.has(kindOf(path.remote));
}

export interface Side {
  name: string;
  /** true: Wi-Fi; false: wired; undefined: not known */
  wifi: boolean | undefined;
  /** "Chrome", "Safari"…; "Windows", "macOS"… */
  browser: string;
  os: string;
  /** its last view of the connection; undefined: it never reported one */
  diag: LinkDiag | undefined;
}

/**
 * Why two devices found no direct path, most likely first, from both
 * sides' views. Nothing here is certain: a browser shows only part of what
 * ICE did, so these are the readings the evidence fits.
 */
export function noPathCauses(a: Side, b: Side): string[] {
  const out: string[] = [];
  const da = a.diag;
  const db = b.diag;
  if (da === undefined && db === undefined) {
    return ['Neither device reported on this pair: their pages were hidden, closed or out of reach when it was due.'];
  }
  if (da === undefined || db === undefined) {
    const missing = da === undefined ? a : b;
    out.push(`${missing.name} never reported on this pair: its page may have been hidden, closed or out of reach.`);
  }
  const offer = da?.offerer === true ? { side: a, d: da } : db?.offerer === true ? { side: b, d: db } : undefined;
  const answer = offer?.side === a ? { side: b, d: db } : offer?.side === b ? { side: a, d: da } : undefined;
  if (offer !== undefined && !offer.d.sent) {
    out.push(`${offer.side.name}'s offer never reached the router${offer.d.error !== null ? ` (${offer.d.error})` : ''}.`);
    return out;
  }
  if (answer?.d !== undefined && !answer.d.got) {
    out.push(`The offer didn't reach ${answer.side.name}: it wasn't polling the router in time.`);
    return out;
  }
  if (offer !== undefined && !offer.d.got) {
    const error = answer?.d?.error ?? null;
    out.push(`${answer?.side.name ?? 'The other device'} never answered${error !== null ? ` (${error})` : ''}.`);
    return out;
  }
  for (const [s, d] of [
    [a, da],
    [b, db],
  ] as const) {
    if (d !== undefined && total(d.local) === 0) {
      out.push(`${s.name}'s browser offered no addresses at all: a privacy setting or extension (WebRTC leak protection) blocks it.`);
    }
  }
  if (out.length > 0) return out;
  const views = [da, db].filter((d): d is LinkDiag => d !== undefined);
  // ICE worked, the encryption didn't
  if (views.some((d) => d.ice === 'connected' || d.ice === 'completed') && views.some((d) => d.dtls === 'failed')) {
    out.push('ICE found a path, but the DTLS handshake on it failed.');
    return out;
  }
  const sent = views.reduce((n, d) => n + d.requestsSent, 0);
  const heard = views.reduce((n, d) => n + d.requestsReceived + d.responsesReceived, 0);
  const allMdns = views.length > 0 && views.every((d) => only(d.remote, (k) => kindOf(k) === 'mdns'));
  if (allMdns && sent === 0) {
    out.push(
      "Each side had only the other's .local name, and neither got an address for it: mDNS (multicast) didn't get across between them. A peer-reflexive path needs just one side to resolve the other.",
    );
  } else if (sent > 0 && heard === 0) {
    out.push('Both sides sent connectivity checks, and none arrived: something between them, or on one of them, drops the packets.');
  } else if (sent > 0) {
    for (const [x, y, dx, dy] of [
      [a, b, da, db],
      [b, a, db, da],
    ] as const) {
      if (dx !== undefined && dy !== undefined && dy.requestsReceived > 0 && dx.responsesReceived === 0) {
        out.push(`One way only: ${x.name}'s checks reached ${y.name}, but no replies came back to ${x.name}.`);
      }
    }
  }
  if (a.wifi === true && b.wifi === true) out.push('Both are on Wi-Fi: client isolation on the access point (a guest network has it) keeps Wi-Fi devices apart.');
  for (const s of [a, b]) {
    if (s.os === 'Windows') out.push(`On ${s.name}, Windows Defender Firewall may block the browser's incoming UDP, especially on a network marked Public.`);
  }
  for (const s of [a, b]) {
    if (s.browser === 'Chrome' || s.browser === 'Edge') {
      out.push(`${s.name}'s ${s.browser} may have asked for permission to reach local devices; if that was dismissed, it blocks the connection.`);
    }
  }
  out.push('A VPN on either device can capture its LAN traffic.');
  return out;
}

/** What a connected pair's path means for its figures; empty when there's nothing to say. */
export function pathNotes(path: LinkDiag['path']): string[] {
  if (path === null) return [];
  const out: string[] = [];
  if (protocolOf(path.local) === 'tcp') out.push('Only ICE over TCP connected: TCP resends what is lost, so loss between these two can’t be measured.');
  if (!pathIsLocal(path)) out.push('The path leaves the home network’s addresses (a VPN, or a public address): its figures aren’t the LAN’s.');
  return out;
}
