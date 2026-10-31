// The DNS page's encrypted servers: what dnsproxy is given for a main server
// and a backup, and when the page warns that the two filter differently.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { providers } from '../src/features/dns/providers.ts';
import {
  backupDnssecWarning,
  backupProto,
  describe,
  dnssecWarning,
  filterWarning,
  keepHoursOf,
  matchingServer,
  plainServers,
  protoNote,
  proxyServers,
  type ServerPick,
  serverHint,
  shortName,
  suggestBackup,
} from '../src/features/dns/upstreams.ts';

const pick = (provider: ServerPick['provider'], server = '', custom = ''): ServerPick => ({ provider, server, custom });
const cloudflare = pick('cloudflare', 'Standard');
const quad9 = pick('quad9', 'Recommended');

test('no backup: one upstream, dnsproxy’s default mode', () => {
  assert.deepEqual(proxyServers(cloudflare, 'dot', undefined, 'parallel'), {
    upstream: ['tls://one.one.one.one'],
    fallback: [],
    bootstrap: ['1.1.1.1:53', '1.0.0.1:53'],
    mode: undefined,
  });
});

test('both at once: two upstreams in parallel, each provider bootstrapped', () => {
  assert.deepEqual(proxyServers(cloudflare, 'dot', quad9, 'parallel'), {
    upstream: ['tls://one.one.one.one', 'tls://dns.quad9.net'],
    fallback: [],
    bootstrap: ['1.1.1.1:53', '1.0.0.1:53', '9.9.9.9:53', '149.112.112.112:53'],
    mode: 'parallel',
  });
});

test('backup only when needed: the backup is dnsproxy’s fallback', () => {
  const s = proxyServers(cloudflare, 'doh', quad9, 'fallback');
  assert.deepEqual(s.upstream, ['https://cloudflare-dns.com/dns-query']);
  assert.deepEqual(s.fallback, ['https://dns.quad9.net/dns-query']);
  assert.equal(s.mode, undefined);
});

test('a backup without the main server’s encryption type uses DoH', () => {
  const s = proxyServers(pick('adguard', 'Default'), 'doq', quad9, 'parallel');
  assert.deepEqual(s.upstream, ['quic://dns.adguard-dns.com', 'https://dns.quad9.net/dns-query']);
});

test('a custom main server: the backup follows its address’s type', () => {
  assert.equal(backupProto(pick('custom', '', 'tls://dns.example'), 'doh'), 'dot');
  assert.equal(backupProto(pick('custom', '', 'sdns://AQcAAAAAAAAA'), 'dot'), 'doh');
  const s = proxyServers(pick('custom', '', ' tls://dns.example '), 'doh', quad9, 'parallel');
  assert.deepEqual(s.upstream, ['tls://dns.example', 'tls://dns.quad9.net']);
  assert.deepEqual(s.bootstrap, ['1.1.1.1:53', '9.9.9.9:53', '149.112.112.112:53']);
});

test('a backup that comes out the same as the main server is left out', () => {
  assert.deepEqual(proxyServers(cloudflare, 'dot', pick('custom', '', 'tls://one.one.one.one'), 'parallel').upstream, ['tls://one.one.one.one']);
});

test('a backup provider starts on the server that filters like the main one', () => {
  assert.equal(matchingServer('quad9', []), 'Unsecured');
  assert.equal(matchingServer('cloudflare', ['adult', 'malware']), 'Family');
  assert.equal(matchingServer('google', ['malware']), 'Default');
  assert.equal(matchingServer('controld', undefined), 'Unfiltered');
});

test('both at once warns on any difference in filtering', () => {
  assert.equal(filterWarning(cloudflare, pick('quad9', 'Unsecured'), 'parallel'), undefined);
  assert.equal(
    filterWarning(cloudflare, quad9, 'parallel'),
    'Cloudflare Standard blocks nothing, Quad9 Recommended blocks malware. With both asked at once, whether those sites load depends on which answers first.',
  );
});

test('backup only when needed warns only about what the backup lets through', () => {
  assert.equal(filterWarning(cloudflare, quad9, 'fallback'), undefined);
  assert.equal(
    filterWarning(pick('cloudflare', 'Family'), quad9, 'fallback'),
    "While Cloudflare Family isn't answering, adult content can get through Quad9 Recommended, which doesn't block it.",
  );
  assert.equal(
    filterWarning(pick('adguard', 'Family'), pick('google', 'Default'), 'fallback'),
    "While AdGuard Family isn't answering, ads and adult content can get through Google Default, which doesn't block them.",
  );
});

test('a custom server can’t be checked, so the page says to', () => {
  assert.match(filterWarning(pick('custom', '', 'tls://dns.example'), quad9, 'parallel') ?? '', /^Check that both servers/);
  assert.equal(filterWarning(cloudflare, pick('custom', '', 'tls://dns.example'), 'fallback'), undefined);
  assert.match(filterWarning(pick('cloudflare', 'Family'), pick('custom', '', 'tls://dns.example'), 'fallback') ?? '', /^Check that the custom server blocks/);
});

test('instant answers’ keep time reads dnsproxy’s duration as hours, else its default', () => {
  assert.equal(keepHoursOf(undefined), '12');
  assert.equal(keepHoursOf('24h'), '24');
  assert.equal(keepHoursOf('720m'), '12');
  assert.equal(keepHoursOf('90m'), '12');
  assert.equal(keepHoursOf('0h'), '12');
  assert.equal(keepHoursOf('1d'), '12');
});

test('only CleanBrowsing’s servers don’t check DNSSEC', () => {
  const unchecked = Object.values(providers).flatMap((p) => p.servers.filter((x) => !x.dnssec).map((x) => `${p.label} ${x.name}`));
  assert.deepEqual(unchecked, ['CleanBrowsing Security Filter', 'CleanBrowsing Adult Filter', 'CleanBrowsing Family Filter']);
  assert.equal(serverHint(providers.quad9.servers[2]), 'No malware blocking. Checks DNSSEC.');
  assert.equal(serverHint(providers.cleanbrowsing.servers[0]), 'Blocks phishing, spam and malware domains. Doesn’t check DNSSEC.');
});

test('a server that doesn’t check DNSSEC is warned about, as the main server or the backup', () => {
  assert.equal(dnssecWarning(cloudflare), undefined);
  assert.equal(dnssecWarning(pick('custom', '', 'tls://dns.example')), undefined);
  assert.match(dnssecWarning(pick('cleanbrowsing', 'Family Filter')) ?? '', /^CleanBrowsing Family Filter doesn’t check DNSSEC/);
  const cb = pick('cleanbrowsing', 'Security Filter');
  assert.equal(backupDnssecWarning(quad9, 'parallel'), undefined);
  assert.match(backupDnssecWarning(cb, 'parallel') ?? '', /with both asked at once/);
  assert.match(backupDnssecWarning(cb, 'fallback') ?? '', /while the main server isn’t answering/);
});

test('plain DNS: one server is all its addresses, two the first of each, the main one’s first', () => {
  assert.deepEqual(plainServers(cloudflare, undefined), ['1.1.1.1', '1.0.0.1', '2606:4700:4700::1111', '2606:4700:4700::1001']);
  assert.deepEqual(plainServers(cloudflare, pick('google', 'Default')), ['1.1.1.1', '2606:4700:4700::1111', '8.8.8.8', '2001:4860:4860::8888']);
  assert.deepEqual(plainServers(pick('custom', '', '192.0.2.1, 192.0.2.2'), quad9), ['192.0.2.1', '192.0.2.2', '9.9.9.9', '2620:fe::fe']);
});

test('a suggested backup filters like the main server and checks DNSSEC', () => {
  assert.deepEqual(suggestBackup(cloudflare), { provider: 'google', server: 'Default' });
  assert.deepEqual(suggestBackup(quad9), { provider: 'cloudflare', server: 'Security' });
  // nothing else blocks just what these do and checks DNSSEC (CleanBrowsing's Adult Filter doesn't check
  // it): the first other provider's closest, and the page warns that they filter differently
  assert.deepEqual(suggestBackup(pick('cloudflare', 'Family')), { provider: 'google', server: 'Default' });
  assert.deepEqual(suggestBackup(pick('adguard', 'Default')), { provider: 'cloudflare', server: 'Standard' });
});

test('short names, and the page’s sentence for each setup', () => {
  assert.equal(shortName(cloudflare), 'Cloudflare');
  assert.equal(shortName(pick('cloudflare', 'Family')), 'Cloudflare Family');
  const google = pick('google', 'Default');
  assert.equal(describe('auto', cloudflare, google, 'parallel'), 'Lookups go to your internet provider’s DNS servers.');
  assert.equal(describe('encrypted', cloudflare, undefined, 'one'), 'Lookups go encrypted to Cloudflare.');
  assert.equal(describe('encrypted', cloudflare, google, 'parallel'), 'Each lookup goes encrypted to Cloudflare and Google at once; the first answer is used.');
  assert.equal(describe('encrypted', cloudflare, google, 'fallback'), 'Lookups go encrypted to Cloudflare, and to Google only when Cloudflare fails or is slow.');
  assert.equal(describe('static', cloudflare, google, 'fallback'), 'Lookups go unencrypted to Cloudflare, and to Google only when Cloudflare doesn’t answer.');
});

test('the encryption note names a second server that falls back to DNS over HTTPS, only then', () => {
  const adguard = pick('adguard', 'Default');
  const google = pick('google', 'Default');
  assert.equal(protoNote(adguard, google, 'doq'), 'Google doesn’t offer DNS over QUIC, so it uses DNS over HTTPS.');
  assert.equal(protoNote(adguard, pick('controld', 'Malware'), 'doq'), undefined);
  assert.equal(protoNote(cloudflare, google, 'dot'), undefined);
  assert.equal(protoNote(adguard, undefined, 'doq'), undefined);
  assert.equal(protoNote(adguard, pick('custom', '', 'tls://dns.example'), 'doq'), undefined);
});
