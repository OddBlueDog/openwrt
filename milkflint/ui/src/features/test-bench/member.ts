// This tab as a member of the open test bench: it joins (the QR code's
// token, the typed code, or its own key when it comes back), polls the
// bench once a second, keeps its clock in step with the router's, and runs
// its part of each run at the scheduled moments. One per tab: its identity
// lives in sessionStorage, so two tabs are two members.
import { useSyncExternalStore } from 'react';
import { UbusError, UbusStatus, UnreachableError } from '@/lib/ubus';
import { errorMessage } from '@/lib/utils';
import {
  BenchError,
  join,
  type JoinWith,
  leave,
  type LiveFigures,
  poll,
  type Poll,
  report,
  type Run,
  type Schedule,
  sendSignal,
  type Signal,
  stopRun,
  sync,
} from './api';
import { Clock, type ClockEstimate } from './clock';
import { pageRounds, siteList } from './pages';
import { internetProbe, probe, routerProbe } from './probes';
import { partnersOf, Peers } from './rtc';
import type { LinkDiag } from './rtc-diag';
import { parseAgent } from './ua';
import { download, Meter, RECORD_MS, upload } from './wan';

const STORAGE_KEY = 'milkflint.bench.member';

/** Polls: every second; every 5 s while the tab is hidden and no run is on; four a second while WebRTC signals are on their way. */
export const POLL_MS = 1000;
const HIDDEN_POLL_MS = 5000;
const SIGNAL_POLL_MS = 250;
/** A member that hasn't reached the router for this long stops its part of a run. */
export const LOST_MS = 5000;
/** Results go to the router this often during a run, at most REPORT_CHARS of JSON at a time. */
const REPORT_MS = 2000;
const REPORT_CHARS = 30_000;
/** Clock syncs: a burst on joining and before a run starts, a few every 20 s during it, two a minute otherwise. */
const SYNC_BURST = 8;
const SYNC_RUN = 4;
const SYNC_RUN_MS = 20_000;
const SYNC_IDLE_MS = 30_000;

/** What a member records during a run, sent to the router as compact arrays. */
export type RunRecord =
  /** a phase started: its index, when it should have (router ms), when it did, the clock's uncertainty (ms) */
  | ['mark', number, number, number, number]
  /** the clock sync during the run: router ms, offset, uncertainty */
  | ['clock', number, number, number]
  /** the page was hidden or shown again; the router couldn't be reached, or could again */
  | ['hidden' | 'visible' | 'lost' | 'found', number]
  /** the member's part ended: router ms, why */
  | ['end', number, string]
  /** a latency probe to the router (r) or the internet (w): its number, when it went (router ms), its time (ms; null: no answer in time) */
  | ['rtt', 'r' | 'w', number, number, number | null]
  /** bytes downloaded (d) or uploaded (u) in the RECORD_MS before router ms t */
  | ['tp', 'd' | 'u', number, number]
  /** Cloudflare's server's view of a finished transfer: router ms, its RTT and lowest RTT (ms), retransmits, lost packets */
  | ['cf', number, number, number, number, number]
  /** a load that failed (router ms, what happened); the data budget was used up (router ms, bytes) */
  | ['err', number, string]
  | ['budget', number, number]
  /** a connection with a partner ('p': the probe one, 'b': the bulk one) opened, failed, or wasn't open yet when its connect phase ended: router ms, what this side saw */
  | ['peer', number, string, 'p' | 'b', 'open' | 'fail' | 'wait', LinkDiag]
  /** a probe to a partner: its number, when it went (router ms), its RTT (ms; null: no echo in time) */
  | ['pp', string, number, number, number | null]
  /** the numbers of a partner's probes that arrived in the second before router ms t */
  | ['pr', string, number, number[]]
  /** bulk bytes that arrived from a partner in the RECORD_MS before router ms t */
  | ['pb', string, number, number]
  /** a made-up name under a site, fetched: when (router ms), how long until it failed, or got an answer (ms; null: gave up) */
  | ['cold', string, number, number | null, 'failed' | 'answered' | 'timeout']
  /** a site's page fetched, the run's first time from this device or a repeat: when, its time (ms; null: it failed) */
  | ['page', string, number, number | null, 'first' | 'repeat'];

interface Stored {
  bench: string;
  member: string;
  key: string;
  sid: string;
}

export type MemberStatus = 'out' | 'joining' | 'in' | 'closed';

export interface MemberState {
  status: MemberStatus;
  /** why it's out or closed, or the last join failure */
  error: string | undefined;
  bench: string | undefined;
  me: string | undefined;
  /** the last poll's answer */
  poll: Poll | undefined;
  /** the last poll failed: why (the bench shows what it had) */
  pollError: string | undefined;
  clock: ClockEstimate | undefined;
  /** the run this member has armed, its schedule, and the phase it's in (-1: none) */
  run: Run | undefined;
  schedule: Schedule | undefined;
  phase: number;
  /** its part of the run is over (or never began): why */
  ended: string | undefined;
}

function readStored(): Stored | undefined {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return undefined;
    const v = JSON.parse(raw) as Partial<Stored>;
    if (typeof v.bench === 'string' && typeof v.member === 'string' && typeof v.key === 'string' && typeof v.sid === 'string') {
      return { bench: v.bench, member: v.member, key: v.key, sid: v.sid };
    }
  } catch {
    // storage blocked or corrupt
  }
  return undefined;
}

function writeStored(s: Stored | undefined): void {
  try {
    if (s === undefined) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // the member just won't survive a reload
  }
}

/** The device's kind, for the router's first guess at a name. */
export function platformLabel(): string {
  return parseAgent(navigator.userAgent, navigator.maxTouchPoints > 1).label;
}

/** The session's gone (the bench closed, rpcd restarted, a long sleep): rejoining with the key may still work. */
function sessionGone(err: unknown): boolean {
  return (err instanceof UbusError && err.code === UbusStatus.permissionDenied) || (err instanceof BenchError && err.message === 'not a member');
}

const visible = (): boolean => typeof document === 'undefined' || document.visibilityState === 'visible';

export class BenchMember {
  private state: MemberState = {
    status: 'out',
    error: undefined,
    bench: undefined,
    me: undefined,
    poll: undefined,
    pollError: undefined,
    clock: undefined,
    run: undefined,
    schedule: undefined,
    phase: -1,
    ended: undefined,
  };
  private stored: Stored | undefined = readStored();
  private readonly listeners = new Set<() => void>();
  readonly clock = new Clock();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastOk = 0;
  private lastSync = 0;
  private signalsSeen = 0;
  // the armed run
  private phaseTimers: ReturnType<typeof setTimeout>[] = [];
  private abort: AbortController | undefined;
  private records: RunRecord[] = [];
  private seq = 0;
  private reportTimer: ReturnType<typeof setInterval> | undefined;
  private reporting = false;
  private lost = false;
  // the run's loads: the current phase's, what they moved, and whether the data budget is spent
  private loads: AbortController | undefined;
  private meter = new Meter();
  private meterTimer: ReturnType<typeof setInterval> | undefined;
  private budgetHit = false;
  private liveRtt: { r: number[]; w: number[] } = { r: [], w: [] };
  // DNS and pages: the sites this member has fetched in the run, and the last times, for the live figures
  private loaded = new Set<string>();
  private livePages: { page: number[]; lookup: number[] } = { page: [], lookup: [] };
  // device to device: this run's connections, and signals that came before them
  private peers: Peers | undefined;
  private early: Signal[] = [];

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.onVisibility();
      });
    }
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): MemberState => this.state;

  private set(patch: Partial<MemberState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** The member's session, for its calls; undefined while it's out. */
  get session(): string | undefined {
    return this.state.status === 'in' ? this.stored?.sid : undefined;
  }

  /** Whether this tab already belongs to `bench` (from before a reload): then resume() joins it again. */
  remembers(bench: string): boolean {
    return this.stored?.bench === bench;
  }

  /** Join with a token or code. */
  async join(how: JoinWith, name?: string): Promise<void> {
    this.set({ status: 'joining', error: undefined });
    try {
      const j = await join(how, name, platformLabel());
      this.stored = { bench: j.bench, member: j.member, key: j.key, sid: j.sid };
      writeStored(this.stored);
      this.set({ status: 'in', bench: j.bench, me: j.member, error: undefined, poll: undefined, pollError: undefined });
      await this.syncBurst(SYNC_BURST);
      this.schedule(0);
    } catch (err) {
      this.set({ status: 'out', error: errorMessage(err) });
      throw err;
    }
  }

  /** Join again as the member this tab was (after a reload); false: it can't. */
  async resume(): Promise<boolean> {
    if (this.state.status === 'in' || this.state.status === 'joining') return true;
    return this.rejoin();
  }

  /** Join again with this member's key (a reload, an expired session, rpcd restarted). */
  private async rejoin(): Promise<boolean> {
    const s = this.stored;
    if (s === undefined) return false;
    this.set({ status: 'joining', error: undefined });
    try {
      const j = await join({ member: s.member, key: s.key });
      this.stored = { ...s, sid: j.sid };
      writeStored(this.stored);
      this.set({ status: 'in', bench: j.bench, me: j.member });
      await this.syncBurst(SYNC_BURST);
      this.schedule(0);
      return true;
    } catch (err) {
      if (err instanceof UnreachableError) {
        this.set({ status: 'out', error: errorMessage(err) });
        return false;
      }
      this.forget(errorMessage(err));
      return false;
    }
  }

  /** Leave the bench (the router ends this member's session). */
  async leave(): Promise<void> {
    const sid = this.session;
    this.endPart('left the bench');
    this.forget(undefined, 'out');
    if (sid !== undefined) await leave(sid).catch(() => undefined);
  }

  /** Stop the run, for every member. */
  async stop(): Promise<void> {
    const sid = this.session;
    if (sid !== undefined) await stopRun(sid);
    this.schedule(0);
  }

  private forget(why: string | undefined, status: MemberStatus = 'closed'): void {
    this.endPart(why);
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
    this.stored = undefined;
    writeStored(undefined);
    this.set({ status, error: why, me: undefined, poll: undefined, pollError: undefined });
  }

  private schedule(ms: number): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.tick(), ms);
  }

  private async syncBurst(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const sid = this.session;
      if (sid === undefined) return;
      const sent = performance.now();
      try {
        const router = await sync(sid);
        this.clock.add({ sent, received: performance.now(), router });
      } catch {
        return;
      }
    }
    this.lastSync = performance.now();
    this.set({ clock: this.clock.estimate });
    const c = this.clock.estimate;
    const t = this.clock.router();
    if (this.abort !== undefined && c !== undefined && t !== undefined) this.records.push(['clock', t, c.offset, c.uncertainty]);
  }

  private runActive(): boolean {
    const s = this.state.poll?.run?.state;
    return s === 'scheduled' || s === 'running';
  }

  private async tick(): Promise<void> {
    const sid = this.session;
    if (sid === undefined) return;
    const now = performance.now();
    const phase = this.state.phase;
    const label = this.state.schedule?.phases[phase]?.label;
    try {
      const p = await poll(sid, {
        run: this.state.run?.id ?? '',
        signals: this.signalsSeen,
        visible: visible(),
        clockUs: (this.clock.estimate?.uncertainty ?? 0) * 1000,
        phase,
        note: label ?? (this.abort !== undefined ? 'Waiting for the run to start' : ''),
        live: this.abort !== undefined ? this.liveFigures() : {},
      });
      this.lastOk = performance.now();
      if (this.lost) {
        this.lost = false;
        const t = this.clock.router();
        if (t !== undefined && this.abort !== undefined) this.records.push(['found', t]);
      }
      const last = p.signals[p.signals.length - 1];
      if (last !== undefined) this.signalsSeen = last.n;
      this.set({ poll: p, pollError: undefined, me: p.me });
      this.onRun(p);
      for (const sig of p.signals) {
        if (this.peers !== undefined) this.peers.onSignal(sig);
        else if (this.early.length < 32) this.early.push(sig);
      }
    } catch (err) {
      if (sessionGone(err)) {
        if (!(await this.rejoin())) {
          this.endPart('this device is no longer on the bench');
          return;
        }
      } else {
        this.set({ pollError: errorMessage(err) });
        if (this.abort !== undefined && !this.lost && now - this.lastOk > LOST_MS) {
          this.lost = true;
          // out of reach: its loads stop, as the router can't stop them
          this.stopLoads();
          const t = this.clock.router();
          if (t !== undefined) this.records.push(['lost', t]);
        }
      }
    }
    const since = performance.now() - this.lastSync;
    if (this.runActive() ? since > SYNC_RUN_MS : since > SYNC_IDLE_MS) await this.syncBurst(this.runActive() ? SYNC_RUN : 2);
    this.schedule(
      this.peers?.negotiating === true ? SIGNAL_POLL_MS : visible() || this.runActive() || this.abort !== undefined ? POLL_MS : HIDDEN_POLL_MS,
    );
  }

  // ---- The run ----

  private onRun(p: Poll): void {
    const r = p.run ?? undefined;
    const mine = this.state.run;
    if (r === undefined) {
      if (mine !== undefined) this.endPart('the run is gone');
      return;
    }
    if (mine?.id !== r.id) {
      if (r.state === 'scheduled' || r.state === 'running') {
        if (r.schedule !== undefined && r.schedule !== null) this.arm(r, r.schedule);
        // else: the next poll asks for the schedule (run '' isn't this one)
        else this.set({ run: undefined });
      } else if (r.schedule !== undefined && r.schedule !== null) {
        // a run that's over (this page opened since): its results, nothing to run
        this.set({ run: r, schedule: r.schedule, phase: -1 });
      }
      return;
    }
    this.set({ run: { ...r, schedule: mine.schedule } });
    if (r.state !== 'scheduled' && r.state !== 'running' && this.abort !== undefined) {
      this.endPart(r.ended?.reason ?? (r.stop !== undefined && r.stop !== null ? `stopped by ${r.stop.by}` : 'the run ended'));
    }
  }

  private arm(r: Run, s: Schedule): void {
    this.endPart(undefined);
    this.abort = new AbortController();
    this.records = [];
    this.seq = 0;
    this.lost = false;
    this.budgetHit = false;
    this.meter = new Meter(s.options.budget_mb * 1_000_000, () => {
      this.onBudget();
    });
    this.liveRtt = { r: [], w: [] };
    this.loaded = new Set();
    this.livePages = { page: [], lookup: [] };
    const me = this.state.me;
    const partners = s.dry || me === undefined ? [] : partnersOf(s.phases, me);
    if (me !== undefined && partners.length > 0) {
      this.peers = new Peers(
        {
          me,
          tag: r.id.slice(0, 6),
          clock: this.clock,
          record: (rec) => {
            this.records.push(rec);
          },
          send: async (to, pair, kind, sdp) => {
            const sid = this.session;
            if (sid === undefined) throw new Error('not on the bench');
            await sendSignal(sid, to, pair, kind, sdp);
          },
        },
        partners,
      );
      for (const sig of this.early) this.peers.onSignal(sig);
    }
    this.early = [];
    // every probe and load leaves a Resource Timing entry; the default buffer holds 250
    performance.clearResourceTimings();
    performance.setResourceTimingBufferSize(20_000);
    this.set({ run: r, schedule: s, phase: -1, ended: undefined });
    void this.syncBurst(SYNC_BURST).then(() => {
      this.armTimers(r, s);
    });
    this.reportTimer = setInterval(() => void this.flush(), REPORT_MS);
    this.meterTimer = setInterval(() => {
      this.onMeter();
    }, RECORD_MS);
    if (!visible()) this.onVisibility();
  }

  private armTimers(r: Run, s: Schedule): void {
    if (this.abort === undefined || this.state.run?.id !== r.id) return;
    const at = (routerMs: number): number => Math.max(0, (this.clock.local(routerMs) ?? performance.now()) - performance.now());
    if (!s.dry) {
      this.phaseTimers.push(
        setTimeout(() => {
          this.startProbes(s);
        }, at(r.t0)),
      );
    }
    s.phases.forEach((p, i) => {
      this.phaseTimers.push(
        setTimeout(() => {
          this.enterPhase(r, s, i);
        }, at(r.t0 + p.start)),
      );
      // each phase's loads stop at its end, whatever else happens
      this.phaseTimers.push(
        setTimeout(() => {
          this.stopLoads();
        }, at(r.t0 + p.start + p.dur)),
      );
      // what still isn't connected when a connect phase ends goes on record, with what this side saw
      if (p.kind === 'connect' && this.peers !== undefined) {
        this.phaseTimers.push(
          setTimeout(
            () => {
              this.peers?.snapshot();
            },
            at(r.t0 + p.start + p.dur - 250),
          ),
        );
      }
    });
    this.phaseTimers.push(
      setTimeout(() => {
        this.endPart('completed');
      }, at(r.t0 + s.length)),
    );
  }

  /** Latency to the router and the internet, through the whole run. */
  private startProbes(s: Schedule): void {
    const signal = this.abort?.signal;
    if (signal === undefined) return;
    const record = (rec: RunRecord): void => {
      this.records.push(rec);
    };
    const keep = (k: 'r' | 'w') => (ms: number) => {
      const list = this.liveRtt[k];
      list.push(ms);
      if (list.length > 8) list.shift();
    };
    void probe(routerProbe(), this.clock, signal, record, keep('r'));
    void probe(internetProbe(s.options.latency), this.clock, signal, record, keep('w'));
  }

  private enterPhase(r: Run, s: Schedule, i: number): void {
    const p = s.phases[i];
    const t = this.clock.router();
    if (p === undefined || t === undefined || this.abort === undefined) return;
    this.records.push(['mark', i, r.t0 + p.start, t, this.clock.estimate?.uncertainty ?? 0]);
    this.set({ phase: i });
    this.stopLoads();
    // a rehearsal only marks the phase; DNS comes with its own kind
    const me = this.state.me;
    const role = me === undefined ? undefined : p.roles[me];
    if (s.dry || me === undefined) return;
    if (p.kind === 'connect') {
      this.peers?.connect();
      return;
    }
    // loads (to the internet, or to a partner) run only while the page is shown and reaches the router
    if (!visible() || this.lost) return;
    const loads = new AbortController();
    this.loads = loads;
    const signal = AbortSignal.any([this.abort.signal, loads.signal]);
    const [a, b] = p.pair ?? [];
    if (a !== undefined && b !== undefined && (a === me || b === me)) {
      const sends = p.dir === 'both' || (p.dir === 'ba' ? b === me : a === me);
      if (sends) this.peers?.bulk(a === me ? b : a, signal);
    }
    const record = (rec: RunRecord): void => {
      this.records.push(rec);
    };
    if (role === 'dns' || role === 'pages') {
      void pageRounds(siteList(s.options.custom_sites), this.clock, signal, record, this.loaded, (kind, ms) => {
        const list = this.livePages[kind];
        list.push(ms);
        if (list.length > 10) list.shift();
      });
    }
    const down = role === 'down' || role === 'both';
    const up = role === 'up' || role === 'both';
    if ((!down && !up) || this.budgetHit) return;
    const n = p.streams ?? 4;
    const endpoint = s.options.endpoint;
    for (let k = 0; k < n; k++) {
      if (down) void download(endpoint, this.meter, this.clock, signal, record);
      if (up) void upload(endpoint, this.meter, this.clock, signal, record);
    }
  }

  private stopLoads(): void {
    this.loads?.abort();
    this.loads = undefined;
  }

  /** Every RECORD_MS: the bytes moved since the last time. */
  private onMeter(): void {
    const t = this.clock.router();
    if (t === undefined) return;
    this.meter.flush(t, (rec) => {
      this.records.push(rec);
    });
  }

  /** The data budget is spent: the loads stop for the rest of the run. */
  private onBudget(): void {
    this.budgetHit = true;
    this.stopLoads();
    const t = this.clock.router();
    if (t !== undefined) this.records.push(['budget', Math.round(t), this.meter.total]);
  }

  /** What this member measures now, for the bench's live figures: median of the last probes, ms; Mbit/s; peers open of planned. */
  liveFigures(): LiveFigures {
    const med = (v: number[]): number | undefined => {
      if (v.length === 0) return undefined;
      const s = [...v].sort((a, b) => a - b);
      return Math.round((s[Math.floor(s.length / 2)] ?? 0) * 10) / 10;
    };
    const out: LiveFigures = this.peers?.liveFigures() ?? {};
    const g = med(this.livePages.page);
    const l = med(this.livePages.lookup);
    if (g !== undefined) out.g = g;
    if (l !== undefined) out.l = l;
    const r = med(this.liveRtt.r);
    const w = med(this.liveRtt.w);
    if (r !== undefined) out.r = r;
    if (w !== undefined) out.w = w;
    const d = this.meter.rate('d');
    const u = this.meter.rate('u');
    if (d > 0) out.d = Math.round(d * 10) / 10;
    if (u > 0) out.u = Math.round(u * 10) / 10;
    return out;
  }

  /** This member's part of the run is over: stop everything it runs and send what it still holds. */
  private endPart(why: string | undefined): void {
    for (const t of this.phaseTimers) clearTimeout(t);
    this.phaseTimers = [];
    this.stopLoads();
    this.peers?.close();
    this.peers = undefined;
    if (this.abort === undefined) return;
    this.abort.abort();
    this.abort = undefined;
    if (this.reportTimer !== undefined) clearInterval(this.reportTimer);
    this.reportTimer = undefined;
    if (this.meterTimer !== undefined) clearInterval(this.meterTimer);
    this.meterTimer = undefined;
    const t = this.clock.router();
    if (t !== undefined) {
      this.meter.flush(t, (rec) => {
        this.records.push(rec);
      });
      if (why !== undefined) this.records.push(['end', t, why]);
    }
    this.liveRtt = { r: [], w: [] };
    this.livePages = { page: [], lookup: [] };
    this.set({ phase: -1, ended: why });
    void this.flush();
  }

  private onVisibility(): void {
    if (this.abort === undefined) {
      if (visible() && this.session !== undefined) this.schedule(0);
      return;
    }
    // a hidden page's timers slow down and a phone's stop: its loads stop, so nothing runs on unchecked
    if (!visible()) this.stopLoads();
    const t = this.clock.router();
    if (t !== undefined) this.records.push([visible() ? 'visible' : 'hidden', t]);
  }

  /** Send the records held, in reports of at most REPORT_CHARS; what fails stays for the next try. */
  private async flush(): Promise<void> {
    const sid = this.session;
    const run = this.state.run?.id;
    if (this.reporting || sid === undefined || run === undefined || this.records.length === 0) return;
    this.reporting = true;
    try {
      while (this.records.length > 0) {
        let n = 0;
        let size = 2;
        while (n < this.records.length && (n === 0 || size + JSON.stringify(this.records[n]).length + 1 <= REPORT_CHARS)) {
          size += JSON.stringify(this.records[n]).length + 1;
          n++;
        }
        await report(sid, run, this.seq, this.records.slice(0, n));
        this.records.splice(0, n);
        this.seq++;
      }
    } catch (err) {
      // the run is over at the router: what's left can't go anywhere
      if (err instanceof BenchError) this.records = [];
    } finally {
      this.reporting = false;
    }
  }
}

let instance: BenchMember | undefined;

/** This tab's member (one per tab). */
export function benchMember(): BenchMember {
  instance ??= new BenchMember();
  return instance;
}

export function useMember(m: BenchMember): MemberState {
  return useSyncExternalStore(m.subscribe, m.getState);
}
