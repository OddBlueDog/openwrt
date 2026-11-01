// The test bench's DNS and page loads: the site list and a plan's own
// sites, the router's lookups per site (cache, wildcards, what dnsmasq
// adds), and each device's page loads and lookups.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deviceSites, deviceSummary, dnsmasqAdds, parseDns, routerSites, wildcardSites } from '../src/features/test-bench/dns-pages.ts';
import type { RunRecord } from '../src/features/test-bench/member.ts';
import { MAX_CUSTOM_SITES, parseSites, siteList, SITES, validHost } from '../src/features/test-bench/pages.ts';
import { memberRecords } from '../src/features/test-bench/timing.ts';

// ---- Sites ----

test('the fixed list has the sites asked for, each loaded at www', () => {
  const names = SITES.map((s) => s.site);
  for (const s of ['facebook.com', 'reddit.com', 'youtube.com', 'bbc.co.uk']) assert.ok(names.includes(s), s);
  assert.ok(SITES.every((s) => s.host === `www.${s.site}` && validHost(s.host)));
});

test('only host names pass', () => {
  for (const ok of ['example.org', 'a.b-c.example.co.uk', 'xn--bcher-kva.example']) assert.ok(validHost(ok), ok);
  for (const bad of ['', 'localhost', 'example.org; reboot', '-x.example', 'x_y.example', '1.2.3.4', 'example.org/x', 'EXAMPLE.ORG', `${'a'.repeat(64)}.org`]) {
    assert.ok(!validHost(bad), bad);
  }
});

test('a plan’s own sites, as typed: addresses cut to the host, repeats and the fixed list dropped, the rest named', () => {
  const p = parseSites('https://News.Example.com/path, example.org example.org\nwww.youtube.com  not_a_site, facebook.com');
  assert.deepEqual(p.sites, ['news.example.com', 'example.org']);
  assert.deepEqual(p.bad, ['not_a_site']);
  const many = Array.from({ length: 12 }, (_, i) => `s${String(i)}.example`);
  assert.equal(siteList(many).length, SITES.length + MAX_CUSTOM_SITES);
  assert.deepEqual(siteList(['bad name', 'example.org']).slice(SITES.length), [{ site: 'example.org', host: 'example.org' }]);
});

// ---- The router's lookups ----

const dnsLines = [
  JSON.stringify({ upstream: 'dnsproxy' }),
  ...[
    { t: 1000, s: 'google.com', k: 'cold', ms: 30, rc: 3, n: 0, ttl: null, fw: 1 },
    { t: 1030, s: 'google.com', k: 'up', ms: 26, rc: 3, n: 0, ttl: null, fw: null },
    { t: 1060, s: 'google.com', k: 'warm', ms: 14, rc: 0, n: 1, ttl: 60, fw: 1 },
    { t: 1080, s: 'google.com', k: 'again', ms: 0.06, rc: 0, n: 1, ttl: 60, fw: 0 },
    { t: 11000, s: 'google.com', k: 'cold', ms: 40, rc: 3, n: 0, ttl: null, fw: 1 },
    { t: 11040, s: 'google.com', k: 'up', ms: 32, rc: 3, n: 0, ttl: null, fw: null },
    { t: 11080, s: 'google.com', k: 'warm', ms: 0.05, rc: 0, n: 1, ttl: 50, fw: 0 },
    // another device's lookup at that moment: dnsmasq passed something on
    { t: 11090, s: 'google.com', k: 'again', ms: 0.05, rc: 0, n: 1, ttl: 50, fw: 1 },
    { t: 1100, s: 'reddit.com', k: 'cold', ms: 22, rc: 0, n: 1, ttl: 60, fw: 1 },
    { t: 1130, s: 'reddit.com', k: 'up', ms: null, rc: null, n: 0, ttl: null, fw: null },
    { t: 1200, s: 'apple.com', k: 'cold', ms: 20, rc: 2, n: 0, ttl: null, fw: 1 },
  ].map((l) => JSON.stringify({ p: 3, ...l })),
  '{"broken": true}',
  'not json',
];

test('the router’s lookups: what it forwards to, each lookup, junk left out', () => {
  const d = parseDns(dnsLines);
  assert.equal(d.upstream, 'dnsproxy');
  assert.equal(d.lookups.length, 11);
  assert.equal(parseDns([]).upstream, null);
});

test('per site: made-up names, the upstream alone, the site twice; what came from the cache', () => {
  const sites = routerSites(parseDns(dnsLines).lookups);
  assert.deepEqual(
    sites.map((s) => s.site),
    ['google.com', 'reddit.com', 'apple.com'],
  );
  const g = sites[0];
  assert.ok(g !== undefined);
  assert.equal(g.cold.median, 35);
  assert.equal(g.up.median, 29);
  // the site's own lookups: two passed on (14 ms, and 0.05 ms at a moment another device's went out), two from the cache
  assert.deepEqual([g.passedOn.n, g.fromCache.n, g.fromCache.median], [2, 2, 0.055]);
  assert.deepEqual([g.rounds, g.cachedFirst], [2, 1]);
  assert.ok(!g.wildcard);
  // reddit answers made-up names; its upstream lookup went unanswered
  assert.equal(sites[1]?.wildcard, true);
  assert.equal(sites[1].up.failed, 1);
  // an error that isn't "no such name"
  assert.equal(sites[2]?.errors, 1);
  // dnsmasq adds the difference, over sites with both
  assert.equal(dnsmasqAdds(sites), 6);
  // a window: the first round only
  assert.equal(routerSites(parseDns(dnsLines).lookups, { from: 0, to: 2000 })[0]?.cold.median, 30);
});

// ---- A device's page loads and lookups ----

test('a device’s loads per site: first and repeats, failures; made-up names that got answers are left out', () => {
  const recs: RunRecord[] = [
    ['cold', 'google.com', 1000, 25, 'failed'],
    ['page', 'google.com', 1030, 120, 'first'],
    ['page', 'google.com', 1150, 40, 'repeat'],
    ['cold', 'google.com', 6000, 35, 'failed'],
    ['page', 'google.com', 6040, 44, 'repeat'],
    ['page', 'google.com', 6090, 48, 'repeat'],
    ['cold', 'reddit.com', 1200, 180, 'answered'],
    ['page', 'reddit.com', 1400, 90, 'first'],
    ['page', 'reddit.com', 1500, null, 'repeat'],
    ['cold', 'bbc.co.uk', 1600, null, 'timeout'],
    ['page', 'bbc.co.uk', 1700, 200, 'first'],
    ['cold', 'apple.com', 1800, 31, 'failed'],
    ['page', 'apple.com', 1850, 100, 'first'],
  ];
  const sites = deviceSites(recs);
  const g = sites.get('google.com');
  assert.deepEqual([g?.first, g?.repeats, g?.lookups], [120, [40, 44, 48], [25, 35]]);
  assert.equal(sites.get('reddit.com')?.answered, 1);
  assert.equal(sites.get('reddit.com')?.failed, 1);
  // apple.com: the router saw it answer made-up names, so its device lookup isn't one
  const wild = wildcardSites([{ site: 'apple.com', wildcard: true } as never], [sites]);
  assert.deepEqual([...wild].sort(), ['apple.com', 'reddit.com']);
  const sum = deviceSummary(sites, wild);
  // lookups: google's median (30) only; first loads: 120, 90, 200, 100; repeats: google's 44
  assert.equal(sum.lookup, 30);
  assert.equal(sum.first, 110);
  assert.equal(sum.repeat, 44);
  assert.equal(sum.failed, 1);
  assert.equal(sum.sites, 4);
  // a window
  assert.deepEqual(deviceSites(recs, { from: 5000, to: 7000 }).get('google.com')?.repeats, [44, 48]);
});

test('page and lookup records are checked before they’re used', () => {
  const good: unknown[][] = [
    ['cold', 'google.com', 1000, 25.5, 'failed'],
    ['cold', 'bbc.co.uk', 1000, null, 'timeout'],
    ['page', 'google.com', 1000, 120, 'first'],
    ['page', 'google.com', 1000, null, 'repeat'],
  ];
  const bad: unknown[][] = [
    ['cold', 'not a site', 1000, 25, 'failed'],
    ['cold', 'google.com', 1000, 25, 'maybe'],
    ['page', 'google.com', 'then', 120, 'first'],
    ['page', 'google.com', 1000, 120, 'third'],
  ];
  assert.equal(memberRecords([JSON.stringify({ m: 'm1', seq: 0, records: [...good, ...bad] })]).length, good.length);
});
