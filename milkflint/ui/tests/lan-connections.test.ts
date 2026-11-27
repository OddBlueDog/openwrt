import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Conn } from '@/features/lan/connections-api';
import {
  connRows,
  connSearchText,
  cutText,
  foldDevices,
  matchesWords,
  pollDelay,
  protocolText,
  remoteText,
  searchTerms,
  searchWords,
} from '@/features/lan/connections';
import { addSample, gapOf, MIN_GAP_MS, type Sample, seriesOf, windowOf } from '@/features/lan/connections-history';

test('pollDelay waits at least the base, and 100 times the reader cost', () => {
  assert.equal(pollDelay(5000, 20), 5000);
  assert.equal(pollDelay(5000, 120), 12000);
  assert.equal(pollDelay(10000, undefined), 10000);
});

test('foldDevices makes one device of a MAC with an IPv4 and two IPv6 addresses', () => {
  const mac = { mac: 'aa:00:00:00:01:20', name: 'Mac' };
  const names = new Map([
    ['192.168.1.20', mac],
    ['2001:db8:1:1::20', mac],
    ['fd00:1::20', mac],
  ]);
  const devices = [
    { addr: '192.168.1.20', n: 2, bytes: 100, out: 40, in: 60 },
    { addr: 'router', n: 5, bytes: 10, out: 5, in: 5 },
    { addr: '2001:db8:1:1::20', n: 1, bytes: 50, out: 20, in: 30 },
    { addr: 'fd00:1::20', n: 3, bytes: 7, out: 3, in: 4 },
    { addr: '192.168.1.99', n: 1, bytes: 1, out: 1, in: 0 },
  ];
  const folded = foldDevices(devices, names);
  assert.equal(folded.length, 3);
  const m = folded.find((d) => d.key === 'aa:00:00:00:01:20');
  assert.equal(m?.label, 'Mac');
  assert.equal(m.key, 'aa:00:00:00:01:20');
  assert.equal(m.n, 6);
  assert.equal(m.bytes, 157);
  assert.equal(m.addrs.length, 3);
  const router = folded.find((d) => d.key === 'router');
  assert.equal(router?.label, 'The router itself');
  assert.deepEqual(router.addrs, ['router']);
  const unknown = folded.find((d) => d.key === '192.168.1.99');
  assert.equal(unknown?.label, '192.168.1.99');
});

test('cutText says how many of the whole are shown', () => {
  assert.equal(cutText(200, 0), '');
  assert.equal(cutText(200, 300), 'The 200 busiest of 500');
});

test('an unnamed device with a known MAC has one label in the filter and in the table', () => {
  const names = new Map([['192.168.1.30', { mac: 'aa:00:00:00:03:30' }]]);
  const folded = foldDevices([{ addr: '192.168.1.30', n: 1, bytes: 1, out: 1, in: 0 }], names);
  const [row] = connRows([conn({ owner: '192.168.1.30' })], names);
  assert.equal(row?.label, folded[0]?.label);
  assert.equal(row?.label, 'aa:00:00:00:03:30');
});

function conn(over: Partial<Conn> = {}): Conn {
  return {
    l3: 'ipv4',
    l4: 'tcp',
    state: 'ESTABLISHED',
    owner: '192.168.1.20',
    remote: '142.250.180.14',
    rport: 443,
    lport: 51514,
    out_bytes: 1200,
    in_bytes: 56000,
    offloaded: false,
    inbound: false,
    ...over,
  };
}

test('the cells say the protocol, its state and direction, and the remote end with its port', () => {
  assert.equal(protocolText(conn()), 'TCP · established');
  assert.equal(protocolText(conn({ state: 'TIME_WAIT', inbound: true })), 'TCP · time wait · inbound');
  assert.equal(protocolText(conn({ l4: 'udp', state: null })), 'UDP');
  assert.equal(remoteText(conn()), '142.250.180.14:443');
  assert.equal(remoteText(conn({ l3: 'ipv6', remote: '2a00:1450:4009::200e' })), '[2a00:1450:4009::200e]:443');
  assert.equal(remoteText(conn({ l4: 'icmp', state: null, rport: null, lport: null, remote: '1.1.1.1' })), '1.1.1.1');
});

test('the search text is the router’s (rpcd search_text) and then the device’s name and MAC, all lower case', () => {
  // rpcd.uc builds `${l3} ${l4} ${state} ${inbound} ${offloaded} ${owner} ${remote} ${lport}`; keep them alike
  const who = { name: 'Sam’s iPhone', mac: 'AA:00:00:00:01:20' };
  assert.equal(
    connSearchText(conn({ state: 'TIME_WAIT', offloaded: true }), who),
    'ipv4 tcp time wait  offloaded 192.168.1.20 142.250.180.14:443 51514 sam’s iphone aa:00:00:00:01:20',
  );
  assert.equal(
    connSearchText(conn({ l4: 'icmp', state: null, rport: null, lport: null, owner: 'router', remote: '1.1.1.1' }), undefined),
    'ipv4 icmp    router 1.1.1.1  the router itself ',
  );
});

test('the search box’s words: lower case, split on spaces, at most 8 of up to 64 characters', () => {
  assert.deepEqual(searchWords('  iPhone   443 '), ['iphone', '443']);
  assert.deepEqual(searchWords(''), []);
  assert.equal(searchWords('a b c d e f g h i j').length, 8);
  assert.equal(searchWords('x'.repeat(100))[0]?.length, 64);
});

test('a connection matches when its text holds every word, anywhere', () => {
  const t = connSearchText(conn(), { name: 'Sam’s iPhone' });
  assert.ok(matchesWords(t, searchWords('iphone 443')));
  assert.ok(matchesWords(t, searchWords('142.250 established')));
  assert.equal(matchesWords(t, searchWords('[')), false);
  assert.equal(matchesWords(t, searchWords('iphone udp')), false);
  assert.ok(matchesWords(t, []));
});

test('the router’s words carry the owners whose names or MACs hold them, as only the page knows names', () => {
  const names = new Map([
    ['192.168.1.20', { name: 'Sam’s iPhone', mac: 'aa:00:00:00:01:20' }],
    ['2001:db8:1:1::20', { name: 'Sam’s iPhone', mac: 'aa:00:00:00:01:20' }],
    ['192.168.1.30', { mac: 'bb:00:00:00:03:30' }],
  ]);
  const devices = [
    { addr: '192.168.1.20', n: 1, bytes: 1, out: 1, in: 0 },
    { addr: '2001:db8:1:1::20', n: 1, bytes: 1, out: 1, in: 0 },
    { addr: '192.168.1.30', n: 1, bytes: 1, out: 1, in: 0 },
    { addr: 'router', n: 1, bytes: 1, out: 1, in: 0 },
  ];
  assert.deepEqual(searchTerms(['iphone', '443'], devices, names), [
    { text: 'iphone', owners: ['192.168.1.20', '2001:db8:1:1::20'] },
    { text: '443' },
  ]);
  assert.deepEqual(searchTerms(['bb:00'], devices, names), [{ text: 'bb:00', owners: ['192.168.1.30'] }]);
  assert.deepEqual(searchTerms(['router'], devices, names), [{ text: 'router', owners: ['router'] }]);
  const many = Array.from({ length: 80 }, (_, i) => ({ addr: `10.0.0.${String(i)}`, n: 1, bytes: 1, out: 1, in: 0 }));
  assert.equal(searchTerms(['10.0'], many, new Map())[0]?.owners?.length, 64);
});

test('rows have keys unique among them, two alike connections too', () => {
  const rows = connRows([conn(), conn()], new Map());
  assert.notEqual(rows[0]?.id, rows[1]?.id);
});

const at = (t: number, tcp = 1): Sample => ({ t, tcp, udp: 2, other: 3 });

test('the graph’s samples: in time order, a repeat ignored, older than what’s kept dropped', () => {
  let list = addSample([], at(1000));
  list = addSample(list, at(6000));
  assert.equal(addSample(list, at(6000)), list);
  assert.equal(addSample(list, at(5000)), list);
  list = addSample(list, at(11_000), 7000);
  assert.deepEqual(
    list.map((s) => s.t),
    [6000, 11_000],
  );
});

test('the graph breaks its lines across a gap: three usual spacings, at least 30 s', () => {
  const list = [at(0), at(5000), at(10_000), at(15_000), at(120_000), at(125_000)];
  assert.equal(gapOf(list), MIN_GAP_MS);
  assert.equal(gapOf([at(0), at(20_000), at(40_000), at(60_000)]), 60_000);
  assert.equal(gapOf([]), MIN_GAP_MS);
  const s = seriesOf(list, 0);
  assert.deepEqual(
    s.tcp.map((p) => p[1]),
    [1, 1, 1, 1, null, 1, 1],
  );
  assert.equal(s.tcp[4]?.[0], 67_500);
  // only from `from` on, and no break before the first point drawn
  assert.deepEqual(
    seriesOf(list, 100_000).udp.map((p) => p[1]),
    [2, 2],
  );
});

test('the graph’s time axis grows from a minute to ten as the tab stays open', () => {
  assert.deepEqual(windowOf([at(100_000), at(105_000)]), { from: 45_000, to: 105_000 });
  assert.deepEqual(windowOf([at(0), at(300_000)]), { from: 0, to: 300_000 });
  // the oldest sample within ten minutes starts it (one before is out of the window)
  assert.deepEqual(windowOf([at(0), at(500_000), at(900_000)]), { from: 500_000, to: 900_000 });
  assert.deepEqual(windowOf([at(0), at(700_000)]), { from: 640_000, to: 700_000 });
  assert.deepEqual(windowOf([]), { from: -60_000, to: 0 });
});
