import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groups } from '@/features/groups';
import { featureIds } from '@/features/ids';
import { searchPages } from '@/features/search';
import type { Feature, GroupId } from '@/features/types';

// Pages as the search sees them, without loading any page's code.
const fake = (id: (typeof featureIds)[number], title: string, group?: GroupId): Feature =>
  ({ id, title, description: '', order: 0, ...(group !== undefined ? { group } : {}) }) as unknown as Feature;
const pages = featureIds.map((id) =>
  id === 'sqm'
    ? fake(id, 'Smart Queue', 'speed')
    : id === 'wifi'
      ? fake(id, 'Networks & radios', 'wifi')
      : id === 'firewall'
        ? fake(id, 'Firewall', 'security')
        : fake(id, id),
);
const groupOf = (f: Feature): (typeof groups)[number] | undefined => groups.find((g) => g.id === f.group);
const first = (q: string): string | undefined => searchPages(q, pages, groupOf)[0]?.feature.id;

test('page search: by title, by group, and by another word for what a page does', () => {
  assert.equal(first('smart'), 'sqm');
  assert.equal(first('qos'), 'sqm');
  assert.equal(first('ssid'), 'wifi');
  assert.equal(first('port forward'), 'port-forwards');
  assert.equal(first('nat'), 'firewall');
  assert.ok(
    searchPages('speed', pages, groupOf).some((m) => m.feature.id === 'sqm'),
    'a page is found by its group',
  );
  assert.deepEqual(searchPages('   ', pages, groupOf), []);
  assert.deepEqual(searchPages('zzzz', pages, groupOf), []);
  assert.ok(searchPages('a', pages, groupOf).length <= 8);
});
