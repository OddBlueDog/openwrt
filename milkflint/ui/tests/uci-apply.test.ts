// What a save sends rpcd (applyChanges), against a fake /ubus: unchecked for
// most configs; for the firewall, with rollback armed, checked by nft, then
// kept or undone.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import { applyChanges, FirewallRejectedError } from '../src/lib/api/uci.ts';

const request = z.object({
  id: z.number(),
  params: z.tuple([z.string(), z.string(), z.string(), z.record(z.string(), z.unknown())]),
});
const realFetch = globalThis.fetch;

interface Rpcd {
  /** fw4 check's answers in turn: an nft error line, or undefined for a config that loads */
  checks?: (string | undefined)[];
  /** `uci apply` answers noData: nothing was staged */
  nothingStaged?: boolean;
}

function fakeRpcd({ checks = [], nothingStaged = false }: Rpcd): string[] {
  const calls: string[] = [];
  globalThis.fetch = (_input, init) => {
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const replies = (Array.isArray(body) ? body : [body]).map((item) => {
      const { id, params } = request.parse(item);
      const [, object, method, args] = params;
      const what = `${object}.${method}`;
      calls.push(what === 'uci.apply' ? `uci.apply ${JSON.stringify(args)}` : what);
      if (what === 'uci.changes') return { jsonrpc: '2.0', id, result: [0, { changes: {} }] };
      if (what === 'uci.apply' && nothingStaged) return { jsonrpc: '2.0', id, result: [5] };
      if (what === 'file.exec') {
        const fault = checks.shift();
        return {
          jsonrpc: '2.0',
          id,
          result: [0, fault === undefined ? { code: 0 } : { code: 1, stderr: `Error: ${fault}` }],
        };
      }
      return { jsonrpc: '2.0', id, result: [0] };
    });
    return Promise.resolve(Response.json(replies));
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

const network = { op: 'set', config: 'network', section: 'lan', values: { ipaddr: '192.168.2.1' } } as const;
const firewall = { op: 'set', config: 'firewall', section: 'r', values: { name: 'x' } } as const;

test('a change outside the firewall applies unchecked', async () => {
  const calls = fakeRpcd({});
  assert.deepEqual(await applyChanges([network]), { nothingChanged: false });
  assert.ok(calls.includes('uci.apply {"rollback":false}'), calls.join('\n'));
  assert.ok(!calls.includes('file.exec'));
  assert.ok(!calls.includes('uci.confirm'));
});

test('a firewall change applies with rollback, is checked again, and kept', async () => {
  const calls = fakeRpcd({ checks: [undefined, undefined] });
  assert.deepEqual(await applyChanges([firewall]), { nothingChanged: false });
  const apply = calls.indexOf('uci.apply {"rollback":true,"timeout":60}');
  assert.ok(apply > 0, calls.join('\n'));
  assert.equal(calls.filter((c) => c === 'file.exec').length, 2);
  assert.ok(calls.lastIndexOf('file.exec') > apply);
  assert.equal(calls.at(-1), 'uci.confirm');
});

test('a firewall change nft won’t load is rolled back and rejected', async () => {
  const calls = fakeRpcd({ checks: [undefined, 'log prefix is too long'] });
  await assert.rejects(applyChanges([firewall]), (err: unknown) => {
    assert.ok(err instanceof FirewallRejectedError);
    assert.equal(err.fault, 'log prefix is too long');
    assert.equal(err.message, 'The firewall couldn’t load this (log prefix is too long), so it was undone.');
    return true;
  });
  assert.equal(calls.at(-1), 'uci.rollback');
  assert.ok(!calls.includes('uci.confirm'));
});

test('nothing staged: nothing changed', async () => {
  fakeRpcd({ nothingStaged: true });
  assert.deepEqual(await applyChanges([network]), { nothingChanged: true });
});

test('a firewall that already fails its check is applied unchecked', async () => {
  const calls = fakeRpcd({ checks: ['already broken'] });
  assert.deepEqual(await applyChanges([firewall]), { nothingChanged: false });
  assert.ok(calls.includes('uci.apply {"rollback":false}'), calls.join('\n'));
  assert.equal(calls.filter((c) => c === 'file.exec').length, 1);
});
