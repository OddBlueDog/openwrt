import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundsText, readDraft } from '@/lib/number-draft';

const b = { min: 10, max: 100_000, integer: true };

test('blank text is empty', () => {
  assert.deepEqual(readDraft('', b), { kind: 'empty' });
  assert.deepEqual(readDraft('  ', b), { kind: 'empty' });
  assert.deepEqual(readDraft('-', {}), { kind: 'empty' });
});

test('values in range are ok, others come back clamped', () => {
  assert.deepEqual(readDraft('9', b), { kind: 'out', value: 10 });
  assert.deepEqual(readDraft('9000', b), { kind: 'ok', value: 9000 });
  assert.deepEqual(readDraft('250000', b), { kind: 'out', value: 100000 });
});

test('integer rounds before the range check', () => {
  assert.deepEqual(readDraft('9.6', b), { kind: 'ok', value: 10 });
});

test('decimals pass in an unbounded box', () => {
  assert.deepEqual(readDraft('0.5', {}), { kind: 'ok', value: 0.5 });
});

test('boundsText', () => {
  assert.equal(boundsText(b), '10 to 100,000');
  assert.equal(boundsText({ min: 3 }), 'at least 3');
  assert.equal(boundsText({ max: 60 }), 'at most 60');
  assert.equal(boundsText({}), '');
});
