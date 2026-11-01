// Saving: what a page's save sends rpcd, against a fake /ubus. rpcd applies
// every change a session has staged, and a rollback stages again what it
// undid, so a save starts by dropping all of them.
import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { z } from 'zod';
import { stage } from '../src/lib/api/uci.ts';

const request = z.object({ id: z.number(), params: z.tuple([z.string(), z.string(), z.string(), z.record(z.string(), z.unknown())]) });
const realFetch = globalThis.fetch;

// rpcd as far as stage() sees it: `staged` is what this session has staged
function fakeRpcd(staged: Record<string, unknown[]>): string[] {
  const calls: string[] = [];
  globalThis.fetch = (_input, init) => {
    const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
    const replies = (Array.isArray(body) ? body : [body]).map((item) => {
      const { id, params } = request.parse(item);
      const [, object, method, args] = params;
      calls.push(`${object}.${method} ${JSON.stringify(args)}`);
      const result = object === 'uci' && method === 'changes' ? [0, { changes: staged }] : [0];
      return { jsonrpc: '2.0', id, result };
    });
    return Promise.resolve(Response.json(replies));
  };
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

test('a save drops what this session has staged for other configs too (a rolled-back change)', async () => {
  const calls = fakeRpcd({ firewall: [['set', 'r', 'log_prefix', 'x'.repeat(40)]] });
  await stage([{ op: 'set', config: 'network', section: 'lan', values: { ipaddr: '192.168.2.1' } }]);
  assert.deepEqual(calls.filter((c) => c.startsWith('uci.revert')).sort(), [
    'uci.revert {"config":"firewall"}',
    'uci.revert {"config":"network"}',
  ]);
  assert.equal(calls.at(-1), 'uci.set {"config":"network","section":"lan","values":{"ipaddr":"192.168.2.1"}}');
});

test('with nothing staged, it reverts only the configs it changes', async () => {
  const calls = fakeRpcd({});
  await stage([
    { op: 'set', config: 'dhcp', section: 'lan', values: { start: '100' } },
    { op: 'delete', config: 'firewall', section: 'old' },
  ]);
  assert.deepEqual(calls.filter((c) => c.startsWith('uci.revert')).sort(), [
    'uci.revert {"config":"dhcp"}',
    'uci.revert {"config":"firewall"}',
  ]);
  assert.deepEqual(calls.slice(-2), ['uci.set {"config":"dhcp","section":"lan","values":{"start":"100"}}', 'uci.delete {"config":"firewall","section":"old"}']);
});

test('the reverts come before the first change', async () => {
  const calls = fakeRpcd({ wireless: [] });
  await stage([{ op: 'set', config: 'system', section: 'ntp', values: { enabled: '1' } }]);
  const firstChange = calls.findIndex((c) => !c.startsWith('uci.revert') && !c.startsWith('uci.changes'));
  const lastRevert = calls.findLastIndex((c) => c.startsWith('uci.revert'));
  assert.ok(lastRevert < firstChange, calls.join('\n'));
});
