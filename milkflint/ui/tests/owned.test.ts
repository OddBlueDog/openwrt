// The shared section helper pages save through: options set back, unset,
// added, as uci keeps them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sectionChanges } from '../src/lib/api/owned.ts';
import { section } from './uci-fixture.ts';

const want = (values: Record<string, string | string[] | undefined>) => ({
  config: 'network',
  type: 'interface',
  name: 'x',
  values,
});

test('an empty value is no value: uci deletes an option set to an empty string', () => {
  // nothing to do when the option isn't there
  assert.deepEqual(sectionChanges(want({ private_key: '' }), section('interface', 'x')), []);
  // unset when it is
  assert.deepEqual(sectionChanges(want({ private_key: '' }), section('interface', 'x', { private_key: 'k' })), [
    { op: 'unset', config: 'network', section: 'x', options: ['private_key'] },
  ]);
  // a new section leaves it out
  assert.deepEqual(sectionChanges(want({ proto: 'wireguard', private_key: '' }), undefined), [
    { op: 'add', config: 'network', type: 'interface', name: 'x', values: { proto: 'wireguard' } },
  ]);
});
