// The test bench's reads: a member's, made with its own session, are kept
// under its id, never its session; the admin's under "admin".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { benchQueries } from '../src/features/test-bench/queries.ts';

test('a member’s reads are keyed by its id, not its session', () => {
  const member = { session: 'a'.repeat(32), member: 'm1' };
  for (const key of [benchQueries.runs(member).queryKey, benchQueries.run(member, 'r7').queryKey]) {
    assert.deepEqual(key.slice(0, 3), ['test-bench', 'member', 'm1']);
    assert.ok(!JSON.stringify(key).includes(member.session), JSON.stringify(key));
  }
  assert.deepEqual(benchQueries.run(member, 'r7').queryKey, ['test-bench', 'member', 'm1', 'run', 'r7']);
});

test('the admin’s reads are its own', () => {
  assert.deepEqual(benchQueries.runs({ admin: true }).queryKey, ['test-bench', 'admin', 'runs']);
  assert.deepEqual(benchQueries.status().queryKey, ['test-bench', 'status']);
});
