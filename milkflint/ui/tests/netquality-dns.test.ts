// The Network Quality page's DNS servers: their names and a line each.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dnsLines, providerName } from '../src/features/network-quality/dns-lines.ts';

test('a server is named after its DNS page provider, by host name or address', () => {
  assert.equal(providerName('one.one.one.one'), 'Cloudflare');
  assert.equal(providerName('cloudflare-dns.com'), 'Cloudflare');
  assert.equal(providerName('1.0.0.1'), 'Cloudflare');
  assert.equal(providerName('family.cloudflare-dns.com'), 'Cloudflare Family');
  assert.equal(providerName('dns.google'), 'Google');
  assert.equal(providerName('dns.quad9.net'), 'Quad9');
  assert.equal(providerName('192.0.2.53'), undefined);
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
  const got = lines([{ dns: 5, dns_servers: { '9.9.9.9': 5 } }, { dns: 6, dns_servers: { 'dns.google': 6 } }], ['dns.google']);
  assert.deepEqual(
    got.map((l) => [l.label, l.current]),
    [
      ['Google', true],
      ['Quad9', false],
    ],
  );
});
