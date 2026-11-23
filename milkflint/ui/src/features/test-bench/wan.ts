// A member's internet loads: downloads and uploads that fill the line
// through Smart Queue, from and to Cloudflare's speed test (it allows
// other pages to use it, CORS and timing both, and is near everyone), or
// in development the UI's own dev server. Each stream fetches in chunks
// until its phase ends; the bytes are counted as they arrive (downloads,
// read as a stream) or leave (uploads, XHR's progress events: fetch has
// none), in RECORD_MS buckets. Cloudflare's answers carry its server's own
// view of the connection (Server-Timing cfL4: its RTT, retransmits and
// lost packets), kept too.
//
// A stream that moves nothing for STALL_MS is given up and a new one
// opened (a burst of drops can wedge a connection, which would otherwise
// sit silent until its phase ends), and the stall is recorded. The browser
// may reuse the same connection for the new one: every stream to one
// origin can share one HTTP/2 or HTTP/3 connection, and with a member
// loading both ways its uploads and its downloads' acknowledgements then
// travel in one flow, one queue in Smart Queue's upload CAKE, where the ACK
// filter can't thin them. Loads from two members (one down, one up) keep
// the directions apart.
import type { Clock } from './clock';
import type { RunRecord } from './member';

export type Endpoint = 'cloudflare' | 'dev';

const DOWN_CHUNK = 25_000_000;
const UP_CHUNK = 8_000_000;
/** The bytes in a bucket of the throughput record, and how often one is written. */
export const RECORD_MS = 250;

export function downloadUrl(endpoint: Endpoint, n: number): string {
  const nonce = `${String(Date.now())}-${String(n)}`;
  return endpoint === 'dev'
    ? `/__bench_dev/down?bytes=${String(DOWN_CHUNK)}&n=${nonce}`
    : `https://speed.cloudflare.com/__down?bytes=${String(DOWN_CHUNK)}&mfb=${nonce}`;
}

export function uploadUrl(endpoint: Endpoint, n: number): string {
  const nonce = `${String(Date.now())}-${String(n)}`;
  return endpoint === 'dev' ? `/__bench_dev/up?n=${nonce}` : `https://speed.cloudflare.com/__up?mfb=${nonce}`;
}

/** Cloudflare's view of a connection, from its Server-Timing "cfL4" entry ("?proto=TCP&rtt=7654&min_rtt=...&retrans=0&lost=0..."). */
export function cfL4(description: string): { rtt: number; minRtt: number; retrans: number; lost: number } | undefined {
  const q = new URLSearchParams(description.replace(/^\?/, ''));
  const rtt = Number(q.get('rtt'));
  const minRtt = q.get('min_rtt') === null ? NaN : Number(q.get('min_rtt'));
  if (!Number.isFinite(rtt) || q.get('rtt') === null) return undefined;
  const count = (k: string): number => {
    const v = Number(q.get(k));
    return Number.isFinite(v) ? v : 0;
  };
  // its RTTs are µs
  return {
    rtt: rtt / 1000,
    minRtt: Number.isFinite(minRtt) ? minRtt / 1000 : rtt / 1000,
    retrans: count('retrans'),
    lost: count('lost'),
  };
}

/** How long a stream may move nothing before it's given up for a new one. */
export const STALL_MS = 5000;

/** A stream given up for moving nothing; its error names how long. */
class Stalled extends Error {
  constructor(what: string, ms: number) {
    super(`${what}: nothing moved for ${String(ms / 1000)} s; a new stream opened`);
  }
}

/**
 * Watches one stream: `moved()` on each read or progress event; nothing
 * for `ms` runs `onStall` once. Checked a few times within `ms`, so one
 * timer a stream rather than one a read.
 */
function stallWatch(ms: number, onStall: () => void): { moved: () => void; stalled: () => boolean; stop: () => void } {
  let last = performance.now();
  let stalled = false;
  const timer = setInterval(
    () => {
      if (stalled || performance.now() - last < ms) return;
      stalled = true;
      clearInterval(timer);
      onStall();
    },
    Math.max(10, Math.min(1000, ms / 4)),
  );
  return {
    moved: () => {
      last = performance.now();
    },
    stalled: () => stalled,
    stop: () => {
      clearInterval(timer);
    },
  };
}

/** Whether `signal` has aborted (a function, so a check after an await reads it again). */
export function aborted(signal: AbortSignal): boolean {
  return signal.aborted;
}

/**
 * The bytes a member moves, in buckets, and its rates for the live
 * figures. `onLimit` runs once, as soon as `limit` bytes have moved (a fast
 * line moves tens of MB in one bucket, so it can't wait for one).
 */
export class Meter {
  private acc = { d: 0, u: 0 };
  private window: { t: number; d: number; u: number }[] = [];
  total = 0;
  private readonly limit: number;
  private readonly onLimit: () => void;

  constructor(limit = Infinity, onLimit: () => void = () => undefined) {
    this.limit = limit;
    this.onLimit = onLimit;
  }

  add(dir: 'd' | 'u', bytes: number): void {
    const before = this.total;
    this.acc[dir] += bytes;
    this.total += bytes;
    if (before < this.limit && this.total >= this.limit) this.onLimit();
  }

  /** The bucket since the last flush, as records at router time `t`. */
  flush(t: number, record: (r: RunRecord) => void): void {
    const now = performance.now();
    for (const dir of ['d', 'u'] as const) {
      if (this.acc[dir] > 0) record(['tp', dir, Math.round(t), this.acc[dir]]);
    }
    this.window.push({ t: now, ...this.acc });
    this.window = this.window.filter((w) => now - w.t <= 1000);
    this.acc = { d: 0, u: 0 };
  }

  /** Mbit/s over the last second. */
  rate(dir: 'd' | 'u'): number {
    let bytes = 0;
    for (const w of this.window) bytes += w[dir];
    return (bytes * 8) / 1e6;
  }
}

async function entryFor(url: string): Promise<PerformanceResourceTiming | undefined> {
  await new Promise((r) => setTimeout(r, 0));
  const list = performance.getEntriesByName(new URL(url, window.location.href).href, 'resource');
  return list[list.length - 1] as PerformanceResourceTiming | undefined;
}

async function serverView(url: string, clock: Clock, record: (r: RunRecord) => void): Promise<void> {
  const e = await entryFor(url);
  const st = e?.serverTiming.find((s) => s.name === 'cfL4');
  const v = st === undefined ? undefined : cfL4(st.description);
  const t = clock.router();
  if (v !== undefined && t !== undefined) record(['cf', Math.round(t), v.rtt, v.minRtt, v.retrans, v.lost]);
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

let streams = 0;

/** One download stream: chunk after chunk until `signal` aborts; one that stalls (`stallMs`) is given up for a new one. */
export async function download(
  endpoint: Endpoint,
  meter: Meter,
  clock: Clock,
  signal: AbortSignal,
  record: (r: RunRecord) => void,
  stallMs = STALL_MS,
): Promise<void> {
  while (!signal.aborted) {
    const url = downloadUrl(endpoint, streams++);
    // this chunk's own abort: the phase ending, or a stall
    const chunk = new AbortController();
    const end = (): void => {
      chunk.abort();
    };
    signal.addEventListener('abort', end);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const watch = stallWatch(stallMs, () => {
      chunk.abort();
      // a body that doesn't end with its fetch still lets go of the read
      reader?.cancel().catch(() => undefined);
    });
    try {
      const res = await fetch(url, { signal: chunk.signal, cache: 'no-store', credentials: 'omit' });
      if (!res.ok || res.body === null) {
        const t = clock.router();
        if (t !== undefined) record(['err', Math.round(t), `download: the server answered ${String(res.status)}`]);
        await pause(1000, signal);
        continue;
      }
      reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (watch.stalled()) throw new Stalled('download', stallMs);
        if (done) break;
        watch.moved();
        meter.add('d', value.byteLength);
      }
      await serverView(url, clock, record);
    } catch (err) {
      if (aborted(signal)) return;
      const t = clock.router();
      const why = watch.stalled()
        ? new Stalled('download', stallMs).message
        : `download: ${err instanceof Error ? err.message : String(err)}`;
      if (t !== undefined) record(['err', Math.round(t), why]);
      // a stalled stream is replaced at once; an error waits a little
      if (!watch.stalled()) await pause(500, signal);
    } finally {
      watch.stop();
      signal.removeEventListener('abort', end);
    }
  }
}

let body: Uint8Array<ArrayBuffer> | undefined;

/** What uploads send: random bytes, so nothing on the way can compress them. */
function uploadBody(): Uint8Array<ArrayBuffer> {
  if (body === undefined) {
    body = new Uint8Array(UP_CHUNK);
    for (let i = 0; i < body.length; i += 65_536) crypto.getRandomValues(body.subarray(i, Math.min(body.length, i + 65_536)));
  }
  return body;
}

function uploadOnce(url: string, meter: Meter, signal: AbortSignal, stallMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let sent = 0;
    const watch = stallWatch(stallMs, () => {
      xhr.abort();
    });
    const end = (): void => {
      xhr.abort();
    };
    const done = (): void => {
      watch.stop();
      signal.removeEventListener('abort', end);
    };
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => {
      watch.moved();
      meter.add('u', e.loaded - sent);
      sent = e.loaded;
    };
    xhr.onload = () => {
      done();
      resolve(xhr.status);
    };
    xhr.onerror = () => {
      done();
      reject(new Error('the upload failed'));
    };
    xhr.onabort = () => {
      done();
      if (watch.stalled()) reject(new Stalled('upload', stallMs));
      else resolve(0);
    };
    signal.addEventListener('abort', end);
    xhr.send(uploadBody());
  });
}

/** One upload stream: chunk after chunk until `signal` aborts; one that stalls (`stallMs`) is given up for a new one. */
export async function upload(
  endpoint: Endpoint,
  meter: Meter,
  clock: Clock,
  signal: AbortSignal,
  record: (r: RunRecord) => void,
  stallMs = STALL_MS,
): Promise<void> {
  while (!signal.aborted) {
    const url = uploadUrl(endpoint, streams++);
    try {
      const status = await uploadOnce(url, meter, signal, stallMs);
      if (aborted(signal)) return;
      if (status < 200 || status >= 300) {
        const t = clock.router();
        if (t !== undefined) record(['err', Math.round(t), `upload: the server answered ${String(status)}`]);
        await pause(1000, signal);
        continue;
      }
      await serverView(url, clock, record);
    } catch (err) {
      if (aborted(signal)) return;
      const t = clock.router();
      if (err instanceof Stalled) {
        // replaced at once
        if (t !== undefined) record(['err', Math.round(t), err.message]);
        continue;
      }
      if (t !== undefined) record(['err', Math.round(t), `upload: ${err instanceof Error ? err.message : String(err)}`]);
      await pause(500, signal);
    }
  }
}
