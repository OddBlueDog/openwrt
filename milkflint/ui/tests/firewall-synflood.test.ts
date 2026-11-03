// The Firewall page's SYN flood rate: fw4's synflood_rate read as fw4 reads
// it, the field's checks, and the options a save writes (N a second, twice
// that at once, or both unset for fw4's own).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { editSection, parseFirewall, synRateError, synRateLabel, synRatePerSecond, synRateText, synRateValues } from '../src/features/firewall/model.ts';

test('fw4’s ways of writing a rate, in connections a second', () => {
  assert.equal(synRatePerSecond('50/second'), 50);
  assert.equal(synRatePerSecond('50/s'), 50);
  assert.equal(synRatePerSecond('50/sec'), 50);
  assert.equal(synRatePerSecond('50'), 50);
  assert.equal(synRatePerSecond('3000/minute'), 50);
  assert.equal(synRatePerSecond('3000/m'), 50);
  assert.equal(synRatePerSecond('7200/hour'), 2);
  for (const bad of [undefined, '', 'fast', '50/fortnight', '-5/second', '5.5/second', '50 / second']) {
    assert.equal(synRatePerSecond(bad), undefined, String(bad));
  }
});

test('the field shows a whole number a second, or what’s set when it’s in other units', () => {
  assert.equal(synRateText(undefined), '');
  assert.equal(synRateText('50/second'), '50');
  assert.equal(synRateText('3000/minute'), '50');
  assert.equal(synRateText('100/minute'), '100/minute');
});

test('the zones table names the rule per address, fw4’s own when unset', () => {
  assert.equal(synRateLabel('200/second'), '200/s per address');
  assert.equal(synRateLabel('12000/minute'), '200/s per address');
  assert.equal(synRateLabel(undefined), '25/s per address');
  assert.equal(synRateLabel('100/minute'), '100/minute per address');
});

test('only a whole number from 1 to 10000, or nothing, can be saved', () => {
  for (const ok of ['', '1', '50', '10000']) assert.equal(synRateError(ok), undefined, ok);
  for (const bad of ['0', '10001', '5.5', '50/second', 'fifty', ' 50']) assert.notEqual(synRateError(bad), undefined, bad);
});

test('a save writes the rate a second and twice that at once, or unsets both', () => {
  assert.deepEqual(synRateValues('50'), { synflood_rate: '50/second', synflood_burst: '100' });
  assert.deepEqual(synRateValues('200'), { synflood_rate: '200/second', synflood_burst: '400' });
  assert.deepEqual(synRateValues(''), { synflood_rate: undefined, synflood_burst: undefined });
  const section = { '.name': 'cfg01e63d', '.type': 'defaults', syn_flood: '1', synflood_rate: '25/second', synflood_burst: '50' };
  assert.deepEqual(editSection('defaults', section, synRateValues('50')), [
    { op: 'set', config: 'firewall', section: 'cfg01e63d', values: { synflood_rate: '50/second', synflood_burst: '100' } },
  ]);
  assert.deepEqual(editSection('defaults', section, synRateValues('')), [
    { op: 'unset', config: 'firewall', section: 'cfg01e63d', options: ['synflood_rate', 'synflood_burst'] },
  ]);
});

test('the defaults section’s rate is read as set', () => {
  const cfg = parseFirewall([{ '.name': 'd', '.type': 'defaults', syn_flood: '1', synflood_rate: '50/second' }]);
  assert.equal(cfg.defaults.synFlood, true);
  assert.equal(cfg.defaults.synRate, '50/second');
  assert.equal(parseFirewall([{ '.name': 'd', '.type': 'defaults' }]).defaults.synRate, undefined);
});
