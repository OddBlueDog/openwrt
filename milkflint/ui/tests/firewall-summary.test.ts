// The Firewall and Port forwards pages' answers, worked out from the config:
// what the internet can reach, whose rules there are, how OpenWrt's standard
// rules fold away in the table and where a rule moves to around them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firewallSummary, foldOpenWrt, moveTarget, namesText, ruleOrigin } from '../src/features/firewall/summary.ts';
import { parseFirewall } from '../src/features/firewall/model.ts';
import { forwardsSummary, headline, portText } from '../src/features/port-forwards/summary.ts';
import { section } from './uci-fixture.ts';

// OpenWrt's own config, as a fresh install has it (trimmed)
const stock = [
  section('defaults', 'defaults', { input: 'REJECT', output: 'ACCEPT', forward: 'DROP' }),
  section('zone', 'lan', { name: 'lan', network: ['lan'], input: 'ACCEPT', output: 'ACCEPT', forward: 'ACCEPT' }),
  section('zone', 'wan', { name: 'wan', network: ['wan', 'wan6'], input: 'DROP', output: 'ACCEPT', forward: 'DROP', masq: '1' }),
  section('forwarding', 'fwd', { src: 'lan', dest: 'wan' }),
  section('rule', 'r1', {
    name: 'Allow-DHCP-Renew',
    src: 'wan',
    proto: 'udp',
    dest_port: '68',
    target: 'ACCEPT',
    family: 'ipv4',
  }),
  section('rule', 'r2', {
    name: 'Allow-Ping',
    src: 'wan',
    proto: 'icmp',
    icmp_type: 'echo-request',
    target: 'ACCEPT',
    enabled: '0',
  }),
  section('rule', 'r3', { name: 'Allow-ICMPv6-Input', src: 'wan', proto: 'icmp', target: 'ACCEPT', family: 'ipv6' }),
  section('rule', 'r4', { name: 'Allow-ISAKMP', src: 'wan', dest: 'lan', dest_port: '500', proto: 'udp', target: 'ACCEPT' }),
];

test('a fresh install: closed both ways, apart from OpenWrt’s standard rules', () => {
  const s = firewallSummary(parseFirewall(stock));
  assert.equal(s.router.reach, 'closed');
  // Allow-Ping is off, so it doesn't count
  assert.equal(s.router.openwrt, 2);
  assert.deepEqual(s.router.opened, []);
  assert.equal(s.devices.reach, 'closed');
  assert.equal(s.devices.openwrt, 1);
  assert.deepEqual(s.rules, { own: 0, page: 0, openwrt: 4, off: 1, blocks: 0 });
});

test('a rule of yours to the router, a port forward and UPnP: some ports open', () => {
  const cfg = parseFirewall([
    ...stock,
    section('rule', 'wg', { name: 'Allow-WireGuard', src: 'wan', proto: 'udp', dest_port: '51820', target: 'ACCEPT' }),
    section('rule', 'blk', {
      name: 'Block tv',
      src: '*',
      dest: 'wan',
      src_mac: 'aa:bb:cc:dd:ee:ff',
      proto: 'all',
      target: 'REJECT',
    }),
    section('redirect', 'mc', {
      name: 'Minecraft',
      src: 'wan',
      dest: 'lan',
      proto: 'tcp',
      src_dport: '25565',
      dest_ip: '192.168.1.20',
      target: 'DNAT',
    }),
  ]);
  const s = firewallSummary(cfg, 2);
  assert.equal(s.router.reach, 'some');
  assert.deepEqual(
    s.router.opened.map((r) => r.name),
    ['Allow-WireGuard'],
  );
  assert.equal(s.devices.reach, 'some');
  assert.equal(s.devices.forwards, 1);
  assert.equal(s.devices.upnp, 2);
  assert.equal(s.devices.dmz, false);
  assert.deepEqual(s.rules, { own: 2, page: 0, openwrt: 4, off: 1, blocks: 1 });
});

test('open: the internet zone accepts, a forwarding from it, or the defaults forward everything', () => {
  const wanOpen = stock.map((x) =>
    x['.name'] === 'wan' ? section('zone', 'wan', { name: 'wan', network: ['wan', 'wan6'], input: 'ACCEPT', masq: '1' }) : x,
  );
  assert.equal(firewallSummary(parseFirewall(wanOpen)).router.reach, 'open');
  const forwarding = firewallSummary(parseFirewall([...stock, section('forwarding', 'f2', { src: 'wan', dest: 'lan' })]));
  assert.equal(forwarding.devices.reach, 'open');
  assert.deepEqual(forwarding.devices.zones, ['lan']);
  const defaults = stock.map((x) =>
    x['.type'] === 'defaults' ? section('defaults', 'defaults', { input: 'REJECT', output: 'ACCEPT', forward: 'ACCEPT' }) : x,
  );
  assert.deepEqual(firewallSummary(parseFirewall(defaults)).devices.zones, ['lan']);
  // a forwarding that's off opens nothing
  assert.equal(
    firewallSummary(parseFirewall([...stock, section('forwarding', 'f2', { src: 'wan', dest: 'lan', enabled: '0' })])).devices
      .reach,
    'closed',
  );
});

test('rules made by another page count as theirs, not yours or OpenWrt’s', () => {
  const cfg = parseFirewall([
    ...stock,
    section('rule', 'guest_dns', { name: 'Allow-Guest-DNS', src: 'guest', proto: 'udp', dest_port: '53', target: 'ACCEPT' }),
  ]);
  const r = cfg.rules.find((x) => x.section === 'guest_dns');
  assert.ok(r !== undefined);
  assert.equal(ruleOrigin(r), 'page');
});

test('folding: each run of OpenWrt’s rules is one row in its place; shown, every rule is a row', () => {
  const cfg = parseFirewall([
    ...stock.slice(0, 5),
    section('rule', 'mine', { name: 'Allow-SSH', src: 'wan', proto: 'tcp', dest_port: '22', target: 'ACCEPT' }),
    ...stock.slice(5),
  ]);
  const toRouter = cfg.rules.filter((r) => r.dest === undefined);
  const rows = foldOpenWrt(toRouter, false);
  assert.deepEqual(
    rows.map((r) => (r.kind === 'rule' ? r.rule.section : r.rules.map((x) => x.section).join('+'))),
    ['r1', 'mine', 'r2+r3'],
  );
  assert.equal(foldOpenWrt(toRouter, true).length, 4);
  assert.ok(foldOpenWrt(toRouter, true).every((r) => r.kind === 'rule'));
  // moving steps over a folded run whole
  assert.equal(moveTarget(rows, 'mine', 'up'), 'r1');
  assert.equal(moveTarget(rows, 'mine', 'down'), 'r3');
  assert.equal(moveTarget(foldOpenWrt(toRouter, true), 'mine', 'down'), 'r2');
  assert.equal(moveTarget(rows, 'r1', 'up'), undefined);
});

test('rule names in a sentence', () => {
  const cfg = parseFirewall(stock);
  assert.equal(namesText(cfg.rules.slice(0, 1)), 'Allow-DHCP-Renew');
  assert.equal(namesText(cfg.rules.slice(0, 2)), 'Allow-DHCP-Renew and Allow-Ping');
  assert.equal(namesText(cfg.rules), 'Allow-DHCP-Renew, Allow-Ping and 2 more');
});

test('port forwards: which ports go to which device, UPnP’s among them', () => {
  const cfg = parseFirewall([
    ...stock,
    section('redirect', 'mc', {
      name: 'Minecraft',
      src: 'wan',
      dest: 'lan',
      proto: 'tcp',
      src_dport: '25565',
      dest_ip: '192.168.1.20',
      target: 'DNAT',
    }),
    section('redirect', 'web', {
      name: 'Web',
      src: 'wan',
      dest: 'lan',
      proto: 'tcp',
      src_dport: '8080',
      dest_port: '80',
      dest_ip: '192.168.1.20',
      target: 'DNAT',
    }),
    section('redirect', 'old', {
      name: 'Old',
      src: 'wan',
      dest: 'lan',
      src_dport: '27015-27030',
      dest_ip: '192.168.1.30',
      target: 'DNAT',
      enabled: '0',
    }),
    section('redirect', 'wg', { name: 'WireGuard', src: 'wan', proto: 'udp', src_dport: '51820', target: 'DNAT' }),
    // the DNS page's intercept: inside the network, not from the internet
    section('redirect', 'dns_int', { name: 'Intercept-DNS', src: 'lan', proto: 'tcp udp', src_dport: '53', target: 'DNAT' }),
  ]);
  const mappings = [{ proto: 'UDP', ext_port: 3074, int_addr: '192.168.1.40', int_port: 3074, description: 'Xbox' }];
  const s = forwardsSummary(cfg, '81.2.69.142', true, mappings);
  assert.equal(s.forwards, 3);
  assert.equal(s.off, 1);
  assert.equal(s.upnp, 1);
  assert.equal(s.reach, 'public');
  assert.deepEqual(
    s.destinations.map((d) => [d.ip, d.ports.map((p) => p.text)]),
    [
      ['192.168.1.20', ['tcp 25565', 'tcp 8080 → 80']],
      [undefined, ['udp 51820']],
      ['192.168.1.40', ['udp 3074']],
    ],
  );
  assert.equal(headline(s), '4 ports open to 2 devices and the router');
  // UPnP off: its old mappings don't count
  assert.equal(forwardsSummary(cfg, '81.2.69.142', false, mappings).upnp, undefined);
});

test('port forwards: reachable or not, and the headline', () => {
  const cfg = parseFirewall(stock);
  assert.equal(forwardsSummary(cfg, '10.0.2.15', undefined, undefined).reach, 'private');
  assert.equal(forwardsSummary(cfg, '100.64.1.2', undefined, undefined).reach, 'cgnat');
  assert.equal(forwardsSummary(cfg, undefined, undefined, undefined).reach, 'none');
  assert.equal(headline(forwardsSummary(cfg, undefined, undefined, undefined)), 'No ports open');
  const dmz = parseFirewall([
    ...stock,
    section('redirect', 'd', { name: 'DMZ', src: 'wan', dest: 'lan', proto: 'all', dest_ip: '192.168.1.9', target: 'DNAT' }),
  ]);
  const s = forwardsSummary(dmz, '81.2.69.142', undefined, undefined);
  assert.equal(s.destinations[0]?.dmz, true);
  assert.equal(headline(s), 'Every port open to one device');
  const one = parseFirewall([
    ...stock,
    section('redirect', 'p', {
      name: 'Plex',
      src: 'wan',
      dest: 'lan',
      proto: 'tcp',
      src_dport: '32400',
      dest_ip: '192.168.1.9',
      target: 'DNAT',
    }),
  ]);
  assert.equal(headline(forwardsSummary(one, undefined, undefined, undefined)), '1 port open to 1 device');
});

test('a forward’s ports as the summary shows them', () => {
  const [r] = parseFirewall([
    section('redirect', 'x', { src: 'wan', src_dport: '27015:27030', dest_ip: '192.168.1.2' }),
  ]).redirects;
  assert.ok(r !== undefined);
  assert.equal(portText(r), 'tcp/udp 27015–27030');
});

test('a port forward to the router itself opens the router, not your devices', () => {
  const s = firewallSummary(
    parseFirewall([
      ...stock,
      section('redirect', 'wg', { name: 'WireGuard', src: 'wan', proto: 'udp', src_dport: '51820', target: 'DNAT' }),
    ]),
  );
  assert.equal(s.router.reach, 'some');
  assert.equal(s.router.forwards, 1);
  assert.equal(s.devices.reach, 'closed');
  assert.equal(s.devices.forwards, 0);
});
