// Host names typed into a list (the VPN page's sites that go direct, Test
// Bench's own sites): what a pasted address brings with it is cleaned off,
// anything that still isn't a name is set aside, and the list stops at its limit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSites } from '../src/lib/hostnames.ts';

test('an address pasted from the browser is cut to its host, in lower case', () => {
  assert.deepEqual(parseSites('https://www.BBC.co.uk/iplayer', 64), { sites: ['www.bbc.co.uk'], bad: [], over: false });
  assert.deepEqual(parseSites('http://itv.com:443/watch?x=1#top', 64).sites, ['itv.com']);
});

test('a leading dot (or a wildcard) means the same name: everything under it is covered anyway', () => {
  assert.deepEqual(parseSites('.bbc.co.uk', 64).sites, ['bbc.co.uk']);
  assert.deepEqual(parseSites('*.bbc.co.uk bbc.co.uk.', 64).sites, ['bbc.co.uk']);
});

test('what still isn’t a name is set aside as typed, never in the list', () => {
  const p = parseSites('bad_name! bbc.co.uk, localhost 1.2.3.4 a/b', 64);
  assert.deepEqual(p.sites, ['bbc.co.uk']);
  assert.deepEqual(p.bad, ['bad_name!', 'localhost', '1.2.3.4', 'a/b']);
});

test('more than the limit: the first ones are kept, and it says so', () => {
  const names = Array.from({ length: 70 }, (_, i) => `s${String(i)}.example`);
  const p = parseSites(names.join('\n'), 64);
  assert.equal(p.sites.length, 64);
  assert.equal(p.sites[63], 's63.example');
  assert.equal(p.over, true);
  assert.equal(parseSites(names.slice(0, 64).join(','), 64).over, false);
});

test('repeats count once, and names the caller already has are left out without a word', () => {
  const p = parseSites('a.example A.example www.youtube.com', 64, ['www.youtube.com']);
  assert.deepEqual(p, { sites: ['a.example'], bad: [], over: false });
});
