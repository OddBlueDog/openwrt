// A reply that doesn't match its schema: the error names the call and what
// didn't match, rather than a bare zod error that says neither.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import { call, UbusReplyError } from '../src/lib/ubus.ts';

const request = z.object({ id: z.number() });
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a reply of the wrong shape rejects with UbusReplyError naming the call', async () => {
  globalThis.fetch = (_input, init) => {
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const replies = (Array.isArray(body) ? body : [body]).map((item) => ({
      jsonrpc: '2.0',
      id: request.parse(item).id,
      result: [0, { values: 3 }],
    }));
    return Promise.resolve(Response.json(replies));
  };
  await assert.rejects(call('uci', 'get', {}, z.object({ values: z.record(z.string(), z.unknown()) })), (err: unknown) => {
    assert.ok(err instanceof UbusReplyError);
    assert.equal(err.object, 'uci');
    assert.equal(err.method, 'get');
    assert.ok(err.message.startsWith('uci.get: '), err.message);
    assert.ok(err.message.includes('values'), err.message);
    return true;
  });
});
