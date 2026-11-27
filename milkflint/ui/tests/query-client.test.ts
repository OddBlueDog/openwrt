// The query cache's defaults: what a router needs rather than a web service.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createQueryClient } from '../src/lib/query/client.ts';

test('defaults: no retries, always-on network mode, no reconnect refetch', () => {
  const { queries = {}, mutations = {} } = createQueryClient().getDefaultOptions();
  assert.equal(queries.retry, false);
  assert.equal(queries.networkMode, 'always');
  assert.equal(queries.refetchOnReconnect, false);
  assert.equal(queries.staleTime, 0);
  assert.equal(mutations.retry, false);
  assert.equal(mutations.networkMode, 'always');
});
