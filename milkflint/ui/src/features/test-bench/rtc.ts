// Device-to-device tests over WebRTC. For each partner a run pairs this
// member with there are two connections, each signalled through the router
// with one offer and one answer (non-trickle; the lower member id offers).
// There's no STUN or TURN server, so a path is direct on the LAN or there's
// none, and nothing is ever relayed through the router.
// - The probe connection's channel is unordered with no retransmits, so a
//   lost message stays lost. Each side sends ten numbered probes a second
//   and echoes the other's: RTT, and loss each way.
// - The bulk connection's channel is reliable, for throughput.
// Two connections rather than two channels on one: a connection's channels
// share one SCTP association, so probes would wait behind the bulk data
// inside the browser and time that queue instead of the network's.
import { errorMessage } from '@/lib/utils';
import type { Signal } from './api';
import type { Clock } from './clock';
import type { RunRecord } from './member';
import { addressKind, candidateKey, countCandidates, type LinkDiag, sdpCandidates } from './rtc-diag';
import { RECORD_MS } from './wan';

/** Probes to each partner every PROBE_MS; an echo later than PROBE_LOST_MS counts as lost. */
const PROBE_MS = 100;
const PROBE_LOST_MS = 3000;
/** Non-trickle: an offer or answer waits this long at most for ICE to gather its candidates. */
const GATHER_MS = 2000;
/** Bulk messages are at most 64 KB; the browser holds a quarter second of what it sends queued, 256 KB to 4 MB. */
const BULK_MESSAGE = 64 * 1024;
const BULK_MIN = 256 * 1024;
const BULK_MAX = 4 * 1024 * 1024;
const BULK_QUEUE_S = 0.25;
/** An attempt that hasn't opened in this long has stopped negotiating (polls go back to once a second). */
const NEGOTIATE_MS = 15_000;

export type LinkKind = 'p' | 'b';

export interface PeerContext {
  me: string;
  /** the run's tag, in every signal's pair key, so a late signal from another run is ignored */
  tag: string;
  clock: Clock;
  record: (r: RunRecord) => void;
  send: (to: string, pair: string, kind: Signal['kind'], sdp?: string) => Promise<void>;
}

const idNumber = (id: string): number => Number(id.slice(1));

/** The member that makes the offer to the other: the lower id. */
export const offers = (me: string, partner: string): boolean => idNumber(me) < idNumber(partner);

/** The key a signal carries: "<run tag>-<lower id>-<higher id>-<p|b><attempt>" (at most 24 characters, as the router takes it). */
export function pairKey(tag: string, a: string, b: string, kind: LinkKind, attempt: number): string {
  const [lo, hi] = offers(a, b) ? [a, b] : [b, a];
  return `${tag}-${lo}-${hi}-${kind}${String(attempt)}`;
}

export function parsePairKey(key: string): { tag: string; lo: string; hi: string; kind: LinkKind; attempt: number } | undefined {
  const m = /^([0-9a-f]{6})-(m\d+)-(m\d+)-([pb])(\d+)$/.exec(key);
  if (m === null) return undefined;
  return { tag: m[1] ?? '', lo: m[2] ?? '', hi: m[3] ?? '', kind: m[4] === 'p' ? 'p' : 'b', attempt: Number(m[5]) };
}

/** The partners a schedule pairs `me` with, in the order they first appear. */
export function partnersOf(phases: readonly { pair?: readonly string[] | null | undefined }[], me: string): string[] {
  const out: string[] = [];
  for (const p of phases) {
    const [a, b] = p.pair ?? [];
    if (a === undefined || b === undefined) continue;
    const other = a === me ? b : b === me ? a : undefined;
    if (other !== undefined && !out.includes(other)) out.push(other);
  }
  return out;
}

function gathered(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = (): void => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, GATHER_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

/** What getStats reports, as far as this reads it (each browser fills in its own part). */
interface StatsLike {
  id?: string;
  type?: string;
  state?: string;
  selected?: boolean;
  nominated?: boolean;
  dtlsState?: string;
  selectedCandidatePairId?: string;
  localCandidateId?: string;
  remoteCandidateId?: string;
  candidateType?: string;
  protocol?: string;
  address?: string;
  ip?: string;
  requestsSent?: number;
  requestsReceived?: number;
  responsesReceived?: number;
  currentRoundTripTime?: number;
}

/** A diagnosis for a connection that was never made: its offer never came. */
export function noLinkDiag(offerer: boolean): LinkDiag {
  return {
    offerer,
    sent: false,
    got: false,
    pc: 'none',
    ice: 'none',
    gathering: 'none',
    dtls: null,
    local: {},
    remote: {},
    pairs: {},
    requestsSent: 0,
    requestsReceived: 0,
    responsesReceived: 0,
    path: null,
    error: null,
    ms: 0,
  };
}

/** One RTCPeerConnection with its one channel, negotiated (id 0) so neither side waits for the other to announce it. */
class Link {
  readonly kind: LinkKind;
  readonly offerer: boolean;
  readonly key: string;
  readonly attempt: number;
  readonly pc = new RTCPeerConnection({ iceServers: [] });
  readonly channel: RTCDataChannel;
  readonly began = performance.now();
  sent = false;
  got = false;
  error: string | null = null;
  reported: 'open' | 'fail' | undefined;
  closed = false;

  constructor(kind: LinkKind, offerer: boolean, key: string, attempt: number) {
    this.kind = kind;
    this.offerer = offerer;
    this.key = key;
    this.attempt = attempt;
    this.channel = this.pc.createDataChannel(kind === 'p' ? 'probe' : 'bulk', kind === 'p' ? { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 } : { negotiated: true, id: 0 });
    this.channel.binaryType = 'arraybuffer';
  }

  get open(): boolean {
    return !this.closed && this.channel.readyState === 'open';
  }

  close(): void {
    this.closed = true;
    this.pc.close();
  }

  async diag(): Promise<LinkDiag> {
    const pairs: Record<string, number> = {};
    let requestsSent = 0;
    let requestsReceived = 0;
    let responsesReceived = 0;
    let dtls: string | null = null;
    let selectedId: string | undefined;
    const candidates = new Map<string, StatsLike>();
    const candidatePairs: StatsLike[] = [];
    const remote = sdpCandidates(this.pc.remoteDescription?.sdp);
    try {
      const stats = await this.pc.getStats();
      stats.forEach((s: StatsLike) => {
        if (s.type === 'transport') {
          dtls = s.dtlsState ?? dtls;
          selectedId = s.selectedCandidatePairId ?? selectedId;
        } else if (s.type === 'candidate-pair') {
          candidatePairs.push(s);
          const state = s.state ?? 'unknown';
          pairs[state] = (pairs[state] ?? 0) + 1;
          requestsSent += s.requestsSent ?? 0;
          requestsReceived += s.requestsReceived ?? 0;
          responsesReceived += s.responsesReceived ?? 0;
        } else if ((s.type === 'local-candidate' || s.type === 'remote-candidate') && s.id !== undefined) {
          candidates.set(s.id, s);
          // a peer-reflexive candidate: one ICE learned from the other side's checks
          if (s.type === 'remote-candidate' && s.candidateType === 'prflx') {
            remote.push({ type: 'prflx', protocol: s.protocol === 'tcp' ? 'tcp' : 'udp', kind: addressKind(s.address ?? s.ip) });
          }
        }
      });
    } catch {
      // closed meanwhile: what the descriptions say is all there is
    }
    const selected =
      candidatePairs.find((p) => p.id !== undefined && p.id === selectedId) ??
      candidatePairs.find((p) => p.selected === true) ??
      candidatePairs.find((p) => p.nominated === true && p.state === 'succeeded');
    const end = (id: string | undefined): string => {
      const c = id === undefined ? undefined : candidates.get(id);
      if (c === undefined) return 'unknown/udp/hidden';
      return candidateKey({ type: c.candidateType ?? 'unknown', protocol: c.protocol === 'tcp' ? 'tcp' : 'udp', kind: addressKind(c.address ?? c.ip) });
    };
    const rtt = selected?.currentRoundTripTime;
    return {
      offerer: this.offerer,
      sent: this.sent,
      got: this.got,
      pc: this.pc.connectionState,
      ice: this.pc.iceConnectionState,
      gathering: this.pc.iceGatheringState,
      dtls,
      local: countCandidates(sdpCandidates(this.pc.localDescription?.sdp)),
      remote: countCandidates(remote),
      pairs,
      requestsSent,
      requestsReceived,
      responsesReceived,
      path:
        selected === undefined || this.channel.readyState !== 'open'
          ? null
          : { local: end(selected.localCandidateId), remote: end(selected.remoteCandidateId), rtt: rtt === undefined ? null : Math.round(rtt * 10_000) / 10 },
      error: this.error,
      ms: Math.round(performance.now() - this.began),
    };
  }
}

/** This member's two connections with one partner, its probes to it and the bulk data from it. */
class Peer {
  readonly partner: string;
  readonly offerer: boolean;
  private readonly ctx: PeerContext;
  private readonly links: Partial<Record<LinkKind, Link>> = {};
  private readonly attempts: Record<LinkKind, number> = { p: 0, b: 0 };
  /** when this member began expecting the connections (the connect phase) */
  private since: number | undefined;
  // probes: the next number, those awaiting an echo, the partner's that arrived since the last record
  private seq = 0;
  private readonly pending = new Map<number, { local: number; t: number }>();
  private received: number[] = [];
  private recent: number[] = [];
  private probeTimer: ReturnType<typeof setInterval> | undefined;
  // bulk data from the partner: since the last record, and per record for the live rate
  private rx = 0;
  private rxRecent: number[] = [];

  constructor(ctx: PeerContext, partner: string) {
    this.ctx = ctx;
    this.partner = partner;
    this.offerer = offers(ctx.me, partner);
  }

  get open(): boolean {
    return this.links.p?.open === true && this.links.b?.open === true;
  }

  /** Still setting up: an attempt that began less than NEGOTIATE_MS ago and hasn't opened. */
  get negotiating(): boolean {
    return !this.open && this.since !== undefined && performance.now() - this.since < NEGOTIATE_MS;
  }

  /** A connect phase: the offering side starts a new attempt for each connection not open; the answering side expects offers. */
  connect(): void {
    if (this.open) return;
    this.since = performance.now();
    if (!this.offerer) return;
    for (const kind of ['p', 'b'] as const) {
      if (this.links[kind]?.open === true) continue;
      this.links[kind]?.close();
      const attempt = ++this.attempts[kind];
      const link = this.newLink(kind, true, pairKey(this.ctx.tag, this.ctx.me, this.partner, kind, attempt), attempt);
      void this.offer(link);
    }
  }

  onSignal(kind: LinkKind, attempt: number, s: Signal): void {
    const current = this.links[kind];
    if (s.kind === 'offer' && !this.offerer) {
      // a repeat, or an older attempt's offer arriving late
      if (current !== undefined && current.attempt >= attempt) return;
      current?.close();
      void this.answer(this.newLink(kind, false, s.pair, attempt), s.sdp ?? '');
    } else if (s.kind === 'answer' && this.offerer) {
      if (current?.key !== s.pair || current.pc.signalingState !== 'have-local-offer') return;
      current.got = true;
      current.pc.setRemoteDescription({ type: 'answer', sdp: s.sdp ?? '' }).catch((err: unknown) => {
        this.failed(current, err);
      });
    } else if (s.kind === 'bye' && current?.key === s.pair) {
      current.close();
    }
  }

  private newLink(kind: LinkKind, offerer: boolean, key: string, attempt: number): Link {
    const link = new Link(kind, offerer, key, attempt);
    this.links[kind] = link;
    link.channel.addEventListener('open', () => {
      this.onOpen(link);
    });
    link.channel.addEventListener('message', (e: MessageEvent) => {
      if (kind === 'p') this.onProbe(link, e.data);
      else if (e.data instanceof ArrayBuffer) this.rx += e.data.byteLength;
    });
    const watch = (): void => {
      if (link.pc.connectionState === 'failed' || link.pc.iceConnectionState === 'failed') void this.report(link, 'fail');
    };
    link.pc.addEventListener('connectionstatechange', watch);
    link.pc.addEventListener('iceconnectionstatechange', watch);
    return link;
  }

  private async offer(link: Link): Promise<void> {
    try {
      await link.pc.setLocalDescription(await link.pc.createOffer());
      await gathered(link.pc);
      if (link.closed) return;
      await this.ctx.send(this.partner, link.key, 'offer', link.pc.localDescription?.sdp);
      link.sent = true;
    } catch (err) {
      this.failed(link, err);
    }
  }

  private async answer(link: Link, sdp: string): Promise<void> {
    try {
      await link.pc.setRemoteDescription({ type: 'offer', sdp });
      link.got = true;
      await link.pc.setLocalDescription(await link.pc.createAnswer());
      await gathered(link.pc);
      if (link.closed) return;
      await this.ctx.send(this.partner, link.key, 'answer', link.pc.localDescription?.sdp);
      link.sent = true;
    } catch (err) {
      this.failed(link, err);
    }
  }

  private failed(link: Link, err: unknown): void {
    if (link.closed) return;
    link.error = errorMessage(err).slice(0, 200);
    void this.report(link, 'fail');
  }

  /** Records this side's view of a connection: open, failed (also after it opened: it dropped), or not open yet when its connect phase ended ('wait'). */
  private async report(link: Link, event: 'open' | 'fail' | 'wait'): Promise<void> {
    if (event === 'wait' ? link.reported !== undefined : link.reported === event || (event === 'open' && link.reported === 'fail')) return;
    if (event !== 'wait') link.reported = event;
    const d = await link.diag();
    const t = this.ctx.clock.router();
    if (t !== undefined) this.ctx.record(['peer', Math.round(t), this.partner, link.kind, event, d]);
  }

  private onOpen(link: Link): void {
    if (link.closed) return;
    void this.report(link, 'open');
    if (link.kind !== 'p') return;
    if (this.probeTimer !== undefined) clearInterval(this.probeTimer);
    this.probeTimer = setInterval(() => {
      this.sendProbe(link);
    }, PROBE_MS);
  }

  private sendProbe(link: Link): void {
    const now = performance.now();
    for (const [n, p] of this.pending) {
      if (now - p.local < PROBE_LOST_MS) continue;
      this.pending.delete(n);
      this.ctx.record(['pp', this.partner, n, p.t, null]);
    }
    const t = this.ctx.clock.router(now);
    if (!link.open || t === undefined) return;
    const n = this.seq++;
    try {
      link.channel.send(`p${String(n)}`);
      this.pending.set(n, { local: now, t: Math.round(t) });
    } catch {
      // closing: not sent, so not counted
    }
  }

  private onProbe(link: Link, data: unknown): void {
    if (typeof data !== 'string') return;
    const n = Number(data.slice(1));
    if (!Number.isSafeInteger(n) || n < 0) return;
    if (data.startsWith('p')) {
      this.received.push(n);
      try {
        link.channel.send(`e${String(n)}`);
      } catch {
        // closing
      }
    } else if (data.startsWith('e')) {
      const p = this.pending.get(n);
      if (p === undefined) return;
      this.pending.delete(n);
      const ms = Math.round((performance.now() - p.local) * 100) / 100;
      this.ctx.record(['pp', this.partner, n, p.t, ms]);
      this.recent.push(ms);
      if (this.recent.length > 8) this.recent.shift();
    }
  }

  /** The connect phase is over: a record of each connection that isn't open, with what this side saw. */
  async snapshot(): Promise<void> {
    for (const kind of ['p', 'b'] as const) {
      const link = this.links[kind];
      if (link === undefined) {
        const t = this.ctx.clock.router();
        if (t !== undefined) this.ctx.record(['peer', Math.round(t), this.partner, kind, 'wait', noLinkDiag(this.offerer)]);
      } else if (!link.open && link.reported === undefined) {
        await this.report(link, 'wait');
      }
    }
  }

  /** Sends bulk data to the partner until `signal` aborts; false: the bulk connection isn't open. */
  bulk(signal: AbortSignal): boolean {
    const link = this.links.b;
    if (link?.open !== true) return false;
    const ch = link.channel;
    const most = link.pc.sctp?.maxMessageSize ?? 0;
    const size = most > 0 ? Math.min(BULK_MESSAGE, most) : BULK_MESSAGE;
    const chunk = new Uint8Array(size);
    let queued = 0;
    let mark = { at: performance.now(), drained: 0 };
    let rate = 0;
    const fill = (): void => {
      if (signal.aborted || ch.readyState !== 'open') return;
      const now = performance.now();
      const drained = queued - ch.bufferedAmount;
      if (now - mark.at >= 250) {
        rate = ((drained - mark.drained) * 1000) / (now - mark.at);
        mark = { at: now, drained };
      }
      // queued in the browser, not the network: enough to keep the line busy, little left over when the phase ends
      const ceiling = Math.min(BULK_MAX, Math.max(BULK_MIN, rate * BULK_QUEUE_S));
      ch.bufferedAmountLowThreshold = ceiling / 2;
      try {
        while (ch.bufferedAmount < ceiling) {
          ch.send(chunk);
          queued += size;
        }
      } catch {
        // the browser's queue is full or the channel is closing: the next low-water event tries again
      }
    };
    ch.addEventListener('bufferedamountlow', fill);
    signal.addEventListener(
      'abort',
      () => {
        ch.removeEventListener('bufferedamountlow', fill);
      },
      { once: true },
    );
    fill();
    return true;
  }

  /** Every RECORD_MS: the bulk bytes that arrived; every second, the partner's probes that did. */
  flush(t: number, second: boolean): void {
    this.rxRecent.push(this.rx);
    if (this.rxRecent.length > 4) this.rxRecent.shift();
    if (this.rx > 0) this.ctx.record(['pb', this.partner, Math.round(t), this.rx]);
    this.rx = 0;
    if (second && this.received.length > 0) {
      this.ctx.record(['pr', this.partner, Math.round(t), this.received]);
      this.received = [];
    }
  }

  /** The last probes' RTTs, ms, and the bulk data arriving, Mbit/s over the last second. */
  live(): { rtts: number[]; mbit: number } {
    const bytes = this.rxRecent.reduce((a, b) => a + b, 0);
    return { rtts: this.recent, mbit: this.rxRecent.length === 0 ? 0 : (bytes * 8) / ((this.rxRecent.length * RECORD_MS) / 1000) / 1e6 };
  }

  close(): void {
    if (this.probeTimer !== undefined) clearInterval(this.probeTimer);
    this.probeTimer = undefined;
    this.pending.clear();
    for (const link of Object.values(this.links)) link.close();
  }
}

/** This member's connections in a run: one Peer per partner. */
export class Peers {
  private readonly ctx: PeerContext;
  private readonly peers = new Map<string, Peer>();
  private readonly timer: ReturnType<typeof setInterval>;
  private ticks = 0;

  constructor(ctx: PeerContext, partners: readonly string[]) {
    this.ctx = ctx;
    for (const p of partners) this.peers.set(p, new Peer(ctx, p));
    this.timer = setInterval(() => {
      const t = ctx.clock.router();
      this.ticks++;
      if (t === undefined) return;
      for (const p of this.peers.values()) p.flush(t, this.ticks % Math.round(1000 / RECORD_MS) === 0);
    }, RECORD_MS);
  }

  /** A signal from the router: this run's, from a partner, about a pair with this member. */
  onSignal(s: Signal): void {
    const k = parsePairKey(s.pair);
    if (k?.tag !== this.ctx.tag) return;
    const ends = [k.lo, k.hi];
    if (!ends.includes(this.ctx.me) || !ends.includes(s.from)) return;
    this.peers.get(s.from)?.onSignal(k.kind, k.attempt, s);
  }

  connect(): void {
    for (const p of this.peers.values()) p.connect();
  }

  snapshot(): void {
    for (const p of this.peers.values()) void p.snapshot();
  }

  isOpen(partner: string): boolean {
    return this.peers.get(partner)?.open === true;
  }

  bulk(partner: string, signal: AbortSignal): boolean {
    return this.peers.get(partner)?.bulk(signal) ?? false;
  }

  get negotiating(): boolean {
    return [...this.peers.values()].some((p) => p.negotiating);
  }

  /** For the bench's live figures: the median peer RTT (ms), bulk data arriving (Mbit/s), partners open and planned. */
  liveFigures(): { p?: number; x?: number; o: number; k: number } {
    const rtts: number[] = [];
    let mbit = 0;
    let open = 0;
    for (const p of this.peers.values()) {
      const l = p.live();
      rtts.push(...l.rtts);
      mbit += l.mbit;
      if (p.open) open++;
    }
    const out: { p?: number; x?: number; o: number; k: number } = { o: open, k: this.peers.size };
    if (rtts.length > 0) {
      rtts.sort((a, b) => a - b);
      out.p = Math.round((rtts[Math.floor(rtts.length / 2)] ?? 0) * 10) / 10;
    }
    if (mbit > 0) out.x = Math.round(mbit * 10) / 10;
    return out;
  }

  /** The run's over: what arrived since the last record goes on record too, then every connection closes. */
  close(): void {
    clearInterval(this.timer);
    const t = this.ctx.clock.router();
    for (const p of this.peers.values()) {
      if (t !== undefined) p.flush(t, true);
      p.close();
    }
  }
}
