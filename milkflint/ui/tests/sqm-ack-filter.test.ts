// When Smart Queue suggests the ACK filter, and how its keywords are read and kept.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACK_FILTER, ackFilterOf, suggestsAckFilter } from '../src/features/sqm/ack-filter.ts';
import { withOpts, words } from '../src/features/sqm/gso.ts';

test('suggested only above 15 to 1', () => {
  assert.equal(suggestsAckFilter('900', '50'), true);
  assert.equal(suggestsAckFilter('150.5', '10'), true);
  assert.equal(suggestsAckFilter('150', '10'), false);
  assert.equal(suggestsAckFilter('100', '20'), false);
});

test('not while a speed is empty or unfinished', () => {
  for (const [d, u] of [['900', ''], ['900', '0'], ['', '50'], ['0', '0'], ['900', 'x'], ['x', '50']] as const) {
    assert.equal(suggestsAckFilter(d, u), false, `${d}:${u}`);
  }
});

test('read from the upload options', () => {
  assert.equal(ackFilterOf(words('rtt 50ms')), 'off');
  assert.equal(ackFilterOf(words('no-ack-filter')), 'off');
  assert.equal(ackFilterOf(words('nat ack-filter rtt 50ms')), 'on');
  assert.equal(ackFilterOf(words('ack-filter-aggressive')), 'custom');
});

test('switching it keeps the rest', () => {
  assert.equal(withOpts('rtt 50ms', ACK_FILTER, ['ack-filter']), 'rtt 50ms ack-filter');
  assert.equal(withOpts('ack-filter rtt 50ms', ACK_FILTER, []), 'rtt 50ms');
  assert.equal(withOpts('no-ack-filter nat', ACK_FILTER, ['ack-filter']), 'nat ack-filter');
});
