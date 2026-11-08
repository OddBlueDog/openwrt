// The VPN client page's sections, from its settings: which devices get marked,
// the routing rules that send them into the tunnel or nowhere, the leak blocks,
// the Smart Queue inside the tunnel, and what the next save does to all of it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blankForm, type ClientData, type ClientForm, drift, fromConf, removal, sources, toChanges, validate, wanted } from '../src/features/vpn-client/model.ts';
import { CLIENT_MARK } from '../src/features/vpn-client/sections.ts';
import { ipToInt } from '../src/lib/api/network.ts';
import type { Wanted } from '../src/lib/api/owned.ts';
import type { WgConf } from '../src/lib/api/wireguard.ts';
import { applied, nameOf, presentOf, section } from './uci-fixture.ts';

const KEY = `${'a'.repeat(42)}A=`;
const OTHER = `${'b'.repeat(42)}E=`;
const MAC = 'aa:bb:cc:dd:ee:01';

const form = (over: Partial<ClientForm> = {}): ClientForm => ({
  enabled: true,
  privateKey: KEY,
  addresses: ['10.64.12.7/32'],
  mtu: '',
  publicKey: OTHER,
  presharedKey: '',
  endpointHost: 'vpn.example.com',
  endpointPort: '51820',
  keepalive: '25',
  who: 'all',
  macs: [],
  guests: [],
  killSwitch: true,
  shaper: false,
  downMbit: '',
  upMbit: '',
  ...over,
});

const data = (f: ClientForm = form(), over: Partial<ClientData> = {}): ClientData => ({
  installed: true,
  exists: false,
  form: f,
  peerSection: 'wg_out_server',
  present: { network: [], firewall: [], sqm: [] },
  wanZone: 'wan',
  lanZone: 'lan',
  guestZones: [{ id: 'guest', label: 'My visitors!' }],
  devices: [],
  sqm: true,
  wanRates: { down: 500, up: 100 },
  lan: { ip: ipToInt('192.168.1.1') ?? 0, prefix: 24 },
  taken: [{ ip: ipToInt('192.168.9.1') ?? 0, prefix: 24, name: 'Guests' }],
  ...over,
});

const names = (w: readonly Wanted[]): string[] => w.map((s) => s.name);
const get = (w: readonly Wanted[], name: string): Wanted => {
  const s = w.find((x) => x.name === name);
  assert.ok(s !== undefined, `${name} is wanted: ${names(w).join(' ')}`);
  return s;
};
const onRouter = (f: ClientForm): ClientData['present'] => {
  const p = presentOf(wanted(f, data(f)));
  return { network: p['network'] ?? [], firewall: p['firewall'] ?? [], sqm: p['sqm'] ?? [] };
};

test('everyone at home: one mark for the zone, no device list, nobody skipped', () => {
  const w = wanted(form(), data());
  assert.equal(get(w, 'wg_out_mark_lan').values['src_mac'], undefined);
  assert.equal(get(w, 'wg_out_mark_lan').values['set_xmark'], CLIENT_MARK);
  assert.ok(!names(w).includes('wg_out_skip'));
  assert.deepEqual(sources(form()), ['lan']);
});

test('only some devices: the mark lists them', () => {
  const w = wanted(form({ who: 'only', macs: [MAC] }), data());
  assert.deepEqual(get(w, 'wg_out_mark_lan').values['src_mac'], [MAC]);
  assert.ok(!names(w).includes('wg_out_skip'));
});

test('everyone but some: the skip comes after the mark, which it undoes', () => {
  const w = wanted(form({ who: 'except', macs: [MAC] }), data());
  assert.ok(names(w).indexOf('wg_out_skip') > names(w).indexOf('wg_out_mark_lan'), 'firewall rules run in file order');
  assert.equal(get(w, 'wg_out_mark_lan').values['src_mac'], undefined);
  assert.deepEqual(get(w, 'wg_out_skip').values['src_mac'], [MAC]);
  // the mark's bits cleared, whatever else is set
  assert.equal(get(w, 'wg_out_skip').values['set_xmark'], '0x0/0xf0000000');
});

test('turning the skip on later adds it after a mark that is already there', () => {
  const before = form();
  const after = form({ who: 'except', macs: [MAC] });
  const present = onRouter(before);
  const changes = toChanges(after, data(after, { present }));
  assert.deepEqual(changes.filter((c) => c.op === 'add').map(nameOf), ['wg_out_skip']);
  const firewall = applied({ firewall: present.firewall }, changes)['firewall'] ?? [];
  const order = firewall.map((s) => s['.name']);
  assert.ok(order.indexOf('wg_out_skip') > order.indexOf('wg_out_mark_lan'));
});

test('no home devices but a guest network: only its zone, its name made fit for fw4', () => {
  const f = form({ who: 'none', guests: ['guest'] });
  const w = wanted(f, data(f));
  assert.deepEqual(sources(f), ['guest']);
  assert.ok(!names(w).some((n) => n.endsWith('_lan')));
  assert.equal(get(w, 'wg_out_guest').values['src'], 'guest');
  assert.equal(get(w, 'wg_out_mark_guest').values['name'], 'Mark-VPN-My-visitors-');
  assert.equal(get(w, 'wg_out_mark_guest').values['src_mac'], undefined);
  assert.equal(get(w, 'wg_out_leak_guest').values['name'], 'Block-VPN-Leak-My-visitors-');
});

test('home devices and guests together: each zone has its forwarding, mark and block', () => {
  const f = form({ guests: ['guest', 'guest3'] });
  const w = wanted(f, data(f));
  assert.deepEqual(sources(f), ['lan', 'guest', 'guest3']);
  for (const z of ['lan', 'guest', 'guest3']) for (const part of ['', 'mark_', 'leak_']) get(w, `wg_out_${part}${z}`);
});

test('routing: past the main table’s own routes, then the tunnel, then nowhere', () => {
  const w = wanted(form(), data());
  const main = get(w, 'wg_out_main').values;
  assert.equal(main['lookup'], 'main');
  assert.equal(main['suppress_prefixlength'], '0');
  assert.equal(main['priority'], '1000');
  assert.equal(main['mark'], CLIENT_MARK);
  const via = get(w, 'wg_out_via').values;
  assert.equal(via['lookup'], '2100');
  assert.equal(via['priority'], '1001');
  const kill = get(w, 'wg_out_kill').values;
  assert.equal(kill['action'], 'unreachable');
  assert.equal(kill['priority'], '1002');
  assert.equal(get(w, 'wg_out').values['ip4table'], '2100');
});

test('the kill switch off: no unreachable rule and no leak block', () => {
  const f = form({ killSwitch: false });
  const w = wanted(f, data(f));
  assert.ok(!names(w).includes('wg_out_kill'));
  assert.ok(!names(w).includes('wg_out_leak_lan'));
});

test('the leak block drops marked traffic that would leave by the internet zone', () => {
  const v = get(wanted(form(), data()), 'wg_out_leak_lan').values;
  assert.equal(v['dest'], 'wan');
  assert.equal(v['mark'], CLIENT_MARK);
  assert.equal(v['target'], 'DROP');
  assert.equal(v['family'], 'any');
});

test('a tunnel without IPv6: their IPv6 goes nowhere, kill switch or not', () => {
  for (const killSwitch of [true, false]) {
    const f = form({ killSwitch });
    const w = wanted(f, data(f));
    assert.equal(get(w, 'wg_out_kill6').values['action'], 'unreachable');
    assert.equal(get(w, 'wg_out_main6').values['lookup'], 'main');
    assert.ok(!names(w).includes('wg_out_via6'));
    assert.equal(get(w, 'wg_out').values['ip6table'], '2100');
    assert.equal(get(w, 'wg_out').type, 'interface');
    assert.equal(w.find((s) => s.config === 'firewall' && s.name === 'wg_out')?.values['masq6'], undefined);
  }
});

test('a tunnel with IPv6: into its table, nowhere only with the kill switch', () => {
  const addresses = ['10.64.12.7/32', 'fd00::7/128'];
  const on = form({ addresses });
  const w = wanted(on, data(on));
  assert.equal(get(w, 'wg_out_via6').values['lookup'], '2100');
  assert.equal(get(w, 'wg_out_kill6').values['action'], 'unreachable');
  assert.equal(w.find((s) => s.config === 'firewall' && s.name === 'wg_out')?.values['masq6'], '1');
  const off = form({ addresses, killSwitch: false });
  assert.ok(!names(wanted(off, data(off))).includes('wg_out_kill6'));
});

test('turned off: every part stays and is off, so LuCI shows it and nothing routes', () => {
  const f = form({ enabled: false, shaper: true, downMbit: '100', upMbit: '20' });
  const w = wanted(f, data(f));
  for (const name of ['wg_out_main', 'wg_out_via', 'wg_out_kill', 'wg_out_main6', 'wg_out_kill6']) assert.equal(get(w, name).values['disabled'], '1', name);
  assert.equal(w.find((s) => s.config === 'network' && s.name === 'wg_out')?.values['disabled'], '1');
  assert.equal(w.find((s) => s.config === 'firewall' && s.name === 'wg_out')?.values['enabled'], '0');
  for (const name of ['wg_out_lan', 'wg_out_mark_lan', 'wg_out_leak_lan']) assert.equal(get(w, name).values['enabled'], '0', name);
  assert.equal(w.find((s) => s.config === 'sqm')?.values['enabled'], '0');
});

test('on again: the off options are unset rather than set to on', () => {
  const off = form({ enabled: false });
  const on = form();
  const changes = toChanges(on, data(on, { present: onRouter(off) }));
  assert.deepEqual(changes.find((c) => nameOf(c) === 'wg_out_main' && c.op === 'unset'), { op: 'unset', config: 'network', section: 'wg_out_main', options: ['disabled'] });
  assert.ok(!changes.some((c) => c.op === 'set' && (c.values['enabled'] === '1' || c.values['disabled'] === '0')));
});

test('the queue inside the tunnel: made with the rates in kbit, each way fair per device', () => {
  const f = form({ shaper: true, downMbit: '460.5', upMbit: '92' });
  const v = wanted(f, data(f)).find((s) => s.config === 'sqm')?.values;
  assert.equal(v?.['interface'], 'wg_out');
  assert.equal(v['download'], '460500');
  assert.equal(v['upload'], '92000');
  assert.equal(v['iqdisc_opts'], 'dual-dsthost nat');
  assert.equal(v['eqdisc_opts'], 'dual-srchost nat');
});

test('the queue goes when its switch does, and is left out where SQM isn’t installed', () => {
  const was = form({ shaper: true, downMbit: '100', upMbit: '20' });
  const now = form();
  const changes = toChanges(now, data(now, { present: onRouter(was) }));
  assert.deepEqual(changes, [{ op: 'delete', config: 'sqm', section: 'wg_out' }]);
  const noSqm = data(was, { present: { network: [], firewall: [], sqm: undefined } });
  assert.ok(!toChanges(was, noSqm).some((c) => c.config === 'sqm'));
  assert.ok(!removal(noSqm).some((c) => c.config === 'sqm'));
});

test('the next save with the same settings changes nothing', () => {
  for (const f of [
    form(),
    form({ who: 'only', macs: [MAC] }),
    form({ who: 'except', macs: [MAC], guests: ['guest'] }),
    form({ who: 'none', guests: ['guest2'], killSwitch: false }),
    form({ enabled: false }),
    form({ addresses: ['10.64.12.7/32', 'fd00::7/128'], mtu: '1380', presharedKey: KEY }),
    form({ shaper: true, downMbit: '100', upMbit: '20' }),
  ]) {
    const d = data(f, { present: onRouter(f), exists: true });
    assert.deepEqual(toChanges(f, d), [], JSON.stringify(f));
    assert.deepEqual(drift(d), []);
  }
});

test('what someone changed in LuCI shows as drift; options the page doesn’t manage stay', () => {
  const f = form();
  const present = onRouter(f);
  const rule = present.network.find((s) => s['.name'] === 'wg_out_main');
  assert.ok(rule !== undefined);
  rule['priority'] = '50';
  rule['in'] = 'lan';
  assert.deepEqual(drift(data(f, { present, exists: true })), [{ op: 'set', config: 'network', section: 'wg_out_main', values: { priority: '1000' } }]);
});

test('settings no longer needed go; going from “only” to everyone unsets the list', () => {
  const was = form({ who: 'only', macs: [MAC], guests: ['guest'], addresses: ['10.64.12.7/32', 'fd00::7/128'] });
  const now = form({ addresses: ['10.64.12.7/32'] });
  const changes = toChanges(now, data(now, { present: onRouter(was) }));
  assert.deepEqual(changes.find((c) => c.op === 'unset' && c.section === 'wg_out_mark_lan'), { op: 'unset', config: 'firewall', section: 'wg_out_mark_lan', options: ['src_mac'] });
  const gone = changes.filter((c) => c.op === 'delete').map(nameOf);
  for (const name of ['wg_out_guest', 'wg_out_mark_guest', 'wg_out_leak_guest', 'wg_out_via6']) assert.ok(gone.includes(name), name);
  assert.ok(!gone.includes('wg_out_kill6'), 'kept: a tunnel without IPv6 needs it');
});

test('Remove takes every part, a peer LuCI made included, and nothing else', () => {
  const f = form({ guests: ['guest'], shaper: true, downMbit: '100', upMbit: '20' });
  const present = onRouter(f);
  present.network.push(section('wireguard_wg_out', 'cfg123abc'), section('interface', 'lan'));
  present.firewall.push(section('rule', 'Allow-Ping'));
  const left = applied({ network: present.network, firewall: present.firewall, sqm: present.sqm ?? [] }, removal(data(f, { present })));
  assert.deepEqual(left['network']?.map((s) => s['.name']), ['lan']);
  assert.deepEqual(left['firewall']?.map((s) => s['.name']), ['Allow-Ping']);
  assert.deepEqual(left['sqm'], []);
});

test('a blank tunnel that’s off can be saved; on, or half filled in, it can’t', () => {
  const blank = blankForm(data());
  assert.deepEqual(validate(blank, data(blank)), {});
  const on = { ...blank, enabled: true };
  const errors = validate(on, data(on));
  for (const field of ['private', 'public', 'host', 'addresses']) assert.notEqual(errors[field], undefined, field);
  const half = { ...blank, endpointHost: 'vpn.example.com' };
  assert.notEqual(validate(half, data(half))['private'], undefined);
});

test('a new tunnel starts with its rates under the internet port’s, and everything on', () => {
  const blank = blankForm(data());
  assert.equal(blank.downMbit, '460');
  assert.equal(blank.upMbit, '92');
  assert.equal(blank.shaper, true);
  assert.equal(blank.killSwitch, true);
  assert.equal(blankForm({ sqm: true, wanRates: undefined }).shaper, false);
  assert.equal(blankForm({ sqm: false, wanRates: { down: 500, up: 100 } }).shaper, false);
});

test('its address can’t be inside one of the router’s networks, and IPv4 is required', () => {
  const check = (addresses: string[]): string | undefined => {
    const f = form({ addresses });
    return validate(f, data(f))['addresses'];
  };
  assert.equal(check(['10.64.12.7/32']), undefined);
  assert.equal(check(['10.64.12.7']), undefined);
  assert.match(check(['192.168.1.77/32']) ?? '', /192\.168\.1\.77 is inside/);
  assert.match(check(['192.168.9.2/32']) ?? '', /inside/);
  // a provider's wide network that holds the home network
  assert.match(check(['192.168.1.2/16']) ?? '', /inside/);
  assert.notEqual(check(['fd00::7/128']), undefined);
  assert.notEqual(check([]), undefined);
  assert.equal(check(['10.64.12.7/32', ' ', 'fd00::7/128']), undefined);
});

test('the rest of its checks', () => {
  const error = (over: Partial<ClientForm>, field: string): string | undefined => {
    const f = form(over);
    return validate(f, data(f))[field];
  };
  assert.notEqual(error({ presharedKey: 'nope' }, 'psk'), undefined);
  assert.equal(error({ endpointHost: 'fd00::1' }, 'host'), undefined);
  assert.equal(error({ endpointHost: '203.0.113.9' }, 'host'), undefined);
  assert.notEqual(error({ endpointHost: 'bad_name!' }, 'host'), undefined);
  for (const endpointPort of ['0', '65536', 'x', '']) assert.notEqual(error({ endpointPort }, 'port'), undefined, endpointPort);
  for (const mtu of ['1279', '1501', 'x']) assert.notEqual(error({ mtu }, 'mtu'), undefined, mtu);
  for (const mtu of ['', '1280', '1500']) assert.equal(error({ mtu }, 'mtu'), undefined, mtu);
  assert.equal(error({ keepalive: '0' }, 'keepalive'), undefined);
  assert.notEqual(error({ keepalive: 'often' }, 'keepalive'), undefined);
  assert.notEqual(error({ who: 'only' }, 'macs'), undefined);
  assert.notEqual(error({ who: 'except' }, 'macs'), undefined);
  assert.notEqual(error({ who: 'only', macs: ['nope'] }, 'macs'), undefined);
  assert.notEqual(error({ who: 'none' }, 'who'), undefined);
  assert.equal(error({ who: 'none', guests: ['guest'] }, 'who'), undefined);
  assert.notEqual(error({ shaper: true, downMbit: '100' }, 'shaper'), undefined);
  assert.notEqual(error({ shaper: true, downMbit: '0', upMbit: '10' }, 'shaper'), undefined);
  assert.equal(error({ shaper: true, downMbit: '0.5', upMbit: '10' }, 'shaper'), undefined);
});

test('a provider’s config fills in its part of the form and leaves the rest', () => {
  const conf: WgConf = {
    privateKey: KEY,
    addresses: ['10.2.0.2/32'],
    dns: [],
    mtu: '1400',
    peer: { publicKey: OTHER, presharedKey: '', endpointHost: 'x.example.net', endpointPort: '', keepalive: '' },
  } as unknown as WgConf;
  const f = fromConf(form({ who: 'only', macs: [MAC], killSwitch: false }), conf);
  assert.equal(f.endpointHost, 'x.example.net');
  assert.equal(f.endpointPort, '51820');
  assert.equal(f.keepalive, '25');
  assert.equal(f.mtu, '1400');
  assert.equal(f.who, 'only');
  assert.deepEqual(f.macs, [MAC]);
  assert.equal(f.killSwitch, false);
});
