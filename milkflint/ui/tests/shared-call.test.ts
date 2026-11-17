// lib/shared-call.ts: several widgets asking at once make one router call,
// and a later ask, once that's back, makes a fresh one (and so does one
// after a failure).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sharedCall } from '@/lib/shared-call';

test('asks made while a call is on its way share it; the next ask calls afresh', async () => {
  let calls = 0;
  let release: (n: number) => void = () => undefined;
  const read = sharedCall(
    () =>
      new Promise<number>((resolve) => {
        calls++;
        release = resolve;
      }),
  );
  const a = read();
  const b = read();
  assert.equal(calls, 1);
  release(7);
  assert.deepEqual(await Promise.all([a, b]), [7, 7]);
  const c = read();
  assert.equal(calls, 2);
  release(8);
  assert.equal(await c, 8);
});

test('a failed call is shared too, and the next ask tries again', async () => {
  let calls = 0;
  const read = sharedCall(() => {
    calls++;
    return calls === 1 ? Promise.reject(new Error('busy')) : Promise.resolve('ok');
  });
  await Promise.all([assert.rejects(read(), /busy/), assert.rejects(read(), /busy/)]);
  assert.equal(calls, 1);
  assert.equal(await read(), 'ok');
  assert.equal(calls, 2);
});
