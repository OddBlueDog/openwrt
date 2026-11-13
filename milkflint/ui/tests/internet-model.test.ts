// The Internet page's changes: the client ID (DHCP option 61) as text or hex,
// the provider's VLAN, PPPoE's IPv6 on wan6, and what going between them leaves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromStored, hexToText, textToHex, toStored } from '../src/features/internet/client-id.ts';
import { type InternetForm, sqmQueueTo, toChanges, validate, wanPort } from '../src/features/internet/model.ts';
import { sqmData } from '../src/features/sqm/model.ts';
import type { Change, Section } from '../src/lib/api/uci.ts';
import { applied, section } from './uci-fixture.ts';

const form = (over: Partial<InternetForm> = {}): InternetForm => ({
  proto: 'dhcp',
  username: '',
  password: '',
  ipaddr: '',
  netmask: '255.255.255.0',
  gateway: '',
  staticDns: '',
  ipv6: true,
  wan6Exists: true,
  wan6Device: 'eth1',
  port: 'eth1',
  vlan: '',
  vlanSection: undefined,
  clientIdMode: 'text',
  clientId: '',
  sqmQueue: undefined,
  ...over,
});

const wanValues = (changes: readonly Change[]): Record<string, string | string[]> => {
  const c = changes.find((x) => x.op === 'set' && x.section === 'wan');
  assert.ok(c?.op === 'set');
  return c.values;
};
const wanUnset = (changes: readonly Change[]): string[] => {
  const c = changes.find((x) => x.op === 'unset' && x.section === 'wan');
  assert.ok(c?.op === 'unset');
  return c.options;
};
const wan6 = (changes: readonly Change[]): Change | undefined => changes.find((c) => c.op === 'set' && c.section === 'wan6');
const sqmChanges = (changes: readonly Change[]): Change[] => changes.filter((c) => c.config === 'sqm');

/** Smart Queue's queue as sqm-scripts ships it (section eth1), with Fibre / Ethernet */
const fibreQueue = (values: Record<string, string> = {}): Section =>
  section('queue', 'eth1', { enabled: '1', interface: 'eth1', download: '80000', upload: '20000', linklayer: 'ethernet', overhead: '44', tcMPU: '84', linklayer_advanced: '1', ...values });

test('client ID: text goes out as hex and reads back as text', () => {
  const sky = 'username@skydsl|password';
  const stored = toStored('text', sky);
  assert.equal(stored, textToHex(sky));
  assert.deepEqual(fromStored(stored), { mode: 'text', value: sky });
  assert.equal(hexToText('61:62-63 64'), 'abcd');
});

test('client ID: bytes that aren’t text stay hex', () => {
  assert.deepEqual(fromStored('01aabbcc'), { mode: 'hex', value: '01aabbcc' });
  assert.equal(hexToText('01aabbcc'), undefined);
  assert.equal(toStored('hex', '01:AA-bb cc'), '01aabbcc');
  assert.equal(toStored('hex', 'abc'), undefined);
  assert.equal(toStored('hex', 'xy'), undefined);
});

test('client ID: not hex at all, as OpenWrt would ignore it, shows as it is', () => {
  assert.deepEqual(fromStored('not hex!'), { mode: 'text', value: 'not hex!' });
  assert.deepEqual(fromStored(''), { mode: 'text', value: '' });
});

test('client ID: 255 bytes at most, counted in bytes', () => {
  assert.equal(toStored('text', ''), '');
  assert.equal(toStored('text', 'x'.repeat(255))?.length, 510);
  assert.equal(toStored('text', 'x'.repeat(256)), undefined);
  assert.equal(toStored('text', 'é'.repeat(128)), undefined, '256 bytes in 128 characters');
  assert.equal(toStored('text', 'é'.repeat(127))?.length, 508);
  assert.equal(toStored('hex', 'ab'.repeat(256)), undefined);
  assert.equal(toStored('hex', 'ab'.repeat(255))?.length, 510);
  assert.equal(textToHex('é'), 'c3a9');
});

test('client ID: written only when edited, unset when cleared, sendclientid out of the way', () => {
  const before = form();
  assert.equal(wanValues(toChanges(form(), before))['clientid'], undefined);
  const set = toChanges(form({ clientId: 'abc' }), before);
  assert.equal(wanValues(set)['clientid'], '616263');
  assert.ok(wanUnset(set).includes('sendclientid'));
  assert.ok(wanUnset(toChanges(form(), form({ clientId: 'abc' }))).includes('clientid'));
  // a value OpenWrt can't use stays until it's edited
  const odd = form({ clientId: 'not hex!' });
  assert.ok(!wanUnset(toChanges(odd, odd)).includes('clientid'));
  assert.equal(wanValues(toChanges(odd, odd))['clientid'], undefined);
});

test('wan’s device as a port and a VLAN', () => {
  const vlanDev = section('device', 'wan_vlan', { type: '8021q', name: 'eth1.911', ifname: 'eth1', vid: '911' });
  assert.deepEqual(wanPort([vlanDev], 'eth1.911'), { port: 'eth1', vlan: '911', vlanSection: 'wan_vlan' });
  // netifd's own way: a name like eth1.911
  assert.deepEqual(wanPort([], 'eth1.101'), { port: 'eth1', vlan: '101', vlanSection: undefined });
  assert.deepEqual(wanPort([], 'wan'), { port: 'wan', vlan: '', vlanSection: undefined });
  // a bridge device isn't a VLAN by name
  assert.deepEqual(wanPort([section('device', 'x', { type: 'bridge', name: 'br-wan' })], 'br-wan'), { port: 'br-wan', vlan: '', vlanSection: undefined });
});

test('adding a VLAN: an 802.1q device, wan and wan6 on it', () => {
  const before = form();
  const changes = toChanges(form({ vlan: '911' }), before);
  assert.deepEqual(changes[0], { op: 'add', config: 'network', type: 'device', name: 'wan_vlan', values: { type: '8021q', ifname: 'eth1', vid: '911', name: 'eth1.911' } });
  assert.equal(wanValues(changes)['device'], 'eth1.911');
  assert.deepEqual(wan6(changes), { op: 'set', config: 'network', section: 'wan6', values: { device: 'eth1.911' } });
});

test('changing a VLAN rewrites its section; taking it away deletes it and goes back to the port', () => {
  const before = form({ vlan: '911', vlanSection: 'cfg0a', wan6Device: 'eth1.911' });
  const moved = toChanges(form({ vlan: '101', vlanSection: 'cfg0a', wan6Device: 'eth1.911' }), before);
  assert.deepEqual(moved[0], { op: 'set', config: 'network', section: 'cfg0a', values: { type: '8021q', ifname: 'eth1', vid: '101', name: 'eth1.101' } });
  assert.equal(wanValues(moved)['device'], 'eth1.101');
  const gone = toChanges(form({ vlan: '', vlanSection: 'cfg0a', wan6Device: 'eth1.911' }), before);
  assert.deepEqual(gone[0], { op: 'delete', config: 'network', section: 'cfg0a' });
  assert.equal(wanValues(gone)['device'], 'eth1');
  assert.deepEqual(wan6(gone), { op: 'set', config: 'network', section: 'wan6', values: { device: 'eth1' } });
});

test('a VLAN by name only (netifd’s): nothing to delete when it goes', () => {
  const before = form({ vlan: '101', wan6Device: 'eth1.101' });
  const changes = toChanges(form({ wan6Device: 'eth1.101' }), before);
  assert.ok(!changes.some((c) => c.op === 'delete'));
  assert.equal(wanValues(changes)['device'], 'eth1');
});

test('the VLAN unchanged: wan’s device isn’t written', () => {
  assert.equal(wanValues(toChanges(form(), form()))['device'], undefined);
});

test('to PPPoE: its login, IPv6 on the link, wan6 following wan’s connection', () => {
  const changes = toChanges(form({ proto: 'pppoe', username: 'u', password: 'p' }), form());
  const v = wanValues(changes);
  assert.equal(v['proto'], 'pppoe');
  assert.equal(v['username'], 'u');
  assert.equal(v['password'], 'p');
  assert.equal(v['ipv6'], '1');
  assert.deepEqual(wan6(changes), { op: 'set', config: 'network', section: 'wan6', values: { device: '@wan' } });
});

test('PPPoE with IPv6 off asks for none, and wan6 is off', () => {
  const changes = toChanges(form({ proto: 'pppoe', username: 'u', ipv6: false }), form());
  assert.equal(wanValues(changes)['ipv6'], '0');
  assert.deepEqual(wan6(changes), { op: 'set', config: 'network', section: 'wan6', values: { device: '@wan', disabled: '1' } });
});

test('from PPPoE: wan6 goes back on the port, and the login comes out', () => {
  const before = form({ proto: 'pppoe', username: 'u', password: 'p', wan6Device: '@wan' });
  const changes = toChanges(form({ wan6Device: '@wan' }), before);
  assert.ok(wanUnset(changes).includes('username'));
  assert.ok(wanUnset(changes).includes('password'));
  assert.ok(wanUnset(changes).includes('ipv6'));
  assert.deepEqual(wan6(changes), { op: 'set', config: 'network', section: 'wan6', values: { device: 'eth1' } });
});

test('from PPPoE to a VLAN on the port: wan6 on the VLAN', () => {
  const before = form({ proto: 'pppoe', username: 'u', wan6Device: '@wan' });
  assert.deepEqual(wan6(toChanges(form({ vlan: '911', wan6Device: '@wan' }), before)), { op: 'set', config: 'network', section: 'wan6', values: { device: 'eth1.911' } });
});

test('wan6 on @wan set in LuCI under DHCP stays there', () => {
  const f = form({ wan6Device: '@wan' });
  assert.equal(wan6(toChanges(f, f)), undefined);
});

test('a VLAN under PPPoE: the link on the VLAN, wan6 still following it', () => {
  const before = form({ proto: 'pppoe', username: 'u', wan6Device: '@wan' });
  const changes = toChanges(form({ proto: 'pppoe', username: 'u', vlan: '101', wan6Device: '@wan' }), before);
  assert.equal(wanValues(changes)['device'], 'eth1.101');
  assert.equal(wan6(changes), undefined);
});

test('no wan6 section: one on @wan is added when IPv6 is on, none when it’s off', () => {
  assert.deepEqual(toChanges(form({ wan6Exists: false }), form({ wan6Exists: false, ipv6: false })).at(-1), { op: 'add', config: 'network', type: 'interface', name: 'wan6', values: { device: '@wan', proto: 'dhcpv6' } });
  assert.ok(!toChanges(form({ wan6Exists: false, ipv6: false }), form({ wan6Exists: false, ipv6: false })).some((c) => c.op === 'add'));
});

test('a fixed address: its DNS servers, and the provider’s ignored; away, they all come out', () => {
  const fixed = form({ proto: 'static', ipaddr: '203.0.113.2', netmask: '255.255.255.0', gateway: '203.0.113.1', staticDns: '1.1.1.1, 9.9.9.9' });
  const v = wanValues(toChanges(fixed, form()));
  assert.deepEqual(v['dns'], ['1.1.1.1', '9.9.9.9']);
  assert.equal(v['peerdns'], '0');
  assert.equal(v['ipaddr'], '203.0.113.2');
  const u = wanUnset(toChanges(form(), fixed));
  for (const option of ['ipaddr', 'netmask', 'gateway', 'dns', 'peerdns']) assert.ok(u.includes(option), option);
});

test('its checks', () => {
  assert.deepEqual(validate(form()), {});
  assert.notEqual(validate(form({ proto: 'pppoe' })).username, undefined);
  const s = validate(form({ proto: 'static', ipaddr: 'x', netmask: '', gateway: '1.2.3', staticDns: '' }));
  for (const field of ['ipaddr', 'netmask', 'gateway', 'staticDns'] as const) assert.notEqual(s[field], undefined, field);
  assert.notEqual(validate(form({ proto: 'static', ipaddr: '1.1.1.2', gateway: '1.1.1.1', staticDns: '1.1.1.1 fd00::1' })).staticDns, undefined);
  for (const vlan of ['0', '4095', 'x', '12345']) assert.notEqual(validate(form({ vlan })).vlan, undefined, vlan);
  for (const vlan of ['', '1', '4094']) assert.equal(validate(form({ vlan })).vlan, undefined, vlan);
  assert.notEqual(validate(form({ clientIdMode: 'hex', clientId: 'xyz' })).clientId, undefined);
  assert.notEqual(validate(form({ clientId: 'x'.repeat(256) })).clientId, undefined);
  assert.equal(validate(form({ proto: 'pppoe', username: 'u', clientIdMode: 'hex', clientId: 'xyz' })).clientId, undefined, 'only DHCP sends one');
});

test('to PPPoE: Smart Queue moves onto the session, with Fibre / Ethernet’s overhead there', () => {
  const q = fibreQueue();
  const changes = toChanges(form({ proto: 'pppoe', username: 'u', sqmQueue: q }), form({ sqmQueue: q }));
  assert.deepEqual(sqmChanges(changes), [{ op: 'set', config: 'sqm', section: 'eth1', values: { interface: 'pppoe-wan', overhead: '52' } }]);
  // the Smart Queue page then has it as Fibre / Ethernet, on the session, with nothing to warn about
  const sqm = applied({ sqm: [q] }, sqmChanges(changes))['sqm'] ?? [];
  const data = sqmData({ sqm, firewall: [], milkflint: [], wanDevice: 'pppoe-wan', wanProto: 'pppoe', devices: [] });
  assert.equal(data.form.device, 'pppoe-wan');
  assert.equal(data.form.device, data.pppoe);
  assert.equal(data.form.link, 'ethernet');
});

test('from PPPoE: back onto the port, with the port’s overhead, under a VLAN too', () => {
  const q = fibreQueue({ interface: 'pppoe-wan', overhead: '52' });
  const before = form({ proto: 'pppoe', username: 'u', wan6Device: '@wan', sqmQueue: q });
  assert.deepEqual(sqmChanges(toChanges(form({ wan6Device: '@wan', sqmQueue: q }), before)), [
    { op: 'set', config: 'sqm', section: 'eth1', values: { interface: 'eth1', overhead: '44' } },
  ]);
  const vlan = form({ proto: 'pppoe', username: 'u', vlan: '911', vlanSection: 'wan_vlan', wan6Device: '@wan', sqmQueue: q });
  assert.deepEqual(sqmChanges(toChanges({ ...vlan, proto: 'dhcp' }, vlan)), [
    { op: 'set', config: 'sqm', section: 'eth1', values: { interface: 'eth1', overhead: '44' } },
  ]);
});

test('to PPPoE from a VLAN: a queue on the port or on the VLAN goes to the session', () => {
  for (const on of ['eth1', 'eth1.911']) {
    const q = fibreQueue({ interface: on });
    const before = form({ vlan: '911', vlanSection: 'wan_vlan', wan6Device: 'eth1.911', sqmQueue: q });
    assert.deepEqual(sqmChanges(toChanges({ ...before, proto: 'pppoe', username: 'u' }, before)), [
      { op: 'set', config: 'sqm', section: 'eth1', values: { interface: 'pppoe-wan', overhead: '52' } },
    ]);
  }
});

test('Smart Queue stays where it is otherwise', () => {
  const q = fibreQueue();
  // no PPPoE either side
  assert.deepEqual(sqmChanges(toChanges(form({ proto: 'static', ipaddr: '203.0.113.2', gateway: '203.0.113.1', staticDns: '1.1.1.1', sqmQueue: q }), form({ sqmQueue: q }))), []);
  assert.deepEqual(sqmChanges(toChanges(form({ vlan: '911', sqmQueue: q }), form({ sqmQueue: q }))), []);
  // PPPoE all along
  const p = form({ proto: 'pppoe', username: 'u', wan6Device: '@wan', sqmQueue: fibreQueue({ interface: 'pppoe-wan', overhead: '52' }) });
  assert.deepEqual(sqmChanges(toChanges({ ...p, username: 'v' }, p)), []);
  // a queue put on another device
  const elsewhere = fibreQueue({ interface: 'lan4' });
  assert.deepEqual(sqmChanges(toChanges(form({ proto: 'pppoe', username: 'u', sqmQueue: elsewhere }), form({ sqmQueue: elsewhere }))), []);
  // no queue, or no sqm
  assert.deepEqual(sqmChanges(toChanges(form({ proto: 'pppoe', username: 'u' }), form())), []);
});

test('custom link options move as they are', () => {
  const q = fibreQueue({ overhead: '40', tcMPU: '64' });
  assert.deepEqual(sqmChanges(toChanges(form({ proto: 'pppoe', username: 'u', sqmQueue: q }), form({ sqmQueue: q }))), [
    { op: 'set', config: 'sqm', section: 'eth1', values: { interface: 'pppoe-wan' } },
  ]);
});

test('where the page says Smart Queue goes, as its changes move it', () => {
  const q = fibreQueue();
  assert.equal(sqmQueueTo(form({ proto: 'pppoe', sqmQueue: q }), form({ sqmQueue: q })), 'pppoe-wan');
  const p = fibreQueue({ interface: 'pppoe-wan', overhead: '52' });
  assert.equal(sqmQueueTo(form({ sqmQueue: p }), form({ proto: 'pppoe', sqmQueue: p })), 'eth1');
  assert.equal(sqmQueueTo(form({ proto: 'static', sqmQueue: q }), form({ sqmQueue: q })), undefined);
  assert.equal(sqmQueueTo(form({ proto: 'pppoe' }), form()), undefined, 'no queue');
});
