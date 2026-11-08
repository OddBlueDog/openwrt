// The Remote access page's sections, from its settings: moving the tunnel,
// the checks on its port and addresses, what each switch opens, and off
// against Remove.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { confFileName, drift, freeAddress, moveTo, newPeerSection, nextPeerIp, peerConfig, type PeerForm, reachOf, removal, type ServerData, type ServerForm, subnetOf, toChanges, validate, wanted } from '../src/features/remote-access/model.ts';
import { ipToInt } from '../src/lib/api/network.ts';
import type { Wanted } from '../src/lib/api/owned.ts';
import { applied, presentOf, section } from './uci-fixture.ts';

const KEY = `${'a'.repeat(42)}A=`;
const OTHER = `${'b'.repeat(42)}E=`;

const peer = (over: Partial<PeerForm> = {}): PeerForm => ({
  section: 'wg_in_device1',
  name: 'Phone',
  ip: '10.42.17.2',
  otherIps: [],
  enabled: true,
  publicKey: KEY,
  privateKey: OTHER,
  presharedKey: '',
  ...over,
});

const form = (over: Partial<ServerForm> = {}): ServerForm => ({
  enabled: true,
  address: '10.42.17.1',
  prefix: 24,
  extraAddresses: [],
  port: '51820',
  endpoint: '',
  internet: true,
  lan: true,
  admin: false,
  between: false,
  privateKey: KEY,
  peers: [peer()],
  ...over,
});

const data = (f: ServerForm = form(), over: Partial<ServerData> = {}): ServerData => ({
  installed: true,
  exists: false,
  form: f,
  publicKey: OTHER,
  present: { network: [], firewall: [], milkflint: [] },
  wanZone: 'wan',
  lanZone: 'lan',
  lan: { ip: ipToInt('192.168.1.1') ?? 0, prefix: 24 },
  taken: [{ ip: ipToInt('10.64.0.1') ?? 0, prefix: 16, name: 'VPN' }],
  wan: { ipv4: '203.0.113.5', ipv6: undefined, gateway: undefined },
  dnsIntercept: false,
  portsInUse: [],
  forwards: [],
  ...over,
});

const get = (w: readonly Wanted[], name: string, config?: string): Wanted => {
  const s = w.find((x) => x.name === name && (config === undefined || x.config === config));
  assert.ok(s !== undefined, name);
  return s;
};
const onRouter = (f: ServerForm, over: Partial<ServerData> = {}): ServerData['present'] => {
  const p = presentOf(wanted(f, data(f, over)));
  return { network: p['network'] ?? [], firewall: p['firewall'] ?? [], milkflint: p['milkflint'] ?? [] };
};

test('moving the tunnel keeps each device’s host number', () => {
  const moved = moveTo(form({ peers: [peer({ ip: '10.42.17.2' }), peer({ section: 'b', ip: '10.42.17.200' })] }), '10.99.3.1');
  assert.equal(moved.address, '10.99.3.1');
  assert.deepEqual(moved.peers.map((p) => p.ip), ['10.99.3.2', '10.99.3.200']);
});

test('on a wider network, the host part kept is all of it', () => {
  const f = form({ address: '10.42.0.1', prefix: 16, peers: [peer({ ip: '10.42.7.9' })] });
  assert.equal(moveTo(f, '10.43.0.1').peers[0]?.ip, '10.43.7.9');
});

test('half-typed addresses move nothing', () => {
  const f = form();
  assert.deepEqual(moveTo(f, '10.42').peers, f.peers);
  assert.equal(moveTo(f, '10.42').address, '10.42');
  const odd = form({ peers: [peer({ ip: 'typing' })] });
  assert.equal(moveTo(odd, '10.99.3.1').peers[0]?.ip, 'typing');
});

test('its UDP port can’t be one in use, or one a port forward sends on', () => {
  const error = (f: Partial<ServerForm>, d: Partial<ServerData> = {}): string | undefined => validate(form(f), data(form(f), d))['port'];
  assert.equal(error({}), undefined);
  for (const port of ['0', '65536', 'x', '']) assert.notEqual(error({ port }), undefined, port);
  assert.match(error({}, { portsInUse: [51820] }) ?? '', /already uses/);
  for (const spec of ['51820', '51000-52000', '51000:52000', '80 51820']) {
    assert.match(error({}, { forwards: [{ name: 'Game', port: spec }] }) ?? '', /“Game”/, spec);
  }
  for (const spec of ['51821', '51000-51819', '80 443', '']) {
    assert.equal(error({}, { forwards: [{ name: 'Game', port: spec }] }), undefined, spec);
  }
});

test('the router’s address: private, not an end of its network, not on another network', () => {
  const error = (over: Partial<ServerForm>): string | undefined => validate(form(over), data(form(over)))['address'];
  assert.equal(error({ address: '172.31.0.1' }), undefined);
  assert.notEqual(error({ address: '172.32.0.1' }), undefined);
  assert.notEqual(error({ address: '8.8.8.8' }), undefined);
  assert.notEqual(error({ address: 'nope' }), undefined);
  assert.match(error({ address: '10.42.17.0' }) ?? '', /first or last/);
  assert.match(error({ address: '10.42.17.255' }) ?? '', /first or last/);
  assert.match(error({ address: '192.168.1.9' }) ?? '', /home network/);
  assert.match(error({ address: '10.64.200.1' }) ?? '', /VPN network/);
});

test('its devices: unique names and addresses, inside the network, real keys', () => {
  const errors = (peers: PeerForm[]): Record<string, string | undefined> => validate(form({ peers }), data(form({ peers })));
  assert.deepEqual(errors([peer(), peer({ section: 's2', name: 'Laptop', ip: '10.42.17.3' })]), {});
  assert.notEqual(errors([peer(), peer({ section: 's2', name: 'PHONE ', ip: '10.42.17.3' })])['peer-s2-name'], undefined);
  assert.equal(errors([peer({ name: '' }), peer({ section: 's2', name: '', ip: '10.42.17.3' })])['peer-s2-name'], undefined, 'blank names may repeat');
  assert.match(errors([peer(), peer({ section: 's2', name: 'L', ip: '10.42.17.2' })])['peer-s2-ip'] ?? '', /Another device/);
  for (const ip of ['10.42.18.2', '10.42.17.1', '10.42.17.0', '10.42.17.255', 'x']) {
    assert.notEqual(errors([peer({ ip })])['peer-wg_in_device1-ip'], undefined, ip);
  }
  assert.notEqual(errors([peer({ publicKey: 'x' })])['peer-wg_in_device1-key'], undefined);
});

test('what each switch opens', () => {
  const closed = wanted(form({ internet: false, lan: false }), data());
  const zone = get(closed, 'wg_in', 'firewall').values;
  assert.equal(zone['input'], 'REJECT');
  assert.equal(zone['forward'], 'REJECT');
  assert.ok(!closed.some((s) => s.type === 'forwarding'));
  const open = wanted(form({ admin: true, between: true }), data());
  assert.equal(get(open, 'wg_in', 'firewall').values['input'], 'ACCEPT');
  assert.equal(get(open, 'wg_in', 'firewall').values['forward'], 'ACCEPT');
  assert.equal(get(open, 'wg_in_wan').values['dest'], 'wan');
  assert.equal(get(open, 'wg_in_lan').values['dest'], 'lan');
  assert.equal(get(open, 'wg_in_port').values['dest_port'], '51820');
  assert.equal(get(open, 'wg_in_port').values['src'], 'wan');
  // DNS from the router, whichever switches are off
  assert.equal(get(closed, 'wg_in_dns').values['dest_port'], '53');
});

test('a switch turned off takes its forwarding out', () => {
  const f = form({ lan: false });
  const changes = toChanges(f, data(f, { present: onRouter(form()) }));
  assert.deepEqual(changes, [{ op: 'delete', config: 'firewall', section: 'wg_in_lan' }]);
});

test('off keeps every part, turned off, and closes the port', () => {
  const f = form({ enabled: false });
  const w = wanted(f, data(f));
  assert.equal(get(w, 'wg_in', 'network').values['disabled'], '1');
  assert.equal(get(w, 'wg_in', 'firewall').values['enabled'], '0');
  assert.equal(get(w, 'wg_in_port').values['enabled'], '0');
  assert.equal(get(w, 'wg_in_dns').values['enabled'], '0');
  assert.equal(get(w, 'wg_in_wan').values['enabled'], '0');
  get(w, 'wg_in_device1');
  const changes = toChanges(f, data(f, { present: onRouter(form()) }));
  assert.ok(!changes.some((c) => c.op === 'delete'), 'off deletes nothing');
});

test('Remove deletes every part, what LuCI added included, and nothing else', () => {
  const f = form({ endpoint: 'home.example.com' });
  const present = onRouter(f, { dnsIntercept: true });
  present.network.push(section('wireguard_wg_in', 'cfg0abc'), section('interface', 'lan'));
  present.firewall.push(section('rule', 'Allow-Ping'));
  present.milkflint.push(section('dns', 'dns'));
  const left = applied({ network: present.network, firewall: present.firewall, milkflint: present.milkflint }, removal(data(f, { present })));
  assert.deepEqual(left['network']?.map((s) => s['.name']), ['lan']);
  assert.deepEqual(left['firewall']?.map((s) => s['.name']), ['Allow-Ping']);
  assert.deepEqual(left['milkflint']?.map((s) => s['.name']), ['dns']);
});

test('addresses and networks set in LuCI are kept', () => {
  const f = form({ extraAddresses: ['fd42::1/64'], peers: [peer({ otherIps: ['192.168.50.0/24'] })] });
  const w = wanted(f, data(f));
  assert.deepEqual(get(w, 'wg_in', 'network').values['addresses'], ['10.42.17.1/24', 'fd42::1/64']);
  assert.deepEqual(get(w, 'wg_in_device1').values['allowed_ips'], ['10.42.17.2/32', '192.168.50.0/24']);
});

test('a device with no private key here, or paused, is written as it is', () => {
  const f = form({ peers: [peer({ privateKey: '', enabled: false, name: ' ' })] });
  const v = get(wanted(f, data(f)), 'wg_in_device1').values;
  assert.equal(v['private_key'], undefined);
  assert.equal(v['disabled'], '1');
  assert.equal(v['description'], undefined);
});

test('the DNS page’s intercept comes along while it’s on, and goes with the zone', () => {
  const on = wanted(form(), data(form(), { dnsIntercept: true }));
  assert.equal(get(on, 'milkflint_dns_intercept_wg_in').values['src'], 'wg_in');
  const off = wanted(form({ enabled: false }), data(form(), { dnsIntercept: true }));
  assert.equal(get(off, 'milkflint_dns_intercept_wg_in').values['enabled'], '0');
  const f = form();
  const present = onRouter(f, { dnsIntercept: true });
  assert.deepEqual(toChanges(f, data(f, { present })), [{ op: 'delete', config: 'firewall', section: 'milkflint_dns_intercept_wg_in' }]);
});

test('the hostname devices connect to is kept beside it, and removed when cleared', () => {
  const named = form({ endpoint: ' home.example.com ' });
  const present = onRouter(named);
  assert.equal(present.milkflint[0]?.['endpoint'], 'home.example.com');
  const now = form();
  assert.deepEqual(toChanges(now, data(now, { present })), [{ op: 'delete', config: 'milkflint', section: 'remote_access' }]);
});

test('the next save with the same settings changes nothing', () => {
  for (const f of [form(), form({ enabled: false }), form({ admin: true, between: true, internet: false, lan: false }), form({ endpoint: 'x.example.com', peers: [] })]) {
    for (const dnsIntercept of [false, true]) {
      const d = data(f, { present: onRouter(f, { dnsIntercept }), exists: true, dnsIntercept });
      assert.deepEqual(toChanges(f, d), []);
      assert.deepEqual(drift(d), []);
    }
  }
});

test('a new tunnel’s network is free, and a new device gets the next free address', () => {
  for (let i = 0; i < 50; i++) {
    const ip = freeAddress(data());
    assert.match(ip, /^10\.\d+\.\d+\.1$/);
    assert.equal(validate(form({ address: ip, peers: [] }), data())['address'], undefined, ip);
  }
  assert.equal(nextPeerIp(form({ peers: [] })), '10.42.17.2');
  assert.equal(nextPeerIp(form({ peers: [peer(), peer({ ip: '10.42.17.4' })] })), '10.42.17.3');
  assert.equal(nextPeerIp(form({ address: '10.42.17.2', peers: [] })), '10.42.17.1');
  assert.equal(nextPeerIp(form({ address: '10.42.17.1', prefix: 30, peers: [peer({ ip: '10.42.17.2' })] })), undefined);
  assert.equal(nextPeerIp(form({ address: 'x' })), undefined);
  const d = data(form(), { present: { network: [section('wireguard_wg_in', 'wg_in_device2')], firewall: [], milkflint: [] } });
  assert.equal(newPeerSection(form(), d), 'wg_in_device3');
});

test('how the internet reaches it', () => {
  const reach = (ipv4: string | undefined): string => reachOf({ ipv4, ipv6: undefined, gateway: undefined });
  assert.equal(reach(undefined), 'none');
  assert.equal(reach('203.0.113.5'), 'public');
  assert.equal(reach('192.168.0.5'), 'private');
  assert.equal(reach('10.1.1.1'), 'private');
  assert.equal(reach('172.16.0.1'), 'private');
  assert.equal(reach('172.32.0.1'), 'public');
  assert.equal(reach('100.64.0.1'), 'shared');
  assert.equal(reach('100.127.255.254'), 'shared');
  assert.equal(reach('100.128.0.1'), 'public');
  assert.equal(reach('100.63.255.255'), 'public');
});

test('a device’s config: everything through home, or only home’s networks', () => {
  const p = peer();
  const all = peerConfig(p, form(), data(), true) ?? '';
  assert.match(all, /AllowedIPs = 0\.0\.0\.0\/0, ::\/0/);
  assert.match(all, /Endpoint = 203\.0\.113\.5:51820/);
  assert.match(all, /Address = 10\.42\.17\.2\/32/);
  assert.match(all, /DNS = 10\.42\.17\.1/);
  const split = peerConfig(p, form({ endpoint: 'home.example.com' }), data(), false) ?? '';
  assert.match(split, /AllowedIPs = 10\.42\.17\.0\/24, 192\.168\.1\.0\/24/);
  assert.match(split, /Endpoint = home\.example\.com:51820/);
  // nothing to make one from
  assert.equal(peerConfig(peer({ privateKey: '' }), form(), data(), true), undefined);
  assert.equal(peerConfig(p, form(), data(form(), { publicKey: undefined }), true), undefined);
  assert.equal(peerConfig(p, form(), data(form(), { wan: { ipv4: undefined, ipv6: undefined, gateway: undefined } }), true), undefined);
});

test('names and subnets', () => {
  assert.equal(subnetOf('10.42.17.9', 24), '10.42.17.0/24');
  assert.equal(subnetOf('x', 24), '');
  assert.equal(confFileName(peer({ name: 'Tom’s phone (new one!)' })), 'Tom-s-phone-new.conf');
  assert.equal(confFileName(peer({ name: '', ip: '10.0.0.2' })), 'Device-10.0.0.2.conf');
  assert.equal(confFileName(peer({ name: '💥' })), 'home.conf');
});
