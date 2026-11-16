// The DNS page's opening answer and its More settings summary: who devices
// ask, where the router sends lookups and whether that's encrypted, and what
// the cache and protection do, all from the saved settings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnsAnswer, moreSummary } from '../src/features/dns/answer.ts';
import type { DnsForm } from '../src/features/dns/model.ts';

const form = (over: Partial<DnsForm> = {}): DnsForm => ({
  mode: 'auto',
  provider: 'cloudflare',
  server: 'Standard',
  proto: 'doh',
  custom: '',
  pair: 'one',
  backup: 'quad9',
  backupServer: '',
  backupCustom: '',
  cacheOn: true,
  cacheSize: '1000',
  cacheHttps: true,
  quick: false,
  keepHours: '24',
  intercept: false,
  rebind: true,
  domain: 'lan',
  records: [],
  devices: { own: false, ipv4: '', ipv6: '' },
  ...over,
});

test('dns answer: devices ask the router, AdGuard Home, or their own server', () => {
  const router = dnsAnswer(form(), '192.168.1.1', false).devices;
  assert.equal(router.who, 'router');
  assert.match(router.text, /192\.168\.1\.1/);
  assert.match(router.text, /name\.lan/);
  assert.equal(dnsAnswer(form(), '192.168.1.1', true).devices.who, 'adguard');
  // their own server wins over AdGuard Home: the home network's devices skip it
  const own = dnsAnswer(form({ devices: { own: true, ipv4: '192.168.1.53', ipv6: 'fd00::53' } }), '192.168.1.1', true).devices;
  assert.equal(own.who, 'own');
  assert.match(own.text, /192\.168\.1\.53, fd00::53/);
});

test('dns answer: where lookups go, and whether encrypted', () => {
  const auto = dnsAnswer(form(), '192.168.1.1', false).upstream;
  assert.deepEqual([auto.value, auto.encrypted], ['Your provider', false]);
  const plain = dnsAnswer(form({ mode: 'static' }), '192.168.1.1', false).upstream;
  assert.deepEqual([plain.value, plain.encrypted], ['Cloudflare', false]);
  assert.match(plain.text, /unencrypted/);
  const two = dnsAnswer(form({ mode: 'encrypted', pair: 'parallel', backupServer: 'Unfiltered' }), '192.168.1.1', false).upstream;
  assert.equal(two.encrypted, true);
  assert.match(two.value, /^Cloudflare and Quad9/);
  assert.equal(
    dnsAnswer(form({ mode: 'static', provider: 'custom', custom: '192.0.2.53' }), '192.168.1.1', false).upstream.value,
    'Your custom server',
  );
});

test('dns answer: the cache and protection in a line', () => {
  const on = dnsAnswer(form({ quick: true, keepHours: '12', intercept: true }), '192.168.1.1', false).protection;
  assert.equal(on.value, 'Cache on');
  assert.match(on.text, /1,000 answers, and reuses expired ones for up to 12 hours\./);
  assert.match(on.text, /Catches devices with their own DNS\./);
  assert.match(on.text, /Rebinding protection on\./);
  const off = dnsAnswer(
    form({ cacheOn: false, rebind: false, devices: { own: true, ipv4: '192.168.1.53', ipv6: '' } }),
    '192.168.1.1',
    false,
  ).protection;
  assert.equal(off.value, 'Cache off');
  // catching is off while devices use their own server: nothing said about it
  assert.doesNotMatch(off.text, /catch/i);
  assert.match(off.text, /Rebinding protection off\./);
  // an empty size is the default
  assert.match(dnsAnswer(form({ cacheSize: '' }), '192.168.1.1', false).protection.text, /1,000 answers/);
});

test('dns more settings summary: only what isn’t usual', () => {
  assert.equal(moreSummary(form(), { uncovered: false, invalid: false }), undefined);
  assert.equal(
    moreSummary(
      form({ rebind: false, domain: 'home', records: [{ key: 'a', section: 'cfg1', name: 'nas', ip: '192.168.1.20' }] }),
      { uncovered: false, invalid: true },
    ),
    'needs a fix · rebinding protection off · domain home · 1 custom name',
  );
  assert.equal(
    moreSummary(form({ intercept: true }), { uncovered: true, invalid: false }),
    'not on every guest network yet · catches devices’ own DNS',
  );
});
