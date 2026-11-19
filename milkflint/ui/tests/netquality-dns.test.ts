// The Network Quality page's DNS servers: their names and a line each.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnsLines, dnsNotes, providerName } from '../src/features/network-quality/dns-lines.ts';

test('a server is named after its DNS page provider, by host name or address', () => {
  assert.equal(providerName('one.one.one.one'), 'Cloudflare');
  assert.equal(providerName('cloudflare-dns.com'), 'Cloudflare');
  assert.equal(providerName('1.0.0.1'), 'Cloudflare');
  assert.equal(providerName('family.cloudflare-dns.com'), 'Cloudflare Family');
  assert.equal(providerName('dns.google'), 'Google');
  assert.equal(providerName('dns.quad9.net'), 'Quad9');
  assert.equal(providerName('192.0.2.53'), undefined);
  // the probe's line through AdGuard Home on the router
  assert.equal(providerName('adguardhome'), 'AdGuard Home (this router)');
});

test('a DNS program on the router (set up outside MilkFlint) is named after the program', () => {
  assert.equal(providerName('local:ctrld:5354'), 'ctrld (this router)');
  assert.equal(providerName('local:AdGuardHome:53'), 'AdGuard Home (this router)');
  assert.equal(providerName('local:unbound:5335'), 'Unbound (this router)');
  assert.equal(providerName('local:my_proxy:5300'), 'my_proxy (this router)');
  // nothing found listening there
  assert.equal(providerName('local:5353'), 'Port 5353 (this router)');
});

test('notes under the DNS rows: encrypted servers asked over plain DNS, a program’s own cache', () => {
  const plain =
    'Each DNS server is asked over plain DNS at its address, the same server your encrypted lookups reach; the score uses the first.';
  assert.deepEqual(dnsNotes(['one.one.one.one', 'dns.google']), [plain]);
  assert.deepEqual(dnsNotes(['one.one.one.one']), []);
  assert.deepEqual(dnsNotes(['192.0.2.53']), []);
  assert.deepEqual(dnsNotes(['9.9.9.9', '149.112.112.112']), ['The score uses the first.']);
  // ctrld keeps no cache unless set to
  assert.deepEqual(dnsNotes(['local:ctrld:5354']), []);
  assert.deepEqual(dnsNotes(['local:AdGuardHome:53']), [
    'AdGuard Home answers repeat lookups from its own cache, so its times are mostly near zero.',
  ]);
  assert.deepEqual(dnsNotes(['freedns.controld.com', 'local:unbound:5335']), [
    plain,
    'Unbound answers repeat lookups from its own cache, so its times are mostly near zero.',
  ]);
});

interface P {
  dns?: number | null;
  dns_servers?: Record<string, number | null>;
}
const lines = (points: P[], order: string[]) =>
  dnsLines(
    points,
    (p) => p.dns_servers,
    (p) => p.dns,
    order,
  );

test('a line per server, the servers asked now first, nothing where a server wasn’t asked', () => {
  const got = lines(
    [
      { dns: 10, dns_servers: { 'one.one.one.one': 10, 'dns.google': 12 } },
      { dns: null, dns_servers: { 'one.one.one.one': null, 'dns.google': 11 } },
      { dns: 9, dns_servers: { 'one.one.one.one': 9 } },
    ],
    ['one.one.one.one', 'dns.google'],
  );
  assert.deepEqual(
    got.map((l) => [l.label, l.values]),
    [
      ['Cloudflare', [10, undefined, 9]],
      ['Google', [12, 11, undefined]],
    ],
  );
});

test('points from before the probe asked each server make a last line, "DNS (earlier)"', () => {
  const got = lines([{ dns: 20 }, { dns: 21 }, { dns: 7, dns_servers: { 'dns.quad9.net': 7 } }], ['dns.quad9.net']);
  assert.deepEqual(
    got.map((l) => [l.key, l.label, l.current, l.values]),
    [
      ['dns.quad9.net', 'Quad9', true, [undefined, undefined, 7]],
      ['', 'DNS (earlier)', false, [20, 21, undefined]],
    ],
  );
});

test('a server no longer asked keeps its line while its values are shown', () => {
  const got = lines(
    [
      { dns: 5, dns_servers: { '9.9.9.9': 5 } },
      { dns: 6, dns_servers: { 'dns.google': 6 } },
    ],
    ['dns.google'],
  );
  assert.deepEqual(
    got.map((l) => [l.label, l.current]),
    [
      ['Google', true],
      ['Quad9', false],
    ],
  );
});
