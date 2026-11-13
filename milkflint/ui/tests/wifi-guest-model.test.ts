// The Guest Wi-Fi page's changes, from its settings: up to three networks, what
// each kind starts with, where their addresses may go, and the parts each has
// on the router (bridge, DHCP, zone, access points, speed limit, DNS intercept).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cakeEffect } from '../src/features/sqm/advanced.ts';
import { ADDRESSES, bandCreds, blankNet, freeAddress, type GuestData, newForm, type NetData, type NetForm, overlaps, removal, toChanges, validate } from '../src/features/wifi-guest/model.ts';
import { ipToInt } from '../src/lib/api/network.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';
import { applied, nameOf, section } from './uci-fixture.ts';

const range = (ip: string, prefix: number, name = 'Other'): { ip: number; prefix: number; name: string } => ({ ip: ipToInt(ip) ?? 0, prefix, name });

const data = (over: Partial<GuestData> = {}): GuestData => ({
  radios: [
    { name: 'radio0', band: '2g', on: true },
    { name: 'radio1', band: '5g', on: true },
  ],
  nets: [],
  wanZone: 'wan',
  lan: range('192.168.1.1', 24),
  taken: [],
  dtim: '1',
  sqm: true,
  mainSsid: 'Home',
  dnsIntercept: false,
  ...over,
});

const form = (over: Partial<NetForm> = {}): NetForm => ({
  ...newForm('guest', 'visitors', data(), []),
  shared: { ssid: 'Visitors', encryption: 'sae-mixed', cipher: '', key: 'long-enough-key' },
  ...over,
});

const added = (changes: readonly Change[], config: string): string[] => changes.flatMap((c) => (c.op === 'add' && c.config === config ? [c.name ?? ''] : []));
function add(changes: readonly Change[], name: string): Record<string, string | string[]> {
  const c = changes.find((x) => x.op === 'add' && x.name === name);
  assert.ok(c?.op === 'add', `${name} is added: ${changes.map(nameOf).join(' ')}`);
  return c.values;
}

/** A network as it is on the router after the page set it up. */
function existing(f: NetForm, d: GuestData = data()): NetData {
  const present = applied({}, toChanges(f, blankNet(f, d), d));
  const by = (config: string, name: string): ReturnType<typeof section> | undefined => present[config]?.find((s) => s['.name'] === name);
  const firewall = present['firewall'] ?? [];
  return {
    ...blankNet(f, d),
    aps: Object.fromEntries((present['wireless'] ?? []).map((s) => [String(s['device']), s])),
    iface: by('network', f.id),
    device: by('network', `${f.id}_dev`),
    dhcp: by('dhcp', f.id),
    zone: by('firewall', f.id),
    forwardings: firewall.filter((s) => s['.type'] === 'forwarding'),
    rules: firewall.filter((s) => s['.type'] === 'rule'),
    redirects: firewall.filter((s) => s['.type'] === 'redirect'),
    meta: by('milkflint', f.id),
    shaper: d.sqm ? (by('sqm', f.id) ?? null) : undefined,
  };
}

test('networks overlap by the wider of their sizes', () => {
  const a = ipToInt('192.168.9.1') ?? 0;
  assert.ok(overlaps(a, 24, ipToInt('192.168.9.200') ?? 0, 24));
  assert.ok(!overlaps(a, 24, ipToInt('192.168.10.1') ?? 0, 24));
  assert.ok(overlaps(a, 24, ipToInt('192.168.0.1') ?? 0, 16));
  assert.ok(overlaps(ipToInt('192.168.0.1') ?? 0, 16, a, 24));
  assert.ok(overlaps(a, 24, ipToInt('8.8.8.8') ?? 0, 0));
});

test('a new network takes the first address that’s free', () => {
  assert.equal(freeAddress(data(), []), ADDRESSES[0]);
  assert.equal(freeAddress(data({ lan: range('192.168.9.1', 24) }), []), '192.168.10.1');
  assert.equal(freeAddress(data({ taken: [range('192.168.9.77', 24), range('192.168.10.2', 24)] }), []), '192.168.20.1');
  // a wide LAN or WAN takes the whole of 192.168.x
  assert.equal(freeAddress(data({ lan: range('192.168.0.1', 16) }), []), '10.99.0.1');
  assert.equal(freeAddress(data({ taken: [range('10.0.0.1', 8)], lan: range('192.168.0.1', 16) }), []), ADDRESSES[0], 'none free: the first, which validate refuses');
  const first = form({ ipaddr: '192.168.9.1' });
  const second = form({ id: 'guest2', ipaddr: '192.168.10.1' });
  assert.equal(freeAddress(data(), [first]), '192.168.10.1');
  assert.equal(freeAddress(data(), [first, second]), '192.168.20.1');
  assert.equal(freeAddress(data(), [form({ ipaddr: 'typing' })]), ADDRESSES[0]);
});

test('visitors: WPA3 where they can, kept from each other, on every band', () => {
  const f = newForm('guest', 'visitors', data(), []);
  assert.equal(f.shared.encryption, 'sae-mixed');
  assert.equal(f.isolate, true);
  assert.equal(f.leasetime, '1h');
  assert.deepEqual(f.bands, { radio0: true, radio1: true });
  assert.equal(f.shared.ssid, 'Home-Guest');
  assert.equal(f.ipaddr, '192.168.9.1');
  assert.match(f.shared.key, /^[a-km-z2-9]{4}-[a-km-z2-9]{4}-[a-km-z2-9]{4}$/);
});

test('smart home devices: WPA2, may talk to each other, 2.4 GHz only', () => {
  const f = newForm('guest2', 'devices', data(), []);
  assert.equal(f.shared.encryption, 'psk2');
  assert.equal(f.isolate, false);
  assert.equal(f.leasetime, '12h');
  assert.deepEqual(f.bands, { radio0: true, radio1: false });
  assert.equal(f.shared.ssid, 'Home-IoT');
  // no 2.4 GHz radio on: what is on
  const only5 = newForm('guest2', 'devices', data({ radios: [{ name: 'radio0', band: '2g', on: false }, { name: 'radio1', band: '5g', on: true }] }), []);
  assert.deepEqual(only5.bands, { radio0: false, radio1: true });
  // none on: every radio, so the network is ready for when one comes on
  const none = newForm('guest', 'visitors', data({ radios: [{ name: 'radio0', band: '2g', on: false }, { name: 'radio1', band: '5g', on: false }] }), []);
  assert.deepEqual(none.bands, { radio0: true, radio1: true });
});

test('a second and third network get labels and names of their own, within 32 bytes', () => {
  const a = newForm('guest', 'visitors', data(), []);
  const b = newForm('guest2', 'visitors', data(), [a]);
  const c = newForm('guest3', 'visitors', data(), [a, b]);
  assert.deepEqual([a, b, c].map((f) => f.label), ['Guests', 'Guests 2', 'Guests 3']);
  assert.deepEqual([a, b, c].map((f) => f.shared.ssid), ['Home-Guest', 'Home-Guest2', 'Home-Guest3']);
  assert.deepEqual([a, b, c].map((f) => f.ipaddr), ['192.168.9.1', '192.168.10.1', '192.168.20.1']);
  // a main name it wouldn't fit after
  assert.equal(newForm('guest', 'visitors', data({ mainSsid: 'x'.repeat(26) }), []).shared.ssid, 'Guest');
  assert.equal(newForm('guest', 'visitors', data({ mainSsid: undefined }), []).shared.ssid, 'Guest');
});

test('what a new network is made of', () => {
  const f = form();
  const changes = toChanges(f, blankNet(f, data()), data());
  assert.deepEqual(add(changes, 'guest_dev'), { name: 'br-guest', type: 'bridge', bridge_empty: '1' });
    assert.deepEqual(changes.find((c) => c.op === 'add' && c.config === 'network' && c.name === 'guest'), {
    op: 'add',
    config: 'network',
    type: 'interface',
    name: 'guest',
    values: { proto: 'static', device: 'br-guest', ipaddr: ['192.168.9.1/24'] },
  });
  assert.deepEqual(added(changes, 'firewall'), ['guest', 'guest_wan', 'guest_dns', 'guest_dhcp']);
  const zone = changes.find((c) => c.op === 'add' && c.config === 'firewall' && c.name === 'guest');
  assert.ok(zone?.op === 'add');
  assert.equal(zone.values['input'], 'REJECT');
  assert.equal(zone.values['forward'], 'REJECT');
  assert.deepEqual(add(changes, 'guest_wan'), { src: 'guest', dest: 'wan' });
  assert.equal(add(changes, 'guest_dns')['name'], 'Allow-DNS-Guest');
  assert.deepEqual(added(changes, 'wireless'), ['guest_radio0', 'guest_radio1']);
  assert.deepEqual(add(changes, 'guest_radio1'), {
    device: 'radio1',
    mode: 'ap',
    network: 'guest',
    ssid: 'Visitors',
    encryption: 'sae-mixed',
    isolate: '1',
    bridge_isolate: '1',
    key: 'long-enough-key',
    dtim_period: '1',
    disabled: '0',
  });
});

test('every part of guest2 and guest3 is its own', () => {
  for (const id of ['guest2', 'guest3'] as const) {
    const f = form({ id });
    const changes = toChanges(f, blankNet(f, data()), data());
    const n = id.slice(-1);
    assert.equal(add(changes, `${id}_dev`)['name'], `br-guest${n}`);
    assert.equal(add(changes, `${id}_dns`)['name'], `Allow-DNS-Guest${n}`);
    assert.equal(add(changes, `${id}_radio0`)['network'], id);
    assert.equal(changes.find((c) => c.op === 'add' && c.config === 'dhcp')?.config, 'dhcp');
    for (const c of changes) if (c.op === 'add') assert.ok(c.name?.startsWith(id) === true, c.name);
  }
});

test('devices may talk: isolation off, on the radio and across bands', () => {
  const f = form({ isolate: false });
  const v = add(toChanges(f, blankNet(f, data()), data()), 'guest_radio0');
  assert.equal(v['isolate'], '0');
  assert.equal(v['bridge_isolate'], '0');
});

test('saving a network that’s there again leaves its setup alone', () => {
  const f = form();
  const net = existing(f);
  const changes = toChanges(f, net, data());
  assert.deepEqual(changes.filter((c) => c.op === 'add'), []);
  // the access points are set to what's asked, nothing else
  assert.deepEqual(changes.map((c) => (c.op === 'set' ? c.config : c.op)), ['wireless', 'wireless']);
});

test('rules made elsewhere count, unless they’re off or not accepting', () => {
  const f = form();
  const net = existing(f);
  const dns = net.rules.find((r) => r['.name'] === 'guest_dns');
  assert.ok(dns !== undefined);
  dns['enabled'] = '0';
  assert.deepEqual(added(toChanges(f, net, data()), 'firewall'), ['guest_dns']);
  dns['enabled'] = '1';
  dns['target'] = 'DROP';
  assert.deepEqual(added(toChanges(f, net, data()), 'firewall'), ['guest_dns']);
});

test('off: its access points stop and everything else stays', () => {
  const f = form();
  const net = existing(f);
  assert.deepEqual(toChanges(form({ enabled: false }), net, data()), [
    { op: 'set', config: 'wireless', section: 'guest_radio0', values: { disabled: '1' } },
    { op: 'set', config: 'wireless', section: 'guest_radio1', values: { disabled: '1' } },
  ]);
});

test('added and turned off before it was ever saved: nothing to do', () => {
  const f = form({ enabled: false });
  assert.deepEqual(toChanges(f, blankNet(f, data()), data()), []);
});

test('a band turned off keeps its access point, off; on again it’s set back', () => {
  const f = form();
  const net = existing(f);
  const changes = toChanges(form({ bands: { radio0: true, radio1: false } }), net, data());
  assert.deepEqual(changes.find((c) => nameOf(c) === 'guest_radio1'), { op: 'set', config: 'wireless', section: 'guest_radio1', values: { disabled: '1' } });
  assert.equal(changes.find((c): c is Extract<Change, { op: 'set' }> => nameOf(c) === 'guest_radio0' && c.op === 'set')?.values['disabled'], '0');
});

test('each band its own name and password', () => {
  const own = { radio0: { ssid: 'G24', encryption: 'psk2', cipher: '', key: 'password-two-four' }, radio1: { ssid: 'G5', encryption: 'sae', cipher: 'gcmp', key: 'password-five' } };
  const f = form({ same: false, own });
  assert.deepEqual(bandCreds(f, data().radios).map((b) => b.creds.ssid), ['G24', 'G5']);
  const changes = toChanges(f, blankNet(f, data()), data());
  assert.equal(add(changes, 'guest_radio0')['ssid'], 'G24');
  assert.equal(add(changes, 'guest_radio1')['ssid'], 'G5');
  assert.equal(add(changes, 'guest_radio1')['encryption'], 'sae+gcmp', 'a cipher set in LuCI stays');
});

test('an open network has no password written, and an old one is taken out', () => {
  const open = form({ shared: { ssid: 'Open', encryption: 'none', cipher: '', key: '' } });
  const made = add(toChanges(open, blankNet(open, data()), data()), 'guest_radio0');
  assert.equal(made['encryption'], 'none');
  assert.equal(made['key'], undefined);
  const changes = toChanges(open, existing(form()), data());
  assert.ok(changes.some((c) => c.op === 'unset' && c.section === 'guest_radio0' && c.options.includes('key')));
});

test('a new address: the interface moves to it, with any old netmask gone', () => {
  const f = form();
  const net = existing(f);
  const moved = form({ ipaddr: '192.168.50.1' });
  const changes = toChanges(moved, net, data());
  assert.deepEqual(changes.slice(0, 2), [
    { op: 'set', config: 'network', section: 'guest', values: { ipaddr: ['192.168.50.1/24'] } },
    { op: 'unset', config: 'network', section: 'guest', options: ['netmask'] },
  ]);
  assert.ok(!toChanges(moved, { ...net, addressFixed: true }, data()).some((c) => c.config === 'network'), 'set in LuCI: left as it is');
});

test('the speed limit: its own queue, each way as its devices see it', () => {
  const f = form({ downMbit: '50', upMbit: '10.5' });
  const queue = toChanges(f, blankNet(f, data()), data()).find((c) => c.op === 'add' && c.config === 'sqm');
  assert.ok(queue?.op === 'add');
  assert.equal(queue.name, 'guest');
  assert.equal(queue.values['interface'], 'br-guest');
  // egress on the bridge is what they download
  assert.equal(queue.values['upload'], '50000');
  assert.equal(queue.values['download'], '10500');
  assert.equal(queue.values['iqdisc_opts'], 'nonat dual-srchost');
  assert.equal(queue.values['eqdisc_opts'], 'nonat dual-dsthost');
});

test('the speed limit is fair per guest: CAKE’s NAT lookup, which sqm gives it, is off', () => {
  // on the guest bridge, the lookup turns every guest into the router's internet
  // address: one host on the way up, and per connection on the way down
  const f = form({ downMbit: '50', upMbit: '10' });
  const queue = toChanges(f, blankNet(f, data()), data()).find((c) => c.op === 'add' && c.config === 'sqm');
  assert.ok(queue?.op === 'add');
  // as sqm-scripts gives CAKE each direction: its own words first, the queue's after; CAKE takes the last of each kind
  const effect = (key: string): ReturnType<typeof cakeEffect> => cakeEffect(['diffserv3', 'nat', 'besteffort', ...String(queue.values[key]).split(' ')]);
  assert.equal(effect('iqdisc_opts').nat, 'nonat');
  assert.equal(effect('eqdisc_opts').nat, 'nonat');
  assert.equal(effect('iqdisc_opts').isolation, 'dual-srchost');
  assert.equal(effect('eqdisc_opts').isolation, 'dual-dsthost');
});

test('a speed limit set up before keeps its own options: only its speeds and switch are written', () => {
  const limited = form({ downMbit: '50', upMbit: '10' });
  const net = existing(limited);
  assert.ok(net.shaper !== null && net.shaper !== undefined);
  const shaper: Section = { ...net.shaper };
  Object.assign(shaper, { iqdisc_opts: 'dual-srchost', eqdisc_opts: 'dual-dsthost conservative' });
  const luci = { ...net, shaper };
  const changes = toChanges(form({ downMbit: '80', upMbit: '10' }), luci, data()).filter((c) => c.config === 'sqm');
  assert.deepEqual(changes, [{ op: 'set', config: 'sqm', section: 'guest', values: { enabled: '1', upload: '80000', download: '10000' } }]);
});

test('one way only: the other is left alone', () => {
  const f = form({ upMbit: '10' });
  const queue = toChanges(f, blankNet(f, data()), data()).find((c) => c.op === 'add' && c.config === 'sqm');
  assert.ok(queue?.op === 'add');
  assert.equal(queue.values['upload'], '0');
});

test('the speed limit’s life: changed, cleared, back, and not at all without SQM', () => {
  const limited = form({ downMbit: '50', upMbit: '10' });
  const net = existing(limited);
  const sqm = (f: NetForm, n: NetData = net): Change[] => toChanges(f, n, data()).filter((c) => c.config === 'sqm');
  assert.deepEqual(sqm(form({ downMbit: '80', upMbit: '10' })), [{ op: 'set', config: 'sqm', section: 'guest', values: { enabled: '1', upload: '80000', download: '10000' } }]);
  assert.deepEqual(sqm(form()), [{ op: 'set', config: 'sqm', section: 'guest', values: { enabled: '0' } }]);
  // already off: nothing to write
  assert.ok(net.shaper !== null && net.shaper !== undefined);
  assert.deepEqual(sqm(form(), { ...net, shaper: section('queue', net.shaper['.name'], { enabled: '0' }) }), []);
  const noSqm = data({ sqm: false });
  assert.ok(!toChanges(limited, blankNet(limited, noSqm), noSqm).some((c) => c.config === 'sqm'));
});

test('the DNS page’s intercept comes along while it’s on, once', () => {
  const d = data({ dnsIntercept: true });
  const f = form({ id: 'guest2' });
  const changes = toChanges(f, blankNet(f, d), d);
  const v = add(changes, 'milkflint_dns_intercept_guest2');
  assert.equal(v['src'], 'guest2');
  assert.equal(v['target'], 'DNAT');
  assert.equal(v['src_dport'], '53');
  const net = existing(f, d);
  assert.deepEqual(added(toChanges(f, net, d), 'firewall'), []);
  const noIntercept = form();
  assert.ok(!added(toChanges(noIntercept, blankNet(noIntercept, data()), data()), 'firewall').some((n) => n.includes('intercept')));
});

test('its label: written only when it isn’t the default', () => {
  const made = (label: string, id: NetForm['id'] = 'guest'): Change[] => {
    const f = form({ id, label });
    return toChanges(f, blankNet(f, data()), data()).filter((c) => c.config === 'milkflint');
  };
  assert.deepEqual(made('Guests'), []);
  assert.deepEqual(made('Guest network 2', 'guest2'), []);
  assert.deepEqual(made('Friends'), [{ op: 'add', config: 'milkflint', type: 'guest_network', name: 'guest', values: { label: 'Friends' } }]);
  const f = form({ label: 'Friends' });
  const net = existing(f);
  assert.deepEqual(toChanges(form({ label: 'Family' }), net, data()).filter((c) => c.config === 'milkflint'), [{ op: 'set', config: 'milkflint', section: 'guest', values: { label: 'Family' } }]);
  assert.deepEqual(toChanges(form({ label: ' ' }), net, data()).filter((c) => c.config === 'milkflint'), [{ op: 'unset', config: 'milkflint', section: 'guest', options: ['label'] }]);
});

test('Remove takes everything a network is made of, and nothing else', () => {
  const d = data({ dnsIntercept: true });
  const f = form({ downMbit: '50', label: 'Friends' });
  const net = existing(f, d);
  const other = (s: string): ReturnType<typeof section> => section('x', s);
  const present = applied({}, toChanges(f, blankNet(f, d), d));
  for (const sections of Object.values(present)) sections.push(other('kept'));
  const left = applied(present, removal(net));
  for (const [config, sections] of Object.entries(left)) assert.deepEqual(sections.map((s) => s['.name']), ['kept'], config);
});

const errors = (f: NetForm, others: NetForm[] = [], d: GuestData = data()): Record<string, string | undefined> => validate(f, blankNet(f, d), d, others);

test('its address: private, a host, and on no other network', () => {
  assert.deepEqual(errors(form()), {});
  const ip = (ipaddr: string, others: NetForm[] = [], d: GuestData = data()): string | undefined => errors(form({ ipaddr }), others, d)['guest-ip'];
  for (const a of ['192.168.50.1', '10.1.2.3', '172.16.0.1', '172.31.0.1']) assert.equal(ip(a), undefined, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '192.167.0.1', 'x', '']) assert.notEqual(ip(a), undefined, a);
  for (const a of ['192.168.50.0', '192.168.50.255']) assert.match(ip(a) ?? '', /1 to 254/, a);
  assert.match(ip('192.168.1.9') ?? '', /main network/);
  assert.match(ip('192.168.7.1', [], data({ lan: range('192.168.0.1', 16) })) ?? '', /main network/);
  assert.match(ip('192.168.70.1', [], data({ taken: [range('192.168.70.5', 24, 'WAN')] })) ?? '', /\(WAN\)/);
  assert.match(ip('192.168.50.9', [form({ id: 'guest2', ipaddr: '192.168.50.1', label: 'Friends' })]) ?? '', /Friends uses/);
  // one set up in LuCI isn't checked
  const f = form({ ipaddr: '8.8.8.8' });
  assert.deepEqual(validate(f, { ...blankNet(f, data()), addressFixed: true }, data(), []), {});
});

test('its names, passwords, bands and speed', () => {
  assert.notEqual(errors(form({ shared: { ssid: '', encryption: 'none', cipher: '', key: '' } }))['guest-ssid'], undefined);
  assert.notEqual(errors(form({ shared: { ssid: 'é'.repeat(17), encryption: 'none', cipher: '', key: '' } }))['guest-ssid'], undefined, '34 bytes');
  assert.equal(errors(form({ shared: { ssid: 'é'.repeat(16), encryption: 'none', cipher: '', key: '' } }))['guest-ssid'], undefined, '32 bytes');
  assert.notEqual(errors(form({ shared: { ssid: 'x', encryption: 'psk2', cipher: '', key: 'short' } }))['guest-key'], undefined);
  assert.notEqual(errors(form({ label: 'x'.repeat(33) }))['guest-label'], undefined);
  assert.notEqual(errors(form({ bands: { radio0: false, radio1: false } }))['guest-bands'], undefined);
  assert.equal(errors(form({ enabled: false, bands: { radio0: false, radio1: false } }))['guest-bands'], undefined);
  for (const downMbit of ['0.4', '10001', '1.55', 'x']) assert.notEqual(errors(form({ downMbit }))['guest-speed'], undefined, downMbit);
  for (const upMbit of ['', '0.5', '10000', '1.5']) assert.equal(errors(form({ upMbit }))['guest-speed'], undefined, upMbit);
  // own names: only the bands that are on are checked
  const own = { radio0: { ssid: 'G', encryption: 'psk2', cipher: '', key: 'long-enough-key' }, radio1: { ssid: '', encryption: 'psk2', cipher: '', key: 'x' } };
  assert.deepEqual(errors(form({ same: false, own, bands: { radio0: true, radio1: false } })), {});
  const e = errors(form({ same: false, own }));
  assert.notEqual(e['guest-radio1-ssid'], undefined);
  assert.notEqual(e['guest-radio1-key'], undefined);
});
