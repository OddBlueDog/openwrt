// The DNS page's changes: what dnsmasq and dnsproxy forward to, and the redirects
// that catch devices with their own DNS, which must never catch the home
// network's own DNS server (a Pi-hole's lookups would come back to the router).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DnsData, type DnsForm, plan, toChanges, validate } from '../src/features/dns/model.ts';
import type { Change } from '../src/lib/api/uci.ts';
import { section } from './uci-fixture.ts';

const form = (over: Partial<DnsForm> = {}): DnsForm => ({
  mode: 'auto',
  provider: 'cloudflare',
  server: '',
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

const data = (f: DnsForm = form(), over: Partial<DnsData> = {}): DnsData => ({
  form: f,
  dnsmasq: 'cfg01',
  servers: [],
  cacheRr: ['HTTPS'],
  managed: [],
  hasMilkflintDns: true,
  hasProxyCache: true,
  hasStaleCache: false,
  intercepts: [],
  interceptZones: ['lan', 'guest', 'guest2', 'wg_in'],
  proxyInstalled: true,
  proxyEnabled: false,
  lanDhcp: section('dhcp', 'lan', { interface: 'lan' }),
  routerIp: '192.168.1.1',
  prefix: 24,
  ...over,
});

const redirects = (changes: readonly Change[]): Change[] => changes.filter((c) => c.config === 'firewall');
const named = (zone: string): string => (zone === 'lan' ? 'milkflint_dns_intercept' : `milkflint_dns_intercept_${zone}`);
const on = (...zones: string[]): DnsData['intercepts'] => zones.map((z) => ({ section: named(z), enabled: true }));
const set = (changes: readonly Change[], config: string, s: string): Record<string, string | string[]> => {
  const c = changes.find((x) => x.op === 'set' && x.config === config && x.section === s);
  assert.ok(c?.op === 'set', `${config}.${s} is set`);
  return c.values;
};

test('the switch on: a redirect for each zone there is', () => {
  const changes = redirects(toChanges(form({ intercept: true }), data()));
  assert.deepEqual(changes.map((c) => (c.op === 'add' ? c.name : c.op)), [named('lan'), named('guest'), named('guest2'), named('wg_in')]);
  const lan = changes[0];
  assert.ok(lan?.op === 'add');
  assert.equal(lan.type, 'redirect');
  assert.equal(lan.values['src'], 'lan');
  assert.equal(lan.values['src_dport'], '53');
  assert.equal(lan.values['target'], 'DNAT');
});

test('already there: left alone; turned off in LuCI: on again', () => {
  const d = data(form(), { intercepts: [...on('lan', 'guest', 'wg_in'), { section: named('guest2'), enabled: false }] });
  assert.deepEqual(redirects(toChanges(form({ intercept: true }), d)), [{ op: 'set', config: 'firewall', section: named('guest2'), values: { enabled: '1' } }]);
});

test('the switch off: every one goes', () => {
  const d = data(form(), { intercepts: on('lan', 'guest', 'wg_in') });
  assert.deepEqual(redirects(toChanges(form(), d)).map((c) => c.op === 'delete' && c.section), [named('lan'), named('guest'), named('wg_in')]);
});

test('devices told to use a Pi-hole: every redirect goes, or its own lookups come back here', () => {
  const pihole = form({ intercept: true, devices: { own: true, ipv4: '192.168.1.53', ipv6: '' } });
  const d = data(form({ intercept: true }), { intercepts: on('lan', 'guest', 'guest2', 'wg_in') });
  const changes = toChanges(pihole, d);
  assert.deepEqual(redirects(changes).map((c) => c.op === 'delete' && c.section), [named('lan'), named('guest'), named('guest2'), named('wg_in')]);
  assert.deepEqual(set(changes, 'dhcp', 'lan')['dhcp_option'], ['6,192.168.1.53']);
  // and none are added, with nothing there yet
  assert.deepEqual(redirects(toChanges(pihole, data())), []);
});

test('back from the Pi-hole with the switch on: the redirects return', () => {
  const back = form({ intercept: true });
  const d = data(form({ intercept: true, devices: { own: true, ipv4: '192.168.1.53', ipv6: '' } }));
  assert.equal(redirects(toChanges(back, d)).length, 4);
});

test('a redirect whose guest network is gone is taken out', () => {
  const d = data(form(), { intercepts: on('lan', 'guest3'), interceptZones: ['lan'] });
  assert.deepEqual(redirects(toChanges(form({ intercept: true }), d)), [{ op: 'delete', config: 'firewall', section: named('guest3') }]);
});

test('automatic: dnsmasq is left to the provider’s servers', () => {
  assert.deepEqual(plan(form()), { dnsmasq: [], proxy: undefined });
  const changes = toChanges(form(), data());
  assert.ok(changes.some((c) => c.op === 'unset' && c.config === 'milkflint' && c.options.includes('managed')));
  assert.equal(set(changes, 'dhcp', 'cfg01')['noresolv'], undefined);
});

test('leaving a set server: noresolv comes off, and only what the page added goes', () => {
  const was = form({ mode: 'static' });
  const d = data(was, { servers: ['1.1.1.1', '/corp.example/10.0.0.53'], managed: ['1.1.1.1'] });
  const changes = toChanges(form(), d);
  assert.deepEqual(set(changes, 'dhcp', 'cfg01')['server'], ['/corp.example/10.0.0.53'], 'one added in LuCI stays');
  assert.ok(changes.some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('noresolv')));
});

test('plain DNS, two servers: how dnsmasq uses them, and the other way’s option comes off', () => {
  const parallel = form({ mode: 'static', pair: 'parallel' });
  const changes = toChanges(parallel, data());
  assert.equal(set(changes, 'dhcp', 'cfg01')['allservers'], '1');
  assert.equal(set(changes, 'dhcp', 'cfg01')['noresolv'], '1');
  assert.ok(changes.some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('strictorder')));
  const fallback = toChanges(form({ mode: 'static', pair: 'fallback' }), data());
  assert.equal(set(fallback, 'dhcp', 'cfg01')['strictorder'], '1');
  assert.ok(fallback.some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('allservers')));
  // back to one server
  const one = toChanges(form({ mode: 'static' }), data(parallel));
  assert.ok(one.some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('allservers') && c.options.includes('strictorder')));
});

test('encrypted: dnsmasq asks dnsproxy, which is switched on; off again when it’s left', () => {
  const f = form({ mode: 'encrypted' });
  const changes = toChanges(f, data());
  assert.deepEqual(set(changes, 'dhcp', 'cfg01')['server'], ['127.0.0.1#5453']);
  assert.deepEqual(set(changes, 'dhcp', 'cfg01')['noresolv'], '1');
  assert.equal(set(changes, 'dnsproxy', 'global')['enabled'], '1');
  assert.deepEqual(set(changes, 'dnsproxy', 'global')['listen_port'], ['5453']);
  assert.ok((set(changes, 'dnsproxy', 'servers')['upstream']?.length ?? 0) > 0);
  assert.ok(changes.some((c) => c.op === 'unset' && c.config === 'dnsproxy' && c.section === 'servers' && c.options.includes('fallback')));
  const off = toChanges(form(), data(f, { proxyEnabled: true, servers: ['127.0.0.1#5453'], managed: ['127.0.0.1#5453'] }));
  assert.deepEqual(set(off, 'dnsproxy', 'global'), { enabled: '0' });
  assert.ok(off.some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('server')));
});

test('dnsproxy isn’t installed: nothing written for it', () => {
  assert.ok(!toChanges(form({ mode: 'encrypted' }), data(form(), { proxyInstalled: false })).some((c) => c.config === 'dnsproxy'));
});

test('instant answers: dnsproxy’s cache, made if it isn’t there', () => {
  const f = form({ mode: 'encrypted', quick: true, keepHours: '12' });
  const v = set(toChanges(f, data()), 'dnsproxy', 'cache');
  assert.equal(v['enabled'], '1');
  assert.equal(v['cache_optimistic'], '1');
  assert.equal(v['optimistic_max_age'], '12h');
  assert.equal(set(toChanges(form({ mode: 'encrypted' }), data()), 'dnsproxy', 'cache')['enabled'], '0');
  assert.ok(toChanges(f, data(form(), { hasProxyCache: false })).some((c) => c.op === 'add' && c.name === 'cache'));
});

test('no milkflint.dns yet: added rather than set', () => {
  assert.ok(toChanges(form(), data(form(), { hasMilkflintDns: false })).some((c) => c.op === 'add' && c.config === 'milkflint' && c.name === 'dns'));
});

test('host records: added, changed and removed', () => {
  const kept = { key: 'a', section: 'cfg1', name: 'nas', ip: '192.168.1.5' };
  const gone = { key: 'b', section: 'cfg2', name: 'old', ip: '192.168.1.6' };
  const fresh = { key: 'c', section: undefined, name: 'printer', ip: '192.168.1.7' };
  const changes = toChanges(form({ records: [kept, fresh] }), data(form({ records: [kept, gone] }))).filter((c) => c.config === 'dhcp' && (c.op === 'delete' || c.op === 'add' || (c.op === 'set' && c.section === 'cfg1')));
  assert.deepEqual(changes, [
    { op: 'delete', config: 'dhcp', section: 'cfg2' },
    { op: 'set', config: 'dhcp', section: 'cfg1', values: { name: 'nas', ip: '192.168.1.5' } },
    { op: 'add', config: 'dhcp', type: 'domain', values: { name: 'printer', ip: '192.168.1.7' } },
  ]);
});

test('its checks', () => {
  const errors = (f: DnsForm): ReturnType<typeof validate> => validate(f, data(f));
  assert.deepEqual(errors(form()), { form: {}, records: {} });
  assert.notEqual(errors(form({ domain: 'two words' })).form.domain, undefined);
  assert.notEqual(errors(form({ mode: 'static', provider: 'custom', custom: 'not an ip' })).form.custom, undefined);
  assert.equal(errors(form({ mode: 'static', provider: 'custom', custom: '1.1.1.1, fd00::1' })).form.custom, undefined);
  assert.notEqual(errors(form({ mode: 'encrypted', provider: 'custom', custom: 'http://x' })).form.custom, undefined);
  assert.equal(errors(form({ mode: 'encrypted', provider: 'custom', custom: 'https://dns.example/dns-query' })).form.custom, undefined);
  assert.notEqual(errors(form({ mode: 'static', pair: 'parallel', provider: 'quad9', backup: 'quad9' })).form.backup, undefined);
  assert.notEqual(errors(form({ devices: { own: true, ipv4: '192.168.1.1', ipv6: '' } })).form.ownIpv4, undefined);
  assert.notEqual(errors(form({ records: [{ key: 'k', section: undefined, name: 'bad name', ip: '1.2.3.4' }] })).records['k'], undefined);
  assert.notEqual(errors(form({ records: [{ key: 'k', section: undefined, name: 'nas', ip: 'x' }] })).records['k'], undefined);
});

test('the cache: its size, empty for the default, and HTTPS records beside others from LuCI', () => {
  const values = (f: Partial<DnsForm>, over: Partial<DnsData> = {}): Record<string, string | string[]> => set(toChanges(form(f), data(form(), over)), 'dhcp', 'cfg01');
  assert.equal(values({ cacheSize: '5000' })['cachesize'], '5000');
  assert.equal(values({ cacheSize: '' })['cachesize'], '1000');
  assert.equal(values({ cacheSize: '007' })['cachesize'], '7');
  assert.equal(values({ cacheOn: false, cacheSize: '5000' })['cachesize'], '0');
  assert.deepEqual(values({})['cache_rr'], ['HTTPS']);
  assert.deepEqual(values({}, { cacheRr: ['TXT', 'https'] })['cache_rr'], ['TXT', 'HTTPS']);
  assert.deepEqual(values({ cacheHttps: false }, { cacheRr: ['TXT', '65'] })['cache_rr'], ['TXT']);
});

test('the cache: HTTPS records off, the list goes, if there was one', () => {
  const unset = (over: Partial<DnsData>): Change | undefined =>
    toChanges(form({ cacheHttps: false }), data(form(), over)).find((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('cache_rr'));
  assert.ok(unset({ cacheRr: ['HTTPS'] }) !== undefined);
  assert.equal(unset({ cacheRr: [] }), undefined);
});

test('the cache: its size is a whole number within reason', () => {
  const error = (cacheSize: string): string | undefined => validate(form({ cacheSize }), data()).form.cacheSize;
  for (const ok of ['', '1', '1000', '100000']) assert.equal(error(ok), undefined, ok);
  for (const bad of ['x', '-1', '0', '1.5', '100001']) assert.ok(error(bad) !== undefined, bad);
  // off, what's in the box doesn't matter
  assert.equal(validate(form({ cacheOn: false, cacheSize: 'x' }), data()).form.cacheSize, undefined);
});

const chosen = { provider: 'cloudflare', server: 'Standard' } as const;

test('reusing expired answers: dnsmasq does it for automatic and plain DNS, in seconds', () => {
  const stale = (f: Partial<DnsForm>): unknown => set(toChanges(form(f), data()), 'dhcp', 'cfg01')['use_stale_cache'];
  assert.equal(stale({ quick: true }), '86400');
  assert.equal(stale({ ...chosen, mode: 'static', quick: true, keepHours: '1' }), '3600');
  assert.equal(stale({ quick: false }), undefined);
  assert.equal(stale({ quick: true, cacheOn: false }), undefined);
  // dnsproxy does it for encrypted DNS: never both
  assert.equal(stale({ ...chosen, mode: 'encrypted', quick: true }), undefined);
  const proxy = set(toChanges(form({ ...chosen, mode: 'encrypted', quick: true }), data(form(), { proxyInstalled: true })), 'dnsproxy', 'cache');
  assert.equal(proxy['cache_optimistic'], '1');
});

test('reusing expired answers: dnsmasq\'s option goes when it no longer applies, if it was there', () => {
  const unsets = (f: Partial<DnsForm>, hasStaleCache: boolean): boolean =>
    toChanges(form(f), data(form(), { hasStaleCache })).some((c) => c.op === 'unset' && c.config === 'dhcp' && c.options.includes('use_stale_cache'));
  assert.equal(unsets({ quick: false }, true), true);
  assert.equal(unsets({ quick: true, cacheOn: false }, true), true);
  assert.equal(unsets({ ...chosen, mode: 'encrypted', quick: true }, true), true);
  assert.equal(unsets({ quick: true }, true), false);
  assert.equal(unsets({ quick: false }, false), false);
});

test('caching off stops the encrypted server\'s cache too, whatever its switch says', () => {
  const encrypted = { mode: 'encrypted', provider: 'cloudflare', server: 'Standard', quick: true } as const;
  const on = set(toChanges(form(encrypted), data(form(), { proxyInstalled: true })), 'dnsproxy', 'cache');
  assert.equal(on['enabled'], '1');
  const off = set(toChanges(form({ ...encrypted, cacheOn: false }), data(form(), { proxyInstalled: true })), 'dnsproxy', 'cache');
  assert.equal(off['enabled'], '0');
  assert.equal(off['cache_optimistic'], '0');
});
