// The internet loads' streams: one that stops moving mid-chunk (a wedged
// connection) is given up and a new one opened, the stall recorded, instead
// of sitting silent until the phase ends. fetch and XMLHttpRequest are
// stand-ins that deliver one chunk and then hang.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import type { Clock } from '../src/features/test-bench/clock.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import { download, Meter, upload } from '../src/features/test-bench/wan.ts';

const STALL = 100;
const clock = { router: () => 1234 } as unknown as Clock;
const realFetch = globalThis.fetch;
const realXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

afterEach(() => {
  globalThis.fetch = realFetch;
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = realXhr;
});

/** Resolves once `ok()` holds, checked every 5 ms; fails after 3 s. */
async function until(ok: () => boolean, what: string): Promise<void> {
  const start = Date.now();
  while (!ok()) {
    if (Date.now() - start > 3000) assert.fail(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** A fetch whose every answer sends 1000 bytes and then nothing more; its body ends with the fetch's abort only if `honoursAbort`. */
function hangingFetch(honoursAbort: boolean): { calls: () => number } {
  let calls = 0;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls++;
    const signal = init?.signal;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(1000));
        if (honoursAbort)
          signal?.addEventListener('abort', () => {
            c.error(new DOMException('The operation was aborted.', 'AbortError'));
          });
      },
      // the next read never gets an answer
      pull: () => new Promise<void>(() => undefined),
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  return { calls: () => calls };
}

for (const honoursAbort of [true, false]) {
  test(`a download whose read hangs mid-chunk is given up for a new stream (body ${honoursAbort ? 'ends with the abort' : 'ignores the abort'})`, async () => {
    const f = hangingFetch(honoursAbort);
    const meter = new Meter();
    const records: RunRecord[] = [];
    const phase = new AbortController();
    const started = Date.now();
    const run = download('cloudflare', meter, clock, phase.signal, (r) => records.push(r), STALL);

    await until(() => f.calls() >= 2 && meter.total >= 2000, 'a second stream');
    // given up after the stall time, not at the phase's end
    assert.ok(Date.now() - started >= STALL);
    assert.ok(Date.now() - started < 2000);
    const errs = records.filter((r) => r[0] === 'err');
    assert.ok(errs.length >= 1);
    assert.match(String(errs[0]?.[2]), /^download: nothing moved for 0\.1 s; a new stream opened$/);

    // the phase ends while the second stream hangs: it stops, nothing more is recorded
    const before = records.length;
    phase.abort();
    await run;
    assert.equal(records.length, before);
  });
}

test('a download that keeps moving is never given up', async () => {
  let calls = 0;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    calls++;
    let timer: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        // a chunk every 20 ms, well inside the stall time, until the phase ends
        timer = setInterval(() => {
          c.enqueue(new Uint8Array(100));
        }, 20);
        init?.signal?.addEventListener('abort', () => {
          clearInterval(timer);
          c.error(new DOMException('The operation was aborted.', 'AbortError'));
        });
      },
    });
    return Promise.resolve(new Response(body, { status: 200 }));
  }) as typeof fetch;
  const meter = new Meter();
  const records: RunRecord[] = [];
  const phase = new AbortController();
  const run = download('cloudflare', meter, clock, phase.signal, (r) => records.push(r), STALL);
  await new Promise((r) => setTimeout(r, 4 * STALL));
  phase.abort();
  await run;
  assert.equal(calls, 1);
  assert.deepEqual(records, []);
  assert.ok(meter.total >= 1000);
});

/** An XMLHttpRequest that reports 1000 bytes sent and then nothing more, until it's aborted. */
class HangingXhr {
  static made = 0;
  upload: { onprogress: ((e: { loaded: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 0;
  constructor() {
    HangingXhr.made++;
  }
  open(): void {
    // nothing to do
  }
  send(): void {
    setTimeout(() => this.upload.onprogress?.({ loaded: 1000 }), 0);
  }
  abort(): void {
    setTimeout(() => this.onabort?.(), 0);
  }
}

test('an upload that stops making progress is given up for a new one', async () => {
  HangingXhr.made = 0;
  (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = HangingXhr;
  const meter = new Meter();
  const records: RunRecord[] = [];
  const phase = new AbortController();
  const run = upload('cloudflare', meter, clock, phase.signal, (r) => records.push(r), STALL);

  await until(() => HangingXhr.made >= 2 && meter.total >= 2000, 'a second upload');
  const errs = records.filter((r) => r[0] === 'err');
  assert.match(String(errs[0]?.[2]), /^upload: nothing moved for 0\.1 s; a new stream opened$/);
  // the phase's end isn't a stall: nothing recorded for it
  const before = records.length;
  phase.abort();
  await run;
  assert.equal(records.length, before);
});
